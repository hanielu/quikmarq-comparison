import { errorMessage } from "#lib/error-message.ts";
import type { QuikmarqClient } from "#lib/quikmarq-client.ts";
import type { GroupActions } from "#lib/features/groups/group-actions.ts";
import { addBookmark, editBookmark, removeBookmark } from "./bookmark-optimism.ts";
import { copyBookmark, moveBookmark, type BookmarkSave } from "./bookmark-operations.ts";
import { bookmarksPage, type BookmarksPageResult } from "./bookmarks.remote.ts";
import type { Bookmark } from "./bookmark-list.ts";

type BookmarkQuery = ReturnType<typeof bookmarksPage>;
type QueryOverride = ReturnType<BookmarkQuery["withOverride"]>;

interface WorkflowInputs {
	readonly client: QuikmarqClient;
	readonly groups: GroupActions;
	readonly query: BookmarkQuery;
	readonly page: BookmarksPageResult;
	readonly groupId: string;
	readonly ownerId: string;
}

export class BookmarkWorkflow {
	#errorText = $state("");
	#busyIDs = $state.raw<Set<string>>(new Set());
	#temporaryId = 0;
	#active = true;
	#committed = new WeakMap<BookmarkQuery, QueryOverride[]>();
	#refreshes = new WeakMap<BookmarkQuery, Promise<void>>();
	#overrides = new Set<QueryOverride>();
	#objectURLs = new Set<string>();

	constructor(private readonly inputs: WorkflowInputs) {}

	get errorText() {
		return this.#errorText;
	}
	get busyIDs() {
		return this.#busyIDs;
	}

	resetRoute = () => {
		this.#errorText = "";
	};

	dispose = () => {
		this.#active = false;
		for (const release of this.#overrides) release();
		this.#overrides.clear();
		for (const url of this.#objectURLs) URL.revokeObjectURL(url);
		this.#objectURLs.clear();
	};

	#report = (originGroup: string, message: string) => {
		if (this.#active && this.inputs.groupId === originGroup) this.#errorText = message;
	};

	#busy = (id: string, value: boolean) => {
		this.#busyIDs = value
			? new Set([...this.#busyIDs, id])
			: new Set([...this.#busyIDs].filter((candidate) => candidate !== id));
	};

	#override = (
		query: BookmarkQuery,
		update: (value: BookmarksPageResult) => BookmarksPageResult,
		onRelease?: () => void
	): QueryOverride => {
		if (!this.#active) {
			onRelease?.();
			return () => undefined;
		}
		const release = query.withOverride(update);
		const owned = () => {
			if (!this.#overrides.delete(owned)) return;
			release();
			onRelease?.();
		};
		this.#overrides.add(owned);
		return owned;
	};

	#reconcile = async (query: BookmarkQuery, release: QueryOverride) => {
		if (!this.#active) {
			release();
			return;
		}
		const entries = this.#committed.get(query) ?? [];
		entries.push(release);
		this.#committed.set(query, entries);
		await this.#refreshQuery(query);
	};

	#refreshQuery = async (query: BookmarkQuery) => {
		if (!this.#active) return;
		const entries = this.#committed.get(query) ?? [];
		const preceding = this.#refreshes.get(query) ?? Promise.resolve();
		const next = preceding
			.catch(() => undefined)
			.then(async () => {
				const known = entries.splice(0);
				try {
					if (!this.#active) {
						for (const done of known) done();
						return;
					}
					await query.refresh();
					for (const done of known) done();
				} catch (error) {
					entries.unshift(...known);
					throw error;
				}
			});
		this.#refreshes.set(query, next);
		await next;
	};

	refreshVisited = (query: BookmarkQuery) => this.#refreshQuery(query);

	#refreshDestination = async (groupId: string) => {
		if (!this.#active) return;
		await bookmarksPage({
			ownerId: this.inputs.ownerId,
			groupId,
			query: "",
			kind: "",
			page: 1,
		}).refresh();
	};

	#preview(input: BookmarkSave, id: string, imageIDs: string[]): Bookmark {
		const now = new Date().toISOString();
		return {
			...(input.source ?? {
				id,
				createdAt: now,
				updatedAt: now,
				revision: 0,
				owner: input.ownerId,
				group: input.groupId,
				position: "0",
			}),
			...input.fields,
			kind: input.kind,
			images: input.kind === "media" ? imageIDs : input.source?.images,
		};
	}

	beginSave = (input: BookmarkSave) => {
		const query = this.inputs.query;
		const originGroup = this.inputs.groupId;
		const id = input.source?.id ?? `pending-bookmark-${++this.#temporaryId}`;
		const localURLs: string[] = [];
		const previewImages: Record<string, string> = {};
		const imageIDs = [...(input.imageIDs ?? [])];
		for (const [index, file] of (input.files ?? []).entries()) {
			const imageID = `${id}-image-${index}`;
			const url = URL.createObjectURL(file);
			imageIDs.push(imageID);
			previewImages[imageID] = url;
			localURLs.push(url);
			this.#objectURLs.add(url);
		}
		const preview = this.#preview(input, id, imageIDs);
		let release = this.#override(query, (current) =>
			input.source
				? editBookmark(current, preview, previewImages)
				: addBookmark(current, preview, previewImages)
		);
		const count = input.source
			? undefined
			: this.inputs.groups.optimisticCounts({ [input.groupId]: 1 });
		this.#busy(id, true);
		this.#errorText = "";
		let settled = false;
		const cleanup = () => {
			for (const url of localURLs) if (this.#objectURLs.delete(url)) URL.revokeObjectURL(url);
		};
		return {
			rollback: () => {
				if (settled) return;
				settled = true;
				release();
				count?.rollback();
				cleanup();
				this.#busy(id, false);
			},
			commit: async (saved: Bookmark) => {
				if (settled) return;
				settled = true;
				this.#busy(saved.id, true);
				release();
				const savedIDs = (saved.images ?? []).map((image) =>
					typeof image === "string" ? image : image.id
				);
				const uploaded = localURLs.length ? savedIDs.slice(-localURLs.length) : [];
				const confirmedImages = Object.fromEntries(
					uploaded.map((imageID, index) => [imageID, localURLs[index]])
				);
				release = this.#override(
					query,
					(current) =>
						input.source
							? editBookmark(current, saved, confirmedImages)
							: addBookmark(current, saved, confirmedImages),
					cleanup
				);
				const [pageResult, countsResult] = await Promise.allSettled([
					this.#reconcile(query, release),
					count?.commit() ?? Promise.resolve(),
				]);
				if (pageResult.status === "rejected" || countsResult.status === "rejected")
					this.#report(
						originGroup,
						"Bookmark saved, but the list could not refresh. Reload to see the latest version."
					);
				this.#busy(id, false);
				this.#busy(saved.id, false);
			},
		};
	};

	remove = async (bookmark: Bookmark) => {
		if (this.#busyIDs.has(bookmark.id) || !confirm("Delete this bookmark?")) return;
		const originGroup = this.inputs.groupId;
		const query = this.inputs.query;
		const release = this.#override(query, (current) => removeBookmark(current, bookmark.id));
		const count = this.inputs.groups.optimisticCounts({ [originGroup]: -1 });
		this.#busy(bookmark.id, true);
		this.#errorText = "";
		try {
			await this.inputs.client.delete("bookmarks", bookmark.id, bookmark.revision);
		} catch (error) {
			release();
			count.rollback();
			this.#report(originGroup, errorMessage(error));
			this.#busy(bookmark.id, false);
			return;
		}
		const results = await Promise.allSettled([this.#reconcile(query, release), count.commit()]);
		if (results.some((result) => result.status === "rejected"))
			this.#report(
				originGroup,
				"Bookmark deleted, but the list could not refresh. Reload to see the latest version."
			);
		this.#busy(bookmark.id, false);
	};

	move = async (bookmark: Bookmark, groupId: string) => {
		if (groupId === this.inputs.groupId || this.#busyIDs.has(bookmark.id)) return;
		const originGroup = this.inputs.groupId;
		const query = this.inputs.query;
		const release = this.#override(query, (current) => removeBookmark(current, bookmark.id));
		const count = this.inputs.groups.optimisticCounts({ [originGroup]: -1, [groupId]: 1 });
		this.#busy(bookmark.id, true);
		this.#errorText = "";
		try {
			await moveBookmark(this.inputs.client, bookmark, groupId, this.inputs.page.assets);
		} catch (error) {
			release();
			count.rollback();
			this.#report(originGroup, errorMessage(error));
			this.#busy(bookmark.id, false);
			return;
		}
		const results = await Promise.allSettled([
			this.#reconcile(query, release),
			count.commit(),
			this.#refreshDestination(groupId),
		]);
		if (results.some((result) => result.status === "rejected"))
			this.#report(
				originGroup,
				"Bookmark moved, but a group could not refresh. Reload to see the latest version."
			);
		this.#busy(bookmark.id, false);
	};

	copy = async (bookmark: Bookmark, groupId: string) => {
		if (this.#busyIDs.has(bookmark.id)) return;
		const originGroup = this.inputs.groupId;
		const query = this.inputs.query;
		const sameGroup = groupId === originGroup;
		const tempId = `pending-bookmark-${++this.#temporaryId}`;
		let release = sameGroup
			? this.#override(query, (current) => addBookmark(current, { ...bookmark, id: tempId }))
			: undefined;
		const count = this.inputs.groups.optimisticCounts({ [groupId]: 1 });
		this.#busy(bookmark.id, true);
		this.#busy(tempId, true);
		this.#errorText = "";
		let saved: Bookmark;
		try {
			saved = await copyBookmark(
				this.inputs.client,
				bookmark,
				groupId,
				this.inputs.page.assets,
				this.inputs.ownerId
			);
		} catch (error) {
			release?.();
			count.rollback();
			this.#report(originGroup, errorMessage(error));
			this.#busy(bookmark.id, false);
			this.#busy(tempId, false);
			return;
		}
		release?.();
		this.#busy(saved.id, true);
		if (sameGroup) {
			const sourceIDs = (bookmark.images ?? []).map((image) =>
				typeof image === "string" ? image : image.id
			);
			const copiedIDs = (saved.images ?? []).map((image) =>
				typeof image === "string" ? image : image.id
			);
			const copiedImages: Record<string, string> = {};
			for (const [index, copiedID] of copiedIDs.entries()) {
				const sourceURL = this.inputs.page.images[sourceIDs[index]];
				if (sourceURL) copiedImages[copiedID] = sourceURL;
			}
			release = this.#override(query, (current) => addBookmark(current, saved, copiedImages));
		}
		const results = await Promise.allSettled([
			release ? this.#reconcile(query, release) : Promise.resolve(),
			count.commit(),
			sameGroup ? Promise.resolve() : this.#refreshDestination(groupId),
		]);
		if (results.some((result) => result.status === "rejected"))
			this.#report(
				originGroup,
				"Bookmark copied, but a group could not refresh. Reload to see the latest version."
			);
		this.#busy(bookmark.id, false);
		this.#busy(tempId, false);
		this.#busy(saved.id, false);
	};
}

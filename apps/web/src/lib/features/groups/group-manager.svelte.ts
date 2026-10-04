import { goto } from "$app/navigation";
import { errorMessage } from "#lib/error-message.ts";
import type { QuikmarqClient } from "#lib/quikmarq-client.ts";
import { workspaceCountLoadChunks } from "#lib/features/workspace/workspace-count-batches.ts";
import {
	workspaceGroupCount,
	workspaceGroups,
	type WorkspaceGroupsResult,
} from "#lib/features/workspace/workspace.remote.ts";
import { nextRank, rankBetween, type Group } from "./group-ranking.ts";

type RemoteQueryOverride = ReturnType<ReturnType<typeof workspaceGroups>["withOverride"]>;
type CountQuery = ReturnType<typeof workspaceGroupCount>;
type CountQueryOverride = ReturnType<CountQuery["withOverride"]>;

interface WorkspaceQuery {
	readonly current: WorkspaceGroupsResult | undefined;
	withOverride(
		update: (current: WorkspaceGroupsResult) => WorkspaceGroupsResult
	): RemoteQueryOverride;
	refresh(): Promise<void>;
}

interface GroupInputs {
	readonly client: QuikmarqClient;
	readonly workspace: WorkspaceQuery;
	readonly ownerId: string;
	readonly selectedId: string | undefined;
}

interface CountChange {
	commit(): Promise<void>;
	rollback(): void;
}

export class GroupManager {
	#dialogOpen = $state(false);
	#editingId = $state<string | null>(null);
	#name = $state("");
	#busy = $state(false);
	#message = $state("");
	#pendingGroupIds = $state.raw<Set<string>>(new Set());
	#committed: RemoteQueryOverride[] = [];
	#refreshQueue: Promise<void> = Promise.resolve();
	#countQueries = $state.raw<Record<string, CountQuery>>({});
	#initialCounts: Record<string, number> = {};
	#countCommitted = new Map<string, CountQueryOverride[]>();
	#countRefreshQueues = new Map<string, Promise<void>>();
	#countOverrides = new Map<string, Set<() => void>>();
	#pendingRemovalIds = new Set<string>();
	#temporaryId = 0;
	#active = true;
	#overrides = new Set<() => void>();

	constructor(private readonly inputs: GroupInputs) {}

	get dialogOpen() {
		return this.#dialogOpen;
	}
	set dialogOpen(open: boolean) {
		this.#dialogOpen = open;
	}
	get editingId() {
		return this.#editingId;
	}
	get name() {
		return this.#name;
	}
	set name(value: string) {
		this.#name = value;
	}
	get busy() {
		return this.#busy;
	}
	get message() {
		return this.#message;
	}
	get groups() {
		return this.inputs.workspace.current?.groups ?? [];
	}
	get counts() {
		return Object.fromEntries(
			this.groups.map((group) => [
				group.id,
				this.#countQueries[group.id]?.current ?? this.#initialCounts[group.id] ?? 0,
			])
		);
	}
	get pendingGroupIds() {
		return this.#pendingGroupIds;
	}

	initializeCounts = (queries: Record<string, CountQuery>, counts: Record<string, number>) => {
		if (!this.#active) return;
		this.#countQueries = queries;
		this.#initialCounts = counts;
	};

	dispose = () => {
		this.#active = false;
		for (const release of this.#overrides) release();
		this.#overrides.clear();
		this.#countQueries = {};
		this.#initialCounts = {};
		this.#countCommitted.clear();
		this.#countRefreshQueues.clear();
		this.#countOverrides.clear();
		this.#pendingRemovalIds.clear();
	};

	#override = (update: (current: WorkspaceGroupsResult) => WorkspaceGroupsResult) => {
		if (!this.#active) return () => undefined;
		const release = this.inputs.workspace.withOverride(update);
		const owned = () => {
			if (!this.#overrides.delete(owned)) return;
			release();
		};
		this.#overrides.add(owned);
		return owned;
	};

	#countQuery = (id: string) => {
		const existing = this.#countQueries[id];
		if (existing) return existing;
		const query = workspaceGroupCount({ ownerId: this.inputs.ownerId, groupId: id });
		this.#countQueries = { ...this.#countQueries, [id]: query };
		return query;
	};

	#countOverride = (id: string, delta: number) => {
		if (!this.#active) return () => undefined;
		const release = this.#countQuery(id).withOverride((current) => Math.max(0, current + delta));
		const owned = () => {
			if (!this.#overrides.delete(owned)) return;
			release();
			const groupOverrides = this.#countOverrides.get(id);
			groupOverrides?.delete(owned);
			if (groupOverrides?.size === 0) this.#countOverrides.delete(id);
		};
		this.#overrides.add(owned);
		const groupOverrides = this.#countOverrides.get(id) ?? new Set<() => void>();
		groupOverrides.add(owned);
		this.#countOverrides.set(id, groupOverrides);
		return owned;
	};

	#pruneCountQueries = () => {
		const visible = new Set(this.groups.map((group) => group.id));
		const remaining = Object.entries(this.#countQueries).filter(
			([id]) =>
				visible.has(id) ||
				this.#pendingRemovalIds.has(id) ||
				this.#countOverrides.has(id) ||
				this.#countRefreshQueues.has(id)
		);
		if (remaining.length === Object.keys(this.#countQueries).length) return;
		this.#countQueries = Object.fromEntries(remaining);
		this.#initialCounts = Object.fromEntries(
			Object.entries(this.#initialCounts).filter(([id]) => id in this.#countQueries)
		);
	};

	#loadNewCounts = async () => {
		for (const chunk of workspaceCountLoadChunks(this.groups)) {
			if (!this.#active) return;
			const pending: Promise<unknown>[] = [];
			for (const group of chunk) {
				if (this.#pendingGroupIds.has(group.id)) continue;
				const query = this.#countQueries[group.id];
				if (!query) pending.push(this.#countQuery(group.id));
				else if (query.error) pending.push(query.refresh());
				else if (!query.ready) pending.push(query);
			}
			await Promise.all(pending);
		}
	};

	create = () => {
		this.#editingId = null;
		this.#name = "";
		this.#message = "";
		this.#dialogOpen = true;
	};

	rename = (id: string, currentName: string) => {
		this.#editingId = id;
		this.#name = currentName;
		this.#message = "";
		this.#dialogOpen = true;
	};

	// A refresh retires only writes known to have committed before it began.
	#refresh = async () => {
		if (!this.#active) return;
		const run = this.#refreshQueue
			.catch(() => undefined)
			.then(async () => {
				if (!this.#active) return;
				const committed = this.#committed.splice(0);
				try {
					await this.inputs.workspace.refresh();
					if (!this.#active) {
						for (const release of committed) release();
						return;
					}
					await this.#loadNewCounts();
					if (!this.#active) {
						for (const release of committed) release();
						return;
					}
					for (const release of committed) release();
					this.#pruneCountQueries();
				} catch (error) {
					this.#committed.unshift(...committed);
					throw error;
				}
			});
		this.#refreshQueue = run;
		await run;
	};

	refreshWorkspace = () => this.#refresh();

	#commit = async (release: RemoteQueryOverride) => {
		if (!this.#active) {
			release();
			return;
		}
		this.#committed.push(release);
		await this.#refresh();
	};

	#refreshCount = async (id: string) => {
		if (!this.#active) return;
		const query = this.#countQuery(id);
		const entries = this.#countCommitted.get(id) ?? [];
		const preceding = this.#countRefreshQueues.get(id) ?? Promise.resolve();
		const run = preceding
			.catch(() => undefined)
			.then(async () => {
				const committed = entries.splice(0);
				try {
					if (!this.#active) {
						for (const release of committed) release();
						return;
					}
					await query.refresh();
					for (const release of committed) release();
				} catch (error) {
					entries.unshift(...committed);
					throw error;
				}
			});
		this.#countRefreshQueues.set(id, run);
		try {
			await run;
		} finally {
			if (this.#countRefreshQueues.get(id) === run) this.#countRefreshQueues.delete(id);
			if (entries.length === 0) this.#countCommitted.delete(id);
			this.#pruneCountQueries();
		}
	};

	optimisticCounts = (deltas: Readonly<Record<string, number>>): CountChange => {
		const releases = Object.entries(deltas).map(
			([id, delta]) => [id, this.#countOverride(id, delta)] as const
		);
		let settled = false;
		return {
			commit: async () => {
				if (settled) return;
				settled = true;
				if (!this.#active) {
					for (const [, release] of releases) release();
					return;
				}
				for (const [id, release] of releases) {
					const entries = this.#countCommitted.get(id) ?? [];
					entries.push(release);
					this.#countCommitted.set(id, entries);
				}
				await Promise.all(releases.map(([id]) => this.#refreshCount(id)));
			},
			rollback: () => {
				if (settled) return;
				settled = true;
				for (const [, release] of releases) release();
			},
		};
	};

	save = async (event: SubmitEvent) => {
		event.preventDefault();
		const name = this.#name.trim();
		if (!name || this.#busy) return;

		const editingId = this.#editingId;
		const originGroupId = this.inputs.selectedId;
		this.#busy = true;
		this.#message = "";
		let release: RemoteQueryOverride | undefined;
		let temporaryId: string | undefined;
		let createdId: string | undefined;
		let authoritative: Group | undefined;

		try {
			if (editingId) {
				const group = this.groups.find((candidate) => candidate.id === editingId);
				if (!group) throw new Error("This group is no longer available.");
				release = this.#override((current) => ({
					...current,
					groups: current.groups.map((candidate) =>
						candidate.id === editingId ? { ...candidate, name } : candidate
					),
				}));
				authoritative = await this.inputs.client.update(
					"groups",
					editingId,
					{ name },
					group.revision
				);
			} else {
				const ordered = [...this.groups].sort((left, right) =>
					(left.rank ?? "").localeCompare(right.rank ?? "")
				);
				const rank = nextRank(ordered.at(-1)?.rank);
				temporaryId = `pending-group-${++this.#temporaryId}`;
				const now = new Date().toISOString();
				const preview: Group = {
					id: temporaryId,
					name,
					rank,
					owner: this.inputs.ownerId,
					createdAt: now,
					updatedAt: now,
					revision: 0,
				};
				this.#pendingGroupIds = new Set([...this.#pendingGroupIds, temporaryId]);
				release = this.#override((current) => ({
					...current,
					groups: [...current.groups, preview],
				}));
				authoritative = await this.inputs.client.create("groups", {
					name,
					owner: this.inputs.ownerId,
					rank,
				});
				createdId = authoritative.id;
			}
		} catch (error) {
			release?.();
			this.#message = errorMessage(error);
			this.#busy = false;
			if (temporaryId)
				this.#pendingGroupIds = new Set(
					[...this.#pendingGroupIds].filter((id) => id !== temporaryId)
				);
			return;
		}

		this.#dialogOpen = false;
		if (authoritative) {
			release?.();
			const saved = authoritative;
			release = this.#override((current) => ({
				...current,
				groups: (editingId
					? current.groups.map((candidate) => (candidate.id === saved.id ? saved : candidate))
					: current.groups.some((candidate) => candidate.id === saved.id)
						? current.groups
						: [...current.groups, saved]
				).sort((left, right) => (left.rank ?? "").localeCompare(right.rank ?? "")),
			}));
		}
		if (temporaryId)
			this.#pendingGroupIds = new Set(
				[...this.#pendingGroupIds].filter((id) => id !== temporaryId)
			);
		try {
			if (createdId && this.#active && this.inputs.selectedId === originGroupId)
				await goto(`/app/${createdId}`);
			if (release) await this.#commit(release);
		} catch {
			this.#message = createdId
				? "Group created, but the workspace could not refresh. Reload to see it."
				: "Group renamed, but the workspace could not refresh. Reload to see the latest name.";
		} finally {
			if (temporaryId)
				this.#pendingGroupIds = new Set(
					[...this.#pendingGroupIds].filter((id) => id !== temporaryId)
				);
			this.#busy = false;
		}
	};

	remove = async (id: string) => {
		if (this.#busy || !confirm("Delete this group and its bookmarks? This cannot be undone."))
			return;
		const source = this.groups.find((candidate) => candidate.id === id);
		if (!source) return;
		this.#busy = true;
		this.#message = "";
		this.#pendingRemovalIds.add(id);
		const release = this.#override((current) => ({
			...current,
			groups: current.groups.filter((candidate) => candidate.id !== id),
		}));
		try {
			await this.inputs.client.delete("groups", id, source.revision);
		} catch (error) {
			release();
			this.#pendingRemovalIds.delete(id);
			this.#message = errorMessage(error);
			this.#busy = false;
			return;
		}
		try {
			if (this.#active && this.inputs.selectedId === id) await goto("/app");
			await this.#commit(release);
		} catch {
			this.#message =
				"Group deleted, but the workspace could not refresh. Reload to see the latest groups.";
		} finally {
			this.#pendingRemovalIds.delete(id);
			this.#pruneCountQueries();
			this.#busy = false;
		}
	};

	reorder = async (id: string, direction: -1 | 1) => {
		if (this.#busy) return;
		const ordered = [...this.groups].sort((left, right) =>
			(left.rank ?? "").localeCompare(right.rank ?? "")
		);
		const index = ordered.findIndex((group) => group.id === id);
		const destination = index + direction;
		if (index < 0 || destination < 0 || destination >= ordered.length) return;
		const [moved] = ordered.splice(index, 1);
		ordered.splice(destination, 0, moved);

		let rank: string | null;
		try {
			rank = rankBetween(ordered[destination - 1]?.rank, ordered[destination + 1]?.rank);
		} catch (error) {
			this.#message = errorMessage(error);
			return;
		}
		if (!rank) {
			this.#message = "There is no room between these groups. Refresh and try another position.";
			return;
		}

		this.#busy = true;
		this.#message = "";
		let release = this.#override((current) => ({
			...current,
			groups: current.groups
				.map((group) => (group.id === id ? { ...group, rank } : group))
				.sort((left, right) => (left.rank ?? "").localeCompare(right.rank ?? "")),
		}));
		let saved: Group;
		try {
			saved = await this.inputs.client.update("groups", id, { rank }, moved.revision);
		} catch (error) {
			release();
			this.#message = errorMessage(error);
			this.#busy = false;
			return;
		}
		release();
		release = this.#override((current) => ({
			...current,
			groups: current.groups
				.map((group) => (group.id === id ? saved : group))
				.sort((left, right) => (left.rank ?? "").localeCompare(right.rank ?? "")),
		}));
		try {
			await this.#commit(release);
		} catch {
			this.#message =
				"Group reordered, but the workspace could not refresh. Reload to see the latest order.";
		} finally {
			this.#busy = false;
		}
	};
}

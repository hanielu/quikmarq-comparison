import { memoryTokenStore, RiduError } from "@riducms/sdk";
import { createClient } from "./ridu.generated.ts";
import type {
	AssetsUpdate,
	BookmarksUpdate,
	GroupsUpdate,
	AssetsWhere,
	BookmarksWhere,
	GroupsWhere,
} from "./ridu.generated.ts";
import {
	CmsError,
	type Asset,
	type Bookmark,
	type Collection,
	type Document,
	type Group,
	type Page,
	type QuikmarqClient,
	type Session,
	type Where,
} from "./quikmarq-client.ts";
import { quikmarqDocument, quikmarqUser } from "./quikmarq-documents.ts";

type NativeClient = ReturnType<typeof createClient<"users">>;

function required(value: string | undefined, field: string): string {
	if (value === undefined) throw new Error(`${field} is required.`);
	return value;
}

function groupFields(data: Partial<Group>): GroupsUpdate {
	return {
		owner: data.owner,
		name: data.name,
		rank: data.rank,
		sharingEnabled: data.sharingEnabled,
		shareVersion: data.shareVersion,
	};
}

function bookmarkFields(data: Partial<Bookmark>): BookmarksUpdate {
	return {
		owner: data.owner,
		group: data.group,
		kind: data.kind,
		position: data.position,
		url: data.url,
		title: data.title,
		description: data.description,
		favicon: data.favicon,
		previewImage: data.previewImage,
		videoProvider: data.videoProvider,
		videoID: data.videoID,
		text: data.text,
		caption: data.caption,
		images:
			data.images == null
				? data.images
				: data.images.map((image) => (typeof image === "string" ? image : image.id)),
	};
}

function assetFields(data: Partial<Asset>): AssetsUpdate {
	return { owner: data.owner, group: data.group, alt: data.alt };
}

/** Ridu's generated SDK and session transport, projected to Quikmarq's UI operations. */
export class RiduClient implements QuikmarqClient {
	constructor(
		readonly baseURL: string,
		private readonly token: () => Promise<string | null>,
		private readonly fetcher: typeof fetch = fetch
	) {}

	// Each operation captures its credential. An old request cannot adopt a newer
	// account's token or mutate the browser's session state after it finishes.
	async #run<T>(operation: (client: NativeClient) => Promise<T>): Promise<T> {
		const token = await this.token();
		const client = createClient({
			baseURL: this.baseURL,
			auth: { collection: "users", token: memoryTokenStore(token ? { token } : null) },
			fetch: this.fetcher,
		});
		try {
			return await operation(client);
		} catch (error) {
			if (error instanceof RiduError) {
				const failure = new CmsError(error.message, error.status, error.issues);
				failure.cause = error;
				throw failure;
			}
			throw error;
		}
	}

	request(path: string, init: RequestInit = {}) {
		return this.#run((client) => client.request(path, init));
	}

	groupSharePath(id: string) {
		return `/api/collections/groups/${encodeURIComponent(id)}/share`;
	}

	async find<Slug extends Collection>(
		collection: Slug,
		options: { page?: number; limit?: number; sort?: string; where?: Where; depth?: number } = {}
	): Promise<Page<Document<Slug>>> {
		const populateImages = collection === "bookmarks" && (options.depth ?? 0) > 0;
		const common = {
			page: options.page,
			limit: options.limit,
			sort: options.sort?.split(","),
			depth: populateImages ? undefined : (options.depth ?? 0),
		};
		return this.#run(async (client) => {
			const result =
				collection === "groups"
					? await client.list("groups", {
							...common,
							where: options.where as GroupsWhere | undefined,
						})
					: collection === "bookmarks"
						? await client.list("bookmarks", {
								...common,
								where: options.where as BookmarksWhere | undefined,
								...(populateImages ? { populate: { images: true } } : {}),
							})
						: await client.list("assets", {
								...common,
								where: options.where as AssetsWhere | undefined,
							});
			return {
				docs: result.docs.map((doc) => quikmarqDocument(collection, doc)),
				pagination: result.pagination,
			};
		});
	}

	async findByID<Slug extends Collection>(collection: Slug, id: string): Promise<Document<Slug>> {
		return this.#run(async (client) =>
			quikmarqDocument(collection, await client.find(collection, id))
		);
	}

	count(collection: Collection, where: Where): Promise<number> {
		return this.#run(async (client) => {
			const result =
				collection === "groups"
					? await client.count("groups", { where: where as GroupsWhere })
					: collection === "bookmarks"
						? await client.count("bookmarks", { where: where as BookmarksWhere })
						: await client.count("assets", { where: where as AssetsWhere });
			return result.totalDocs;
		});
	}

	create<Slug extends Collection>(
		collection: Slug,
		data: Partial<Document<Slug>>
	): Promise<Document<Slug>> {
		return this.#run(async (client) => {
			if (collection === "groups") {
				const fields = groupFields(data as Partial<Group>);
				return quikmarqDocument(
					collection,
					await client.create("groups", {
						...fields,
						owner: required(fields.owner, "Owner"),
						name: required(fields.name, "Name"),
						rank: required(fields.rank, "Rank"),
					})
				);
			}
			if (collection === "bookmarks") {
				const fields = bookmarkFields(data as Partial<Bookmark>);
				if (!fields.kind) throw new Error("Bookmark kind is required.");
				return quikmarqDocument(
					collection,
					await client.create("bookmarks", {
						...fields,
						owner: required(fields.owner, "Owner"),
						group: required(fields.group, "Group"),
						kind: fields.kind,
						position: required(fields.position, "Position"),
					})
				);
			}
			const fields = assetFields(data as Partial<Asset>);
			return quikmarqDocument(
				collection,
				await client.create("assets", {
					...fields,
					owner: required(fields.owner, "Owner"),
					group: required(fields.group, "Group"),
				})
			);
		});
	}

	update<Slug extends Collection>(
		collection: Slug,
		id: string,
		data: Partial<Document<Slug>>,
		revision: number
	): Promise<Document<Slug>> {
		return this.#run(async (client) => {
			const result =
				collection === "groups"
					? await client.publishChanges("groups", id, groupFields(data as Partial<Group>), {
							revision,
						})
					: collection === "bookmarks"
						? await client.publishChanges(
								"bookmarks",
								id,
								bookmarkFields(data as Partial<Bookmark>),
								{ revision }
							)
						: await client.update("assets", id, assetFields(data as Partial<Asset>), { revision });
			return quikmarqDocument(collection, result);
		});
	}

	async delete(collection: Collection, id: string, _revision?: number): Promise<void> {
		// Ridu 0.13's native delete API has no revision guard. Updates retain their
		// publish lifecycle guard; do not pretend a delete precondition is enforced.
		await this.#run((client) => client.delete(collection, id));
	}

	upload(file: File, data: { group: string; alt: string }): Promise<Asset> {
		return this.#run(async (client) => {
			const session = await client.auth.getSession();
			if (!session) throw new CmsError("Sign in to upload images.", 401);
			return quikmarqDocument(
				"assets",
				await client.upload("assets", file, { data: { ...data, owner: session.user.id } })
			);
		});
	}

	duplicateAsset(id: string, data: { group: string; alt?: string }): Promise<Asset> {
		return this.#run(async (client) => {
			const session = await client.auth.getSession();
			if (!session) throw new CmsError("Sign in to copy images.", 401);
			return quikmarqDocument(
				"assets",
				await client.duplicate("assets", id, { ...data, owner: session.user.id })
			);
		});
	}

	signedAssetURLs(items: Array<{ id: string; size?: "thumb" }>): Promise<Record<string, string>> {
		if (!items.length) return Promise.resolve({});
		if (items.length > 100) throw new Error("Too many images requested at once.");
		return this.#run(async (client) => {
			const urls = await client.getUploadURLs("assets", items, { expiresIn: 1800 });
			return Object.fromEntries(
				items.flatMap((item, index) => (urls[index]?.url ? [[item.id, urls[index].url]] : []))
			);
		});
	}

	async currentSession(): Promise<Session | null> {
		if (!(await this.token())) return null;
		return this.#run(async (client) => {
			const session = await client.auth.getSession();
			return session ? { user: quikmarqUser(session.user), expiresAt: session.expiresAt } : null;
		});
	}

	async createUser(data: { email: string; password: string; displayName: string }): Promise<void> {
		await this.#run((client) =>
			client.auth.createUser({
				data: { email: data.email, displayName: data.displayName },
				password: data.password,
			})
		);
	}

	async login(email: string, password: string) {
		const tokens = memoryTokenStore();
		const client = createClient({
			baseURL: this.baseURL,
			auth: { collection: "users", token: tokens },
			fetch: this.fetcher,
		});
		try {
			const session = await client.auth.login({ email, password });
			if (!tokens.token) throw new Error("The content service did not issue a session.");
			return { token: tokens.token, user: quikmarqUser(session.user) };
		} catch (error) {
			if (error instanceof RiduError) throw new CmsError(error.message, error.status, error.issues);
			throw error;
		}
	}

	async logout(): Promise<void> {
		await this.#run((client) => client.auth.logout());
	}
}

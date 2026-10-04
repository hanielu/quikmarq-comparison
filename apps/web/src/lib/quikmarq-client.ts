import type { Config as PayloadConfig } from "../../../../backends/payload/src/payload-types.ts";
import type { Where } from "payload";

// Quikmarq's view of its three collections. Native generated contracts remain the
// authoring contracts; adapters project relationships and revisions for this UI.
type NativeCollections = PayloadConfig["collections"];
export type Collection = "groups" | "bookmarks" | "assets";
export type Group = Omit<NativeCollections["groups"], "owner"> & { owner: string };
export type Asset = Omit<NativeCollections["assets"], "owner" | "group" | "sizes"> & {
	owner: string;
	group: string;
	sizes?: unknown;
};
export type Bookmark = Omit<NativeCollections["bookmarks"], "owner" | "group" | "images"> & {
	owner: string;
	group: string;
	images?: Array<string | Asset> | null;
};
export type Document<Slug extends Collection> = {
	groups: Group;
	bookmarks: Bookmark;
	assets: Asset;
}[Slug];
export type User = Pick<NativeCollections["users"], "id" | "email" | "displayName">;
export type Session = { user: User; expiresAt?: string };
export type BookmarkKind = Bookmark["kind"];
export type BookmarkFields = Partial<
	Pick<
		Bookmark,
		| "url"
		| "title"
		| "description"
		| "favicon"
		| "previewImage"
		| "videoProvider"
		| "videoID"
		| "text"
		| "caption"
		| "images"
	>
>;
export type { Where };

export interface Pagination {
	page: number;
	limit: number;
	totalDocs: number;
	totalPages: number;
	hasNextPage: boolean;
	hasPrevPage: boolean;
}

export interface Page<Doc> {
	docs: Doc[];
	pagination: Pagination;
}

export class CmsError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly issues: ReadonlyArray<{ path?: string; message: string }> = []
	) {
		super(message);
		this.name = "CmsError";
	}
}

/** The operations used by this bookmark app, backed by each CMS's native API. */
export interface QuikmarqClient {
	readonly baseURL: string;
	request(path: string, init?: RequestInit): Promise<Response>;
	groupSharePath(id: string): string;
	find<Slug extends Collection>(
		collection: Slug,
		options?: { page?: number; limit?: number; sort?: string; where?: Where; depth?: number }
	): Promise<Page<Document<Slug>>>;
	findByID<Slug extends Collection>(collection: Slug, id: string): Promise<Document<Slug>>;
	count(collection: Collection, where: Where): Promise<number>;
	create<Slug extends Collection>(
		collection: Slug,
		data: Partial<Document<Slug>>
	): Promise<Document<Slug>>;
	update<Slug extends Collection>(
		collection: Slug,
		id: string,
		data: Partial<Document<Slug>>,
		revision: number
	): Promise<Document<Slug>>;
	delete(collection: Collection, id: string, revision?: number): Promise<void>;
	upload(file: File, data: { group: string; alt: string }): Promise<Asset>;
	duplicateAsset(id: string, data: { group: string; alt?: string }): Promise<Asset>;
	signedAssetURLs(items: Array<{ id: string; size?: "thumb" }>): Promise<Record<string, string>>;
	currentSession(): Promise<Session | null>;
	createUser(data: { email: string; password: string; displayName: string }): Promise<void>;
	login(email: string, password: string): Promise<{ token: string; user: User }>;
	logout(): Promise<void>;
}

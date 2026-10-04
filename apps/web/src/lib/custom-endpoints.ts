import type { QuikmarqClient } from "./quikmarq-client.ts";
import type { PublicBookmark, PublicCollection, PublicImage } from "./share";

export interface BookmarkMetadata {
	normalizedURL: string;
	title?: string;
	description?: string;
	favicon?: string;
	previewImage?: string;
	videoProvider?: string;
	videoID?: string;
}

export interface ShareStatus {
	sharingEnabled: boolean;
	token?: string;
}

export class EndpointError extends Error {
	constructor(
		message: string,
		public readonly status: number
	) {
		super(message);
	}
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Unexpected server response.");
	return value as Record<string, unknown>;
}

function string(value: unknown): string {
	if (typeof value !== "string") throw new Error("Unexpected server response.");
	return value;
}

function optionalString(value: unknown): string | undefined {
	return value == null ? undefined : string(value);
}

function integer(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new Error("Unexpected server response.");
	return value;
}

function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") throw new Error("Unexpected server response.");
	return value;
}

export function parseBookmarkMetadata(value: unknown): BookmarkMetadata {
	const data = record(value);
	return {
		normalizedURL: string(data.normalizedURL),
		title: optionalString(data.title),
		description: optionalString(data.description),
		favicon: optionalString(data.favicon),
		previewImage: optionalString(data.previewImage),
		videoProvider: optionalString(data.videoProvider),
		videoID: optionalString(data.videoID),
	};
}

export function parseShareStatus(value: unknown): ShareStatus {
	const data = record(value);
	const sharingEnabled = boolean(data.sharingEnabled);
	const token = optionalString(data.token);
	if (sharingEnabled && !token) throw new Error("Unexpected server response.");
	return { sharingEnabled, ...(token ? { token } : {}) };
}

function parseImage(value: unknown): PublicImage {
	const data = record(value);
	const width = data.width == null ? undefined : integer(data.width);
	const height = data.height == null ? undefined : integer(data.height);
	return {
		id: string(data.id),
		url: string(data.url),
		alt: optionalString(data.alt),
		thumbnailURL: optionalString(data.thumbnailURL),
		width,
		height,
	};
}

function parseBookmark(value: unknown): PublicBookmark {
	const data = record(value);
	if (data.kind !== "link" && data.kind !== "text" && data.kind !== "media")
		throw new Error("Unexpected server response.");
	if (!Array.isArray(data.images)) throw new Error("Unexpected server response.");
	return {
		id: string(data.id),
		kind: data.kind,
		position: string(data.position),
		url: optionalString(data.url),
		title: optionalString(data.title),
		description: optionalString(data.description),
		favicon: optionalString(data.favicon),
		previewImage: optionalString(data.previewImage),
		videoProvider: optionalString(data.videoProvider),
		videoID: optionalString(data.videoID),
		text: optionalString(data.text),
		caption: optionalString(data.caption),
		images: data.images.map(parseImage),
	};
}

export function parsePublicCollection(value: unknown): PublicCollection {
	const data = record(value);
	const group = record(data.group);
	const pagination = record(data.pagination);
	if (!Array.isArray(data.docs)) throw new Error("Unexpected server response.");
	return {
		group: { id: string(group.id), name: string(group.name) },
		docs: data.docs.map(parseBookmark),
		pagination: {
			page: integer(pagination.page),
			limit: integer(pagination.limit),
			totalDocs: integer(pagination.totalDocs),
			totalPages: integer(pagination.totalPages),
			hasNextPage: boolean(pagination.hasNextPage),
			hasPrevPage: boolean(pagination.hasPrevPage),
		},
	};
}

async function json(response: Response): Promise<unknown> {
	try {
		return (await response.json()) as unknown;
	} catch {
		throw new Error("Unexpected server response.");
	}
}

export async function bookmarkMetadata(
	client: QuikmarqClient,
	url: string
): Promise<BookmarkMetadata> {
	const response = await client.request("/api/bookmark-metadata", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ url }),
	});
	if (!response.ok) {
		const message =
			response.status === 401
				? "Your session has expired. Log in again to preview or save a link."
				: response.status === 403
					? "You no longer have access to preview links."
					: "Could not preview this page. You can still save the link manually.";
		throw new EndpointError(message, response.status);
	}
	return parseBookmarkMetadata(await json(response));
}

export async function shareStatus(client: QuikmarqClient, groupId: string): Promise<ShareStatus> {
	const response = await client.request(client.groupSharePath(groupId));
	if (!response.ok) throw new EndpointError("Could not load sharing settings.", response.status);
	return parseShareStatus(await json(response));
}

export async function mutateShare(
	client: QuikmarqClient,
	groupId: string,
	method: "POST" | "DELETE",
	rotate = false
): Promise<ShareStatus> {
	const response = await client.request(client.groupSharePath(groupId), {
		method,
		headers: method === "POST" ? { "content-type": "application/json" } : undefined,
		body: method === "POST" ? JSON.stringify({ rotate }) : undefined,
	});
	if (!response.ok) throw new EndpointError("Could not update sharing settings.", response.status);
	return parseShareStatus(await json(response));
}

export async function resolveShare(
	client: QuikmarqClient,
	input: { token: string; page: number; limit: number; query: string; kind?: string }
): Promise<PublicCollection> {
	const response = await client.request("/api/share/resolve", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok)
		throw new EndpointError("Could not load this shared collection.", response.status);
	return parsePublicCollection(await json(response));
}

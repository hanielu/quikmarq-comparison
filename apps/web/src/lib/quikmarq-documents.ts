import type { Asset, Bookmark, Collection, Document, Group, User } from "./quikmarq-client.ts";

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("The content service returned an invalid document.");
	return value as Record<string, unknown>;
}

function string(value: unknown): string {
	if (typeof value !== "string") throw new Error("The content service returned an invalid field.");
	return value;
}

function optionalString(value: unknown): string | null | undefined {
	return value == null ? value : string(value);
}

function optionalNumber(value: unknown): number | null | undefined {
	if (value == null) return value;
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new Error("The content service returned an invalid number.");
	return value;
}

function relationship(value: unknown): string {
	return typeof value === "string" ? value : string(record(value).id);
}

function metadata(data: Record<string, unknown>) {
	return {
		id: string(data.id),
		createdAt: string(data.createdAt),
		updatedAt: string(data.updatedAt),
	};
}

function revision(data: Record<string, unknown>): number {
	const value = data._revision ?? data.revision;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new Error("The content service returned a document without a valid revision.");
	return value;
}

function group(value: unknown): Group {
	const data = record(value);
	return {
		...metadata(data),
		owner: relationship(data.owner),
		name: string(data.name),
		rank: string(data.rank),
		revision: revision(data),
		sharingEnabled: typeof data.sharingEnabled === "boolean" ? data.sharingEnabled : undefined,
		shareVersion: optionalNumber(data.shareVersion),
	};
}

function asset(value: unknown): Asset {
	const data = record(value);
	return {
		...metadata(data),
		owner: relationship(data.owner),
		group: relationship(data.group),
		alt: optionalString(data.alt),
		url: optionalString(data.url),
		filename: optionalString(data.filename),
		mimeType: optionalString(data.mimeType),
		filesize: optionalNumber(data.filesize),
		width: optionalNumber(data.width),
		height: optionalNumber(data.height),
		sizes: data.sizes,
	};
}

function bookmark(value: unknown): Bookmark {
	const data = record(value);
	if (data.kind !== "link" && data.kind !== "text" && data.kind !== "media")
		throw new Error("The content service returned an invalid bookmark kind.");
	if (data.images != null && !Array.isArray(data.images))
		throw new Error("The content service returned invalid images.");
	return {
		...metadata(data),
		owner: relationship(data.owner),
		group: relationship(data.group),
		kind: data.kind,
		position: string(data.position),
		revision: revision(data),
		url: optionalString(data.url),
		title: optionalString(data.title),
		description: optionalString(data.description),
		favicon: optionalString(data.favicon),
		previewImage: optionalString(data.previewImage),
		videoProvider: optionalString(data.videoProvider),
		videoID: optionalString(data.videoID),
		text: optionalString(data.text),
		caption: optionalString(data.caption),
		images:
			data.images == null
				? data.images
				: data.images.map((image: unknown) => (typeof image === "string" ? image : asset(image))),
	};
}

const readers: { [Slug in Collection]: (value: unknown) => Document<Slug> } = {
	groups: group,
	bookmarks: bookmark,
	assets: asset,
};

export function quikmarqDocument<Slug extends Collection>(
	collection: Slug,
	value: unknown
): Document<Slug> {
	return readers[collection](value);
}

export function quikmarqUser(value: unknown): User {
	const data = record(value);
	return { id: string(data.id), email: string(data.email), displayName: string(data.displayName) };
}

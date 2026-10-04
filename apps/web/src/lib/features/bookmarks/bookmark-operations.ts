import type { QuikmarqClient, BookmarkFields } from "#lib/quikmarq-client.ts";
import type { Asset, Bookmark, BookmarkKind } from "./bookmark-list";
import { cleanupAssets, cloneMediaAssets, validateImages } from "./media-assets";

export class BookmarkSaveCancelled extends Error {
	constructor() {
		super("Bookmark save cancelled.");
	}
}

export interface BookmarkSave {
	source: Bookmark | null;
	groupId: string;
	ownerId: string;
	kind: BookmarkKind;
	fields: BookmarkFields;
	imageIDs?: string[];
	files?: File[];
	/** The form may disappear while a multi-upload save is in flight. */
	canContinue?: () => boolean;
}

/** Uploads and the parent write form one client-owned operation with compensation. */
export async function saveBookmark(client: QuikmarqClient, input: BookmarkSave): Promise<Bookmark> {
	const files = input.files ?? [];
	const imageIDs = input.imageIDs ?? [];
	const validation = validateImages(files, imageIDs.length);
	if (validation) throw new Error(validation);
	if (input.kind !== "media" && files.length) throw new Error("Images require a media bookmark.");
	if (input.kind === "media" && !imageIDs.length && !files.length)
		throw new Error("Choose at least one image.");
	if (input.kind === "link" && !input.fields.url) throw new Error("Add a link to save.");
	if (input.kind === "text" && !input.fields.text) throw new Error("Write a note to save.");

	const uploaded: string[] = [];
	let persisted = false;
	let saved: Bookmark;
	const ensureActive = () => {
		if (input.canContinue?.() === false) throw new BookmarkSaveCancelled();
	};

	try {
		ensureActive();
		for (const file of files) {
			const asset = await client.upload(file, { group: input.groupId, alt: file.name });
			uploaded.push(asset.id);
			ensureActive();
		}

		const fields: BookmarkFields =
			input.kind === "media"
				? { ...input.fields, images: [...imageIDs, ...uploaded] }
				: input.fields;
		ensureActive();
		if (input.source) {
			saved = await client.update("bookmarks", input.source.id, fields, input.source.revision);
		} else {
			const create: Partial<Bookmark> = {
				owner: input.ownerId,
				group: input.groupId,
				kind: input.kind,
				position: "0",
				...fields,
			};
			saved = await client.create("bookmarks", create);
		}
		persisted = true;
		return saved;
	} catch (error) {
		if (!persisted) await cleanUpFailedWrite(client, uploaded, error);
		throw error;
	}
}

async function cloneImages(
	client: QuikmarqClient,
	bookmark: Bookmark,
	assets: Record<string, Asset>,
	destinationGroup: string
) {
	if (bookmark.kind !== "media") return [];
	return cloneMediaAssets(client, bookmark, assets, destinationGroup);
}

async function cleanUpFailedWrite(
	client: QuikmarqClient,
	clonedImageIDs: string[],
	error: unknown
): Promise<never> {
	const failed = await cleanupAssets(client, clonedImageIDs);
	if (failed.length) {
		const reason = error instanceof Error ? error.message : "Bookmark operation failed.";
		throw new Error(`${reason} Some images could not be cleaned up; contact support.`, {
			cause: error,
		});
	}
	throw error;
}

/** A move changes the source bookmark only after all destination images exist. */
export async function moveBookmark(
	client: QuikmarqClient,
	bookmark: Bookmark,
	destinationGroup: string,
	assets: Record<string, Asset>
): Promise<Bookmark> {
	const clonedImageIDs = await cloneImages(client, bookmark, assets, destinationGroup);

	try {
		return await client.update(
			"bookmarks",
			bookmark.id,
			{ group: destinationGroup, ...(bookmark.kind === "media" ? { images: clonedImageIDs } : {}) },
			bookmark.revision
		);
	} catch (error) {
		return cleanUpFailedWrite(client, clonedImageIDs, error);
	}
}

/** A copy owns fresh image documents even when it stays in the same group. */
export async function copyBookmark(
	client: QuikmarqClient,
	bookmark: Bookmark,
	destinationGroup: string,
	assets: Record<string, Asset>,
	ownerId: string
): Promise<Bookmark> {
	const clonedImageIDs = await cloneImages(client, bookmark, assets, destinationGroup);
	const input: Partial<Bookmark> = {
		owner: ownerId,
		group: destinationGroup,
		kind: bookmark.kind ?? "text",
		position: "0",
		url: bookmark.url,
		title: bookmark.title,
		description: bookmark.description,
		favicon: bookmark.favicon,
		previewImage: bookmark.previewImage,
		videoProvider: bookmark.videoProvider,
		videoID: bookmark.videoID,
		text: bookmark.text,
		caption: bookmark.caption,
		images: bookmark.kind === "media" ? clonedImageIDs : [],
	};

	try {
		return await client.create("bookmarks", input);
	} catch (error) {
		return cleanUpFailedWrite(client, clonedImageIDs, error);
	}
}

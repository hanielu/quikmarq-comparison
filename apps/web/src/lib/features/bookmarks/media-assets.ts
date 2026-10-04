import { CmsError, type QuikmarqClient } from "../../quikmarq-client.ts";
import type { Asset, Bookmark } from "./bookmark-list";

export async function assetMap(
	client: QuikmarqClient,
	bookmarks: Bookmark[]
): Promise<Record<string, Asset>> {
	const known: Record<string, Asset> = {};
	const ids = new Set<string>();

	for (const bookmark of bookmarks) {
		for (const image of bookmark.images ?? []) {
			if (typeof image === "string") {
				ids.add(image);
			} else if (image.id) {
				known[image.id] = image;
			}
		}
	}

	const entries = await Promise.all(
		Array.from(ids, async (id) => {
			try {
				return [id, await client.findByID("assets", id)] as const;
			} catch (error) {
				if (error instanceof CmsError && error.status === 404) return null;
				throw error;
			}
		})
	);
	return {
		...known,
		...Object.fromEntries(
			entries.filter((entry): entry is readonly [string, Asset] => entry !== null)
		),
	};
}

function hasThumbnail(asset: Asset): boolean {
	const sizes = asset.sizes;
	return typeof sizes === "object" && sizes !== null && "thumb" in sizes;
}

/**
 * Session-bound delivery URLs for private images, minted in one request. An `<img>` cannot send the
 * authorization header, so it loads signed URLs directly from the CMS instead.
 */
export async function imageURLs(
	client: QuikmarqClient,
	assets: Record<string, Asset>
): Promise<Record<string, string>> {
	const images = Object.values(assets);
	if (!images.length) return {};
	return client.signedAssetURLs(
		images.map((asset) => ({
			id: asset.id,
			...(hasThumbnail(asset) ? { size: "thumb" as const } : {}),
		}))
	);
}

export function validateImages(files: File[], existingImageCount = 0): string | null {
	if (files.length + existingImageCount > 4) return "Choose up to four images.";
	for (const file of files) {
		if (file.type !== "image/jpeg" && file.type !== "image/png")
			return "Only JPEG and PNG images are supported.";
		if (file.size > 4_000_000) return "Each image must be 4,000,000 bytes or less.";
	}
	return null;
}

export async function cleanupAssets(client: QuikmarqClient, ids: string[]): Promise<string[]> {
	const failed: string[] = [];
	for (const id of ids) {
		try {
			await client.delete("assets", id);
		} catch {
			failed.push(id);
		}
	}
	return failed;
}

export async function cloneMediaAssets(
	client: QuikmarqClient,
	bookmark: Bookmark,
	assets: Record<string, Asset>,
	destinationGroup: string
): Promise<string[]> {
	const originals = (bookmark.images ?? []).map((reference) =>
		typeof reference === "string" ? reference : reference.id
	);
	const clones: string[] = [];
	try {
		for (const id of originals) {
			const asset = assets[id] ?? (await client.findByID("assets", id));
			const copy = await client.duplicateAsset(id, {
				group: destinationGroup,
				alt: asset.alt ?? "",
			});
			clones.push(copy.id);
		}
		return clones;
	} catch (error) {
		const failed = await cleanupAssets(client, clones);
		if (failed.length)
			throw new Error(
				`${error instanceof Error ? error.message : "Image copy failed."} Some copied images could not be cleaned up.`
			);
		throw error;
	}
}

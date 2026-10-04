import { expect, test } from "bun:test";
import {
	CmsError,
	type Asset,
	type Bookmark,
	type QuikmarqClient,
} from "../../src/lib/quikmarq-client.ts";
import {
	assetMap,
	imageURLs,
	validateImages,
} from "../../src/lib/features/bookmarks/media-assets.ts";
import { publicAssetURL } from "../../src/lib/share.ts";

test("private image URLs are requested in one signed batch with thumbnails", async () => {
	const calls: unknown[] = [];
	const client = {
		signedAssetURLs: async (items: unknown) => {
			calls.push(items);
			return { one: "https://cms.example/signed/one", two: "https://cms.example/signed/two" };
		},
	} as unknown as QuikmarqClient;
	const assets = {
		one: { id: "one", sizes: { thumb: { filename: "one.webp" } } },
		two: { id: "two", sizes: null },
	} as unknown as Record<string, Asset>;
	expect(await imageURLs(client, assets)).toEqual({
		one: "https://cms.example/signed/one",
		two: "https://cms.example/signed/two",
	});
	expect(calls).toEqual([[{ id: "one", size: "thumb" }, { id: "two" }]]);
});

test("missing assets are skipped while service failures remain visible", async () => {
	const bookmarks = [{ images: ["missing"] }] as Bookmark[];
	const missing = {
		findByID: async () => {
			throw new CmsError("Missing", 404);
		},
	} as unknown as QuikmarqClient;
	expect(await assetMap(missing, bookmarks)).toEqual({});
	const failing = {
		findByID: async () => {
			throw new Error("Unavailable");
		},
	} as unknown as QuikmarqClient;
	await expect(assetMap(failing, bookmarks)).rejects.toThrow("Unavailable");
});

test("upload limits and public signed URL safety", () => {
	const file = new File(["image"], "cover.png", { type: "image/png" });
	expect(validateImages([file])).toBeNull();
	expect(validateImages(Array(5).fill(file))).toContain("four");
	expect(publicAssetURL("https://files.example/image?signature=x", "https://cms.example")).toBe(
		"https://files.example/image?signature=x"
	);
	expect(
		publicAssetURL("https://user:password@files.example/image", "https://cms.example")
	).toBeUndefined();
});

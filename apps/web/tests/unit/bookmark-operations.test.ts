import { expect, test } from "bun:test";
import {
	BookmarkSaveCancelled,
	moveBookmark,
	saveBookmark,
} from "../../src/lib/features/bookmarks/bookmark-operations.ts";
import type { Bookmark, Asset, QuikmarqClient } from "../../src/lib/quikmarq-client.ts";

const source = {
	id: "bookmark-1",
	group: "source",
	kind: "media",
	images: ["asset-1"],
	revision: 4,
} as Bookmark;
const assets = { "asset-1": { id: "asset-1", alt: "Cover" } as Asset };

test("moving media duplicates before a revision guarded update", async () => {
	const calls: unknown[][] = [];
	const client = {
		duplicateAsset: async (...args: unknown[]) => {
			calls.push(["duplicate", ...args]);
			return { id: "asset-copy" };
		},
		update: async (...args: unknown[]) => {
			calls.push(["update", ...args]);
			return source;
		},
	} as unknown as QuikmarqClient;

	await moveBookmark(client, source, "destination", assets);
	expect(calls).toEqual([
		["duplicate", "asset-1", { group: "destination", alt: "Cover" }],
		["update", "bookmarks", "bookmark-1", { group: "destination", images: ["asset-copy"] }, 4],
	]);
});

test("a conflicting media move compensates copied assets", async () => {
	const calls: unknown[][] = [];
	const conflict = new Error("Revision conflict");
	const client = {
		duplicateAsset: async () => ({ id: "asset-copy" }),
		update: async () => {
			throw conflict;
		},
		delete: async (...args: unknown[]) => {
			calls.push(args);
		},
	} as unknown as QuikmarqClient;
	await expect(moveBookmark(client, source, "destination", assets)).rejects.toBe(conflict);
	expect(calls).toEqual([["assets", "asset-copy"]]);
});

test("closing during upload prevents the parent write and cleans uploaded assets", async () => {
	const calls: string[] = [];
	let active = true;
	const client = {
		upload: async () => {
			calls.push("upload");
			active = false;
			return { id: "new-image" };
		},
		create: async () => {
			calls.push("create");
		},
		delete: async () => {
			calls.push("delete");
		},
	} as unknown as QuikmarqClient;
	await expect(
		saveBookmark(client, {
			source: null,
			groupId: "source",
			ownerId: "owner-1",
			kind: "media",
			fields: { caption: "Cover" },
			files: [new File(["image"], "cover.png", { type: "image/png" })],
			canContinue: () => active,
		})
	).rejects.toBeInstanceOf(BookmarkSaveCancelled);
	expect(calls).toEqual(["upload", "delete"]);
});

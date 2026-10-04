import { expect, test } from "bun:test";
import {
	addBookmark,
	editBookmark,
	removeBookmark,
} from "../../src/lib/features/bookmarks/bookmark-optimism.ts";
import type { BookmarksPageResult } from "../../src/lib/features/bookmarks/bookmarks.remote.ts";
import type { Bookmark } from "../../src/lib/features/bookmarks/bookmark-list.ts";

function bookmark(id: string, text: string): Bookmark {
	return {
		id,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		owner: "owner-1",
		group: "group-1",
		position: "0",
		revision: 1,
		kind: "text",
		text,
	};
}

function result(page = 1, query = ""): BookmarksPageResult {
	return {
		group: {
			id: "group-1",
			createdAt: "2026-01-01T00:00:00Z",
			updatedAt: "2026-01-01T00:00:00Z",
			owner: "owner-1",
			name: "Ideas",
			rank: "hzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
			revision: 1,
		},
		bookmarks: [bookmark("a", "Alpha"), bookmark("b", "Beta")],
		pagination: {
			page,
			limit: 2,
			totalDocs: 3,
			totalPages: 2,
			hasNextPage: page === 1,
			hasPrevPage: page > 1,
		},
		assets: {},
		images: {},
		query,
		kind: "",
		page,
	};
}

test("pending creation enters the first page and keeps pagination coherent", () => {
	const changed = addBookmark(result(), bookmark("pending", "New note"));
	expect(changed.bookmarks.map((entry) => entry.id)).toEqual(["pending", "a"]);
	expect(changed.pagination).toMatchObject({ totalDocs: 4, totalPages: 2, hasNextPage: true });
});

test("creation on a later page updates totals without inserting an incorrectly positioned row", () => {
	const changed = addBookmark(result(2), bookmark("pending", "New note"));
	expect(changed.bookmarks.map((entry) => entry.id)).toEqual(["a", "b"]);
	expect(changed.pagination.totalDocs).toBe(4);
});

test("filtered previews only change matching result counts", () => {
	const initial = {
		...result(1, "alpha"),
		bookmarks: [bookmark("a", "Alpha")],
		pagination: { ...result().pagination, totalDocs: 1, totalPages: 1, hasNextPage: false },
	};
	expect(addBookmark(initial, bookmark("pending", "Beta"))).toBe(initial);
	const changed = editBookmark(initial, bookmark("a", "Renamed"));
	expect(changed.bookmarks).toEqual([]);
	expect(changed.pagination.totalDocs).toBe(0);
});

test("deleting a visible row adjusts totals and the final page boundary", () => {
	const initial = result(2);
	const changed = removeBookmark(initial, "a");
	expect(changed.bookmarks.map((entry) => entry.id)).toEqual(["b"]);
	expect(changed.pagination).toMatchObject({ totalDocs: 2, totalPages: 1, hasNextPage: false });
});

test("independent pending transforms survive a refreshed base in either completion order", () => {
	const add = (value: BookmarksPageResult) => addBookmark(value, bookmark("pending", "New note"));
	const remove = (value: BookmarksPageResult) => removeBookmark(value, "a");
	const before = remove(add(result()));
	const refreshed = remove(
		add({ ...result(), bookmarks: [bookmark("a", "Alpha"), bookmark("b", "Beta")] })
	);
	expect(before.bookmarks.map((entry) => entry.id)).toEqual(
		refreshed.bookmarks.map((entry) => entry.id)
	);
	expect(before.pagination.totalDocs).toBe(3);
});

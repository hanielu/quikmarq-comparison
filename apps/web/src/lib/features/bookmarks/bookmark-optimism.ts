import type { BookmarksPageResult } from "./bookmarks.remote.ts";
import type { Bookmark, BookmarkKind } from "./bookmark-list.ts";

export function matchesBookmark(
	bookmark: Bookmark,
	query: string,
	kind: BookmarkKind | ""
): boolean {
	if (kind && bookmark.kind !== kind) return false;
	const term = query.trim().toLocaleLowerCase();
	if (!term) return true;
	return [bookmark.title, bookmark.url, bookmark.description, bookmark.text, bookmark.caption].some(
		(value) => value?.toLocaleLowerCase().includes(term)
	);
}

function withPagination(result: BookmarksPageResult, totalDocs: number) {
	const pagination = result.pagination;
	const totalPages = Math.max(1, Math.ceil(totalDocs / pagination.limit));
	return {
		...pagination,
		totalDocs,
		totalPages,
		hasNextPage: pagination.page < totalPages,
		hasPrevPage: pagination.page > 1,
	};
}

/** A page override remains valid when the remote query refreshes during a write. */
export function addBookmark(
	result: BookmarksPageResult,
	bookmark: Bookmark,
	images: Record<string, string> = {}
): BookmarksPageResult {
	if (!matchesBookmark(bookmark, result.query, result.kind)) return result;
	const alreadyListed = result.bookmarks.some((candidate) => candidate.id === bookmark.id);
	if (alreadyListed) return result;
	return {
		...result,
		bookmarks:
			result.page === 1
				? [bookmark, ...result.bookmarks].slice(0, result.pagination.limit)
				: result.bookmarks,
		pagination: withPagination(result, result.pagination.totalDocs + 1),
		images: { ...result.images, ...images },
	};
}

export function removeBookmark(result: BookmarksPageResult, id: string): BookmarksPageResult {
	if (!result.bookmarks.some((bookmark) => bookmark.id === id)) return result;
	return {
		...result,
		bookmarks: result.bookmarks.filter((bookmark) => bookmark.id !== id),
		pagination: withPagination(result, Math.max(0, result.pagination.totalDocs - 1)),
	};
}

export function editBookmark(
	result: BookmarksPageResult,
	bookmark: Bookmark,
	images: Record<string, string> = {}
): BookmarksPageResult {
	const listed = result.bookmarks.some((candidate) => candidate.id === bookmark.id);
	const matches = matchesBookmark(bookmark, result.query, result.kind);
	if (listed && !matches) return removeBookmark(result, bookmark.id);
	if (!listed) return matches ? addBookmark(result, bookmark, images) : result;
	return {
		...result,
		bookmarks: result.bookmarks.map((candidate) =>
			candidate.id === bookmark.id ? bookmark : candidate
		),
		images: { ...result.images, ...images },
	};
}

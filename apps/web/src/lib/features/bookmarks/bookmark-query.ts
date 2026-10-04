import { normalizeKind, normalizePage, type BookmarkKind } from "./bookmark-list";

export type BookmarkListRoute = { groupId: string } | { shareToken: string };

/** Build the private or shared bookmark list URL with the server's query bounds. */
export function bookmarkListURL(
	route: BookmarkListRoute,
	query: string,
	kind: BookmarkKind | "",
	page = 1
): string {
	const path =
		"groupId" in route
			? `/app/${encodeURIComponent(route.groupId)}`
			: `/share/${encodeURIComponent(route.shareToken)}`;
	const search = new URLSearchParams();
	const term = query.trim().slice(0, 120);
	const selectedKind = normalizeKind(kind);
	const boundedPage = normalizePage(String(page));

	if (term) search.set("q", term);
	if (selectedKind) search.set("kind", selectedKind);
	if (boundedPage > 1) search.set("page", String(boundedPage));

	return `${path}${search.size ? `?${search}` : ""}`;
}

import type {
	QuikmarqClient,
	Bookmark,
	Asset,
	BookmarkKind,
	Where,
} from "../../quikmarq-client.ts";

export type { Bookmark, Asset, BookmarkKind };
export type QuickDraft = {
	kind: BookmarkKind;
	url?: string;
	title?: string;
	text?: string;
	caption?: string;
};

export function normalizePage(value: string | null): number {
	const page = Number(value);
	return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10000) : 1;
}

export function normalizeKind(value: string | null): BookmarkKind | "" {
	return value === "link" || value === "text" || value === "media" ? value : "";
}

export function bookmarkWhere(groupId: string, query: string, kind: BookmarkKind | "") {
	const clauses: Where[] = [{ group: { equals: groupId } }];
	if (kind) clauses.push({ kind: { equals: kind } });
	const trimmed = query.trim().slice(0, 120);
	if (trimmed)
		clauses.push({
			or: [
				{ title: { contains: trimmed } },
				{ url: { contains: trimmed } },
				{ description: { contains: trimmed } },
				{ text: { contains: trimmed } },
				{ caption: { contains: trimmed } },
			],
		});
	return clauses.length === 1 ? clauses[0] : { and: clauses };
}

export async function listBookmarks(
	client: QuikmarqClient,
	groupId: string,
	query: string,
	kind: BookmarkKind | "",
	page: number
) {
	return client.find("bookmarks", {
		page,
		limit: 24,
		sort: "-position,-createdAt",
		where: bookmarkWhere(groupId, query, kind),
		depth: 1,
	});
}

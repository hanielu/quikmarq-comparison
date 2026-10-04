import { error } from "@sveltejs/kit";
import type { QuikmarqClient, BookmarkKind } from "#lib/quikmarq-client.ts";
import { listBookmarks } from "./bookmark-list.ts";
import { assetMap, imageURLs } from "./media-assets.ts";

export interface BookmarkPageInput {
	ownerId: string;
	groupId: string;
	query: string;
	kind: BookmarkKind | "";
	page: number;
}

export async function loadBookmarksPage(client: QuikmarqClient, input: BookmarkPageInput) {
	const matchingGroups = await client.find("groups", {
		page: 1,
		limit: 1,
		where: {
			and: [{ id: { equals: input.groupId } }, { owner: { equals: input.ownerId } }],
		},
	});
	const group = matchingGroups.docs[0];
	if (!group) error(404, "Group not found");

	const result = await listBookmarks(client, group.id, input.query, input.kind, input.page);
	const assets = await assetMap(client, result.docs);
	return {
		group,
		bookmarks: result.docs,
		pagination: result.pagination,
		assets,
		images: await imageURLs(client, assets),
		query: input.query,
		kind: input.kind,
		page: input.page,
	};
}

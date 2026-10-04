import { error } from "@sveltejs/kit";
import { getRequestEvent, query } from "$app/server";
import * as v from "valibot";
import { loadBookmarksPage } from "./bookmark-page-data.ts";

const inputSchema = v.object({
	ownerId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	groupId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	query: v.pipe(v.string(), v.maxLength(120)),
	kind: v.union([v.literal(""), v.literal("link"), v.literal("text"), v.literal("media")]),
	page: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10000)),
});

export type BookmarksPageResult = Awaited<ReturnType<typeof loadBookmarksPage>>;

export const bookmarksPage = query(inputSchema, async (input) => {
	const client = getRequestEvent().locals.cms;
	const session = await client.currentSession();
	if (!session || session.user.id !== input.ownerId) error(401, "Sign in to view these bookmarks.");
	return loadBookmarksPage(client, input);
});

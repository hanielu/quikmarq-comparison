import { normalizeKind, normalizePage } from "#lib/features/bookmarks/bookmark-list.ts";
import { loadBookmarksPage } from "#lib/features/bookmarks/bookmark-page-data.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, parent, url, locals }) => {
	const { user } = await parent();
	const page = normalizePage(url.searchParams.get("page"));
	const kind = normalizeKind(url.searchParams.get("kind"));
	const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
	const groupId = params.groupId;
	let initialPage: Awaited<ReturnType<typeof loadBookmarksPage>> | null = null;
	try {
		initialPage = await loadBookmarksPage(locals.cms, {
			ownerId: user.id,
			groupId,
			query,
			kind,
			page,
		});
	} catch {
		// Keep the existing inline query error and Retry action available when the
		// initial CMS read fails; the remote query will surface the actual failure.
	}
	return { groupId, query, kind, page, initialPage };
};

import { error } from "@sveltejs/kit";
import { normalizeKind, normalizePage } from "#lib/features/bookmarks/bookmark-list.ts";
import { EndpointError, resolveShare } from "#lib/custom-endpoints.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url, locals, setHeaders }) => {
	setHeaders({
		"cache-control": "private, no-store",
		"referrer-policy": "no-referrer",
		"x-robots-tag": "noindex, nofollow",
	});
	const page = normalizePage(url.searchParams.get("page"));
	const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
	const kind = normalizeKind(url.searchParams.get("kind"));
	let collection;
	try {
		collection = await resolveShare(locals.cms, {
			token: params.token,
			page,
			limit: 24,
			query,
			kind: kind || undefined,
		});
	} catch (failure) {
		if (failure instanceof EndpointError && (failure.status === 404 || failure.status === 403))
			error(404, "This shared collection is unavailable");
		if (failure instanceof EndpointError) error(failure.status, failure.message);
		error(502, "The shared collection returned an invalid response");
	}
	return { collection, query, kind, page };
};

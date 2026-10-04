import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, locals }) => {
	const { user } = await parent();
	const first = await locals.cms.find("groups", {
		page: 1,
		limit: 1,
		sort: "rank,createdAt",
		where: { owner: { equals: user.id } },
	});
	if (first.docs.length) redirect(303, `/app/${first.docs[0].id}`);
	return {};
};

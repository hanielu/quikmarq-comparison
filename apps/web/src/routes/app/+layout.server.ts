import { redirect } from "@sveltejs/kit";
import { AUTH_DEPENDENCY } from "#lib/auth-dependency.ts";
import { allGroups, countWorkspaceGroup } from "#lib/features/workspace/workspace-data.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, url, depends }) => {
	depends(AUTH_DEPENDENCY);
	const session = await locals.cms.currentSession();
	if (!session) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);

	const user = {
		id: session.user.id,
		email: session.user.email,
		displayName: session.user.displayName,
	};
	const groups = await allGroups(locals.cms, user.id);
	const countEntries: Array<readonly [string, number]> = [];
	for (let index = 0; index < groups.length; index += 12) {
		countEntries.push(
			...(await Promise.all(
				groups
					.slice(index, index + 12)
					.map(
						async (group) =>
							[group.id, await countWorkspaceGroup(locals.cms, user.id, group.id)] as const
					)
			))
		);
	}
	return { user, initialWorkspace: { groups }, initialCounts: Object.fromEntries(countEntries) };
};

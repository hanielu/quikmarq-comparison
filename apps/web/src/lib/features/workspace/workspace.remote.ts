import { error } from "@sveltejs/kit";
import { getRequestEvent, query } from "$app/server";
import * as v from "valibot";
import { WORKSPACE_COUNT_BATCH_LIMIT } from "#lib/features/workspace/workspace-count-batches.ts";
import { allGroups, countWorkspaceGroup } from "./workspace-data.ts";

const ownerIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(128));

async function loadWorkspaceGroups(ownerId: string) {
	const client = getRequestEvent().locals.cms;
	const session = await client.currentSession();
	if (!session || session.user.id !== ownerId) error(401, "Sign in to view this workspace.");

	const groups = await allGroups(client, ownerId);
	return { groups };
}

export type WorkspaceGroupsResult = Awaited<ReturnType<typeof loadWorkspaceGroups>>;

export const workspaceGroups = query(ownerIdSchema, loadWorkspaceGroups);

const countInputSchema = v.object({
	ownerId: ownerIdSchema,
	groupId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
});

export const workspaceGroupCount = query.batch(countInputSchema, async (inputs) => {
	if (inputs.length > WORKSPACE_COUNT_BATCH_LIMIT)
		error(413, "Too many group counts requested at once.");

	const client = getRequestEvent().locals.cms;
	const session = await client.currentSession();
	if (!session || inputs.some((input) => input.ownerId !== session.user.id))
		error(401, "Sign in to view this group.");

	const counts: number[] = [];
	for (let index = 0; index < inputs.length; index += 12) {
		counts.push(
			...(await Promise.all(
				inputs
					.slice(index, index + 12)
					.map((input) => countWorkspaceGroup(client, input.ownerId, input.groupId))
			))
		);
	}
	return (_input, index) => counts[index];
});

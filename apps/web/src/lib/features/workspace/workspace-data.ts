import type { QuikmarqClient } from "#lib/quikmarq-client.ts";

export async function allGroups(client: QuikmarqClient, ownerId: string) {
	const options = {
		page: 1,
		limit: 100,
		sort: "rank,createdAt",
		where: { owner: { equals: ownerId } },
	};
	const first = await client.find("groups", options);
	const groups = [...first.docs];
	for (let page = 2; page <= first.pagination.totalPages; page++) {
		const next = await client.find("groups", { ...options, page });
		groups.push(...next.docs);
	}
	return groups;
}

export function countWorkspaceGroup(client: QuikmarqClient, ownerId: string, groupId: string) {
	return client.count("bookmarks", {
		and: [{ group: { equals: groupId } }, { owner: { equals: ownerId } }],
	});
}

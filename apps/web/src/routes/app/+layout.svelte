<script lang="ts">
	import WorkspaceShell from "#lib/features/workspace/workspace-shell.svelte";
	import { groupActionsKey, type GroupActions } from "#lib/features/groups/group-actions.ts";
	import { setContext, type Snippet } from "svelte";
	import type { LayoutData } from "./$types";

	let { children, data }: { children: Snippet; data: LayoutData } = $props();
	let currentActions: GroupActions | undefined;
	let registeredOwner = $state<string | undefined>();
	const actions = () => {
		if (!currentActions) throw new Error("The signed-in workspace is not ready.");
		return currentActions;
	};

	setContext<GroupActions>(groupActionsKey, {
		get groups() {
			return actions().groups;
		},
		get counts() {
			return actions().counts;
		},
		get pendingGroupIds() {
			return actions().pendingGroupIds;
		},
		get busy() {
			return actions().busy;
		},
		create: () => actions().create(),
		rename: (id, name) => actions().rename(id, name),
		reorder: (id, direction) => actions().reorder(id, direction),
		remove: (id) => actions().remove(id),
		share: () => actions().share(),
		refreshWorkspace: () => actions().refreshWorkspace(),
		optimisticCounts: (deltas) => actions().optimisticCounts(deltas),
	});

	function registerActions(ownerId: string, next: GroupActions) {
		if (ownerId !== data.user.id) return;
		currentActions = next;
		registeredOwner = ownerId;
	}
</script>

{#key data.user.id}
	<WorkspaceShell
		ownerId={data.user.id}
		serverTheme={data.theme}
		initialWorkspace={data.initialWorkspace}
		initialCounts={data.initialCounts}
		{registerActions}
	>
		{#if registeredOwner === data.user.id}
			{@render children()}
		{/if}
	</WorkspaceShell>
{/key}

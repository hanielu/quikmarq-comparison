<script lang="ts">
	import { page } from "$app/state";
	import { onDestroy, type Snippet } from "svelte";
	import AccountMenu from "#lib/features/account/account-menu.svelte";
	import type { GroupActions } from "#lib/features/groups/group-actions.ts";
	import GroupDialog from "#lib/features/groups/group-dialog.svelte";
	import { GroupManager } from "#lib/features/groups/group-manager.svelte.ts";
	import ShareDialog from "#lib/features/sharing/share-dialog.svelte";
	import { ShareManager } from "#lib/features/sharing/share-manager.svelte.ts";
	import ShortcutsDialog from "#lib/features/workspace/shortcuts-dialog.svelte";
	import {
		workspaceGroupCount,
		workspaceGroups,
		type WorkspaceGroupsResult,
	} from "#lib/features/workspace/workspace.remote.ts";
	import { useCmsClient } from "#lib/cms.svelte.ts";

	let {
		ownerId,
		serverTheme,
		initialWorkspace,
		initialCounts,
		registerActions,
		children,
	}: {
		ownerId: string;
		serverTheme: "system" | "light" | "dark";
		initialWorkspace: WorkspaceGroupsResult;
		initialCounts: Record<string, number>;
		registerActions: (ownerId: string, actions: GroupActions) => void;
		children: Snippet;
	} = $props();
	const client = useCmsClient().api;
	// This component is keyed by account in the route layout.
	// svelte-ignore state_referenced_locally
	const workspace = workspaceGroups(ownerId);
	// Seed the remote cache with the server load snapshot before any reactive reads.
	// svelte-ignore state_referenced_locally
	workspace.set(initialWorkspace);

	const groups = new GroupManager({
		client,
		workspace,
		// The parent key recreates this controller when the account changes.
		// svelte-ignore state_referenced_locally
		ownerId,
		get selectedId() {
			return page.params.groupId;
		},
	});
	const sharing = new ShareManager({
		client,
		refreshWorkspace: groups.refreshWorkspace,
		get selectedId() {
			return page.params.groupId;
		},
	});

	let shortcutsOpen = $state(false);

	$effect(() => sharing.syncSelected(page.params.groupId));
	onDestroy(() => groups.dispose());

	// Registration belongs to this keyed shell's one-time setup.
	// svelte-ignore state_referenced_locally
	registerActions(ownerId, {
		get groups() {
			return groups.groups;
		},
		get counts() {
			return groups.counts;
		},
		get pendingGroupIds() {
			return groups.pendingGroupIds;
		},
		get busy() {
			return groups.busy;
		},
		create: groups.create,
		rename: groups.rename,
		reorder: groups.reorder,
		remove: groups.remove,
		share: sharing.open,
		refreshWorkspace: groups.refreshWorkspace,
		optimisticCounts: groups.optimisticCounts,
	});
	// The parent key recreates this shell for another owner; these are one-time SSR seeds.
	// svelte-ignore state_referenced_locally
	const countQueries = Object.fromEntries(
		initialWorkspace.groups.map((group) => [
			group.id,
			workspaceGroupCount({ ownerId, groupId: group.id }),
		])
	);
	// svelte-ignore state_referenced_locally
	for (const [id, query] of Object.entries(countQueries)) query.set(initialCounts[id] ?? 0);
	// svelte-ignore state_referenced_locally
	groups.initializeCounts(countQueries, initialCounts);
	const selected = $derived(
		(workspace.current ?? initialWorkspace).groups.find((group) => group.id === page.params.groupId)
	);

	async function handleKeydown(event: KeyboardEvent) {
		const target = event.target;
		const key = event.key.toLowerCase();
		const command = (event.metaKey || event.ctrlKey) && !event.altKey;

		if (command && key === "g") {
			event.preventDefault();
			groups.create();
			return;
		}
		if (command && key === "d" && selected) {
			event.preventDefault();
			await groups.remove(selected.id);
			return;
		}
		if (command && event.key === "/") {
			event.preventDefault();
			shortcutsOpen = true;
			return;
		}
		if (event.altKey && !event.metaKey && !event.ctrlKey && event.key === "/") {
			event.preventDefault();
			document.getElementById("bookmark-composer")?.focus();
			return;
		}
		if (event.key === "Escape") {
			shortcutsOpen = false;
			return;
		}
		if (
			!(target instanceof HTMLElement) ||
			target.closest('input, textarea, [contenteditable="true"]')
		)
			return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		if (event.key === "/") {
			event.preventDefault();
			const tools = document.getElementById("workspace-tools") as HTMLDetailsElement | null;
			if (tools) tools.open = true;
			requestAnimationFrame(() => document.getElementById("workspace-search")?.focus());
		}
		if (key === "n") {
			event.preventDefault();
			document.getElementById("bookmark-composer")?.focus();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />
<svelte:head>
	<title>{selected ? `${selected.name} — Quikmarq` : "Your space — Quikmarq"}</title>
</svelte:head>

<div class="app-shell compact-shell">
	<header class="app-topbar">
		<div class="app-header-inner">
			<div class="topbar-left"><a href="/app" class="brand">quikmarq</a></div>
			<div class="topbar-right">
				<AccountMenu
					{serverTheme}
					canShare={selected !== undefined}
					onShare={sharing.open}
					onShortcuts={() => (shortcutsOpen = true)}
				/>
			</div>
		</div>
	</header>
	<main class="workspace-main app-main">
		{#if groups.message && !groups.dialogOpen}
			<p role="alert" class="form-error">{groups.message}</p>
		{/if}
		{@render children()}
	</main>
</div>

<GroupDialog manager={groups} />
<ShareDialog manager={sharing} />
<ShortcutsDialog open={shortcutsOpen} onOpenChange={(open) => (shortcutsOpen = open)} />

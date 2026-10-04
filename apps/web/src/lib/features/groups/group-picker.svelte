<script lang="ts">
	import { DropdownMenu } from "bits-ui";
	import { Check, ChevronsUpDown, Folder, MoreHorizontal, Plus, Share2, X } from "lucide-svelte";
	import type { Group } from "./group-ranking.ts";
	import type { GroupActions } from "./group-actions.ts";

	let {
		groups,
		counts,
		selectedId,
		actions,
		pendingGroupIds = new Set<string>(),
	}: {
		groups: Group[];
		counts: Record<string, number>;
		selectedId: string;
		actions: GroupActions;
		pendingGroupIds?: ReadonlySet<string>;
	} = $props();
	let open = $state(false);
	const selected = $derived(groups.find((group) => group.id === selectedId));

	async function shareCurrentGroup() {
		open = false;
		await actions.share();
	}
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger class="group-selector-trigger" aria-label="Select group">
		<Folder size={17} />
		<span class="truncate">{selected?.name ?? "No group"}</span>
		<ChevronsUpDown size={14} />
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content class="menu-content group-menu" sideOffset={6} align="end">
			<div class="group-menu-header">
				<span>Groups</span>
				<button
					class="icon-button mobile-only"
					aria-label="Close navigation"
					onclick={() => (open = false)}
				>
					<X size={17} />
				</button>
			</div>
			<nav class="group-list" aria-label="Your groups" aria-busy={actions.busy}>
				{#each groups as group (group.id)}
					<div class={["group-row", { active: selectedId === group.id }]}>
						{#if pendingGroupIds.has(group.id)}
							<span class="group-pending" aria-label={`${group.name} is being created`}>
								<Folder size={16} />
								<span class="truncate">{group.name}</span>
								<span class="group-count">0</span>
							</span>
						{:else}
							<a href={`/app/${group.id}`} onclick={() => (open = false)}>
								<Folder size={16} />
								<span class="truncate">{group.name}</span>
								<span class="group-count">{counts[group.id] ?? 0}</span>
								{#if selectedId === group.id}<Check size={15} class="group-check" />{/if}
							</a>
						{/if}
						{#if !pendingGroupIds.has(group.id)}
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									class="icon-button group-more"
									aria-label={`Options for ${group.name}`}
									disabled={actions.busy}
								>
									<MoreHorizontal size={16} />
								</DropdownMenu.Trigger>
								<DropdownMenu.Portal>
									<DropdownMenu.Content class="menu-content" sideOffset={5} align="end">
										<DropdownMenu.Item
											onSelect={() => {
												open = false;
												actions.rename(group.id, group.name ?? "");
											}}
										>
											Rename
										</DropdownMenu.Item>
										<DropdownMenu.Item onSelect={() => actions.reorder(group.id, -1)}>
											Move up
										</DropdownMenu.Item>
										<DropdownMenu.Item onSelect={() => actions.reorder(group.id, 1)}>
											Move down
										</DropdownMenu.Item>
										<DropdownMenu.Item
											class="danger-text"
											onSelect={() => {
												open = false;
												void actions.remove(group.id);
											}}
										>
											Delete group
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Portal>
							</DropdownMenu.Root>
						{/if}
					</div>
				{/each}
			</nav>
			<button
				class="sidebar-add"
				disabled={actions.busy}
				onclick={() => {
					open = false;
					actions.create();
				}}
			>
				<Plus size={16} /> New group
			</button>
			<button class="sidebar-add group-share" disabled={actions.busy} onclick={shareCurrentGroup}>
				<Share2 size={16} /> Share this group
			</button>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>

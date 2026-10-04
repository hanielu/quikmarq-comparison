<script lang="ts">
	import { Dialog } from "bits-ui";
	import { Copy, X } from "lucide-svelte";
	import type { ShareManager } from "./share-manager.svelte";

	let { manager }: { manager: ShareManager } = $props();
</script>

<Dialog.Root bind:open={manager.dialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content class="dialog-content">
			<div class="dialog-heading">
				<div>
					<Dialog.Title>Share this group</Dialog.Title>
					<Dialog.Description>
						Anyone with the link can view these bookmarks. Editing stays private.
					</Dialog.Description>
				</div>
				<Dialog.Close class="icon-button" aria-label="Close dialog"><X size={19} /></Dialog.Close>
			</div>

			{#if manager.loading}
				<p class="muted" role="status">Loading sharing settings…</p>
			{:else if manager.status?.sharingEnabled && manager.status.token}
				<div class="share-link">
					<input readonly aria-label="Share URL" value={manager.url} />
					<button class="button button-outline" onclick={manager.copy}>
						<Copy size={16} /> Copy
					</button>
				</div>
				<div class="dialog-actions space-between">
					<button
						class="button button-quiet danger-text"
						disabled={manager.busy}
						onclick={() => manager.change("DELETE")}
					>
						Turn off sharing
					</button>
					<button
						class="button button-outline"
						disabled={manager.busy}
						onclick={() => manager.change("POST", true)}
					>
						Create new link
					</button>
				</div>
			{:else if manager.status}
				<p class="muted">This group is private. Turn on sharing to create a read-only link.</p>
				<div class="dialog-actions">
					<button
						class="button button-primary"
						disabled={manager.busy}
						onclick={() => manager.change("POST")}
					>
						Turn on sharing
					</button>
				</div>
			{/if}

			{#if manager.message}
				<p role="status" class="form-message">{manager.message}</p>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

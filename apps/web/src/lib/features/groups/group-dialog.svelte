<script lang="ts">
	import { Dialog } from "bits-ui";
	import { X } from "lucide-svelte";
	import type { GroupManager } from "./group-manager.svelte.ts";

	let { manager }: { manager: GroupManager } = $props();
</script>

<Dialog.Root bind:open={manager.dialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content class="dialog-content">
			<div class="dialog-heading">
				<div>
					<Dialog.Title>{manager.editingId ? "Rename group" : "Create a group"}</Dialog.Title>
					<Dialog.Description>Give this collection a name that feels right.</Dialog.Description>
				</div>
				<Dialog.Close class="icon-button" aria-label="Close dialog"><X size={19} /></Dialog.Close>
			</div>

			<form onsubmit={manager.save} class="form-stack">
				<label>
					Group name
					<input bind:value={manager.name} required maxlength="80" placeholder="e.g. Inspiration" />
				</label>

				{#if manager.message}
					<p role="alert" class="form-error">{manager.message}</p>
				{/if}

				<div class="dialog-actions">
					<Dialog.Close class="button button-quiet" type="button">Cancel</Dialog.Close>
					<button class="button button-primary" disabled={manager.busy}>
						{manager.editingId ? "Save name" : "Create group"}
					</button>
				</div>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

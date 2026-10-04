<script lang="ts">
	import { Dialog } from "bits-ui";
	import { X } from "lucide-svelte";

	let { open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void } = $props();
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content class="dialog-content">
			<div class="dialog-heading">
				<div>
					<Dialog.Title>Keyboard shortcuts</Dialog.Title>
					<Dialog.Description>
						Move through your space without reaching for the mouse.
					</Dialog.Description>
				</div>
				<Dialog.Close class="icon-button" aria-label="Close shortcuts">
					<X size={19} />
				</Dialog.Close>
			</div>

			<dl class="shortcut-list">
				<div>
					<dt>New group</dt>
					<dd>⌘/Ctrl + G</dd>
				</div>
				<div>
					<dt>Delete current group</dt>
					<dd>⌘/Ctrl + D</dd>
				</div>
				<div>
					<dt>Show shortcuts</dt>
					<dd>⌘/Ctrl + /</dd>
				</div>
				<div>
					<dt>Add bookmark</dt>
					<dd>Alt + /</dd>
				</div>
				<div>
					<dt>Search</dt>
					<dd>/</dd>
				</div>
				<div>
					<dt>Close or clear</dt>
					<dd>Escape</dd>
				</div>
			</dl>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

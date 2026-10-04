<script lang="ts">
	import { onDestroy } from "svelte";
	import { Image as ImageIcon, LoaderCircle, MoreHorizontal, Plus, X } from "lucide-svelte";
	import { errorMessage } from "#lib/error-message.ts";
	import { useCmsClient } from "#lib/cms.svelte.ts";
	import { bookmarkMetadata, EndpointError } from "#lib/custom-endpoints.ts";
	import type { Bookmark, BookmarkKind, QuickDraft } from "./bookmark-list.ts";
	import { BookmarkSaveCancelled, saveBookmark, type BookmarkSave } from "./bookmark-operations.ts";
	import { looksLikeBookmarkURL, normalizeBookmarkURL } from "./bookmark-url.ts";
	import { validateImages } from "./media-assets.ts";
	import type { BookmarkFields } from "#lib/quikmarq-client.ts";

	interface Preview {
		file: File;
		url: string;
	}

	interface Props {
		groupId: string;
		ownerId: string;
		disabled?: boolean;
		onpending: (input: BookmarkSave) => {
			commit(saved: Bookmark): Promise<void>;
			rollback(): void;
		};
		onmanual: (draft: QuickDraft) => void;
		onadvanced: (draft: QuickDraft | null, files: File[]) => void;
	}

	let { groupId, ownerId, disabled = false, onpending, onmanual, onadvanced }: Props = $props();
	const client = useCmsClient().api;
	let value = $state("");
	let previews = $state<Preview[]>([]);
	let busy = $state(false);
	let message = $state("");
	let dragging = $state(false);
	let active = true;

	onDestroy(() => {
		active = false;
		for (const preview of previews) URL.revokeObjectURL(preview.url);
	});

	function clear() {
		for (const preview of previews) URL.revokeObjectURL(preview.url);
		previews = [];
		value = "";
		message = "";
	}

	function queueFiles(incoming: File[]) {
		if (!incoming.length) return;

		const validation = validateImages([...previews.map((preview) => preview.file), ...incoming]);
		if (validation) {
			message = validation;
			return;
		}

		previews = [...previews, ...incoming.map((file) => ({ file, url: URL.createObjectURL(file) }))];
		message = "";
	}

	function pickFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		queueFiles(Array.from(input.files ?? []));
		input.value = "";
	}

	function pasteFiles(event: ClipboardEvent) {
		const files = Array.from(event.clipboardData?.files ?? []);
		if (!files.length) return;
		event.preventDefault();
		queueFiles(files);
	}

	function dragOver(event: DragEvent) {
		event.preventDefault();
		dragging = true;
	}

	function dropFiles(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		queueFiles(Array.from(event.dataTransfer?.files ?? []));
	}

	function removeFile(index: number) {
		URL.revokeObjectURL(previews[index].url);
		previews = previews.filter((_, candidate) => candidate !== index);
	}

	function openDetailedEditor() {
		if (disabled) return;
		const content = value.trim();
		const files = previews.map((preview) => preview.file);

		try {
			const draft: QuickDraft | null = files.length
				? { kind: "media", caption: content }
				: looksLikeBookmarkURL(content)
					? { kind: "link", url: normalizeBookmarkURL(content) }
					: content
						? { kind: "text", text: content }
						: null;
			onadvanced(draft, files);
		} catch (error) {
			message = error instanceof Error ? error.message : "This link is not valid.";
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || disabled) return;

		const content = value.trim();
		const selectedFiles = previews.map((preview) => preview.file);
		const destinationGroupID = groupId;
		const owner = ownerId;
		if (!content && !selectedFiles.length) return;

		busy = true;
		message = "";
		let pending: ReturnType<Props["onpending"]> | undefined;

		try {
			let kind: BookmarkKind;
			let fields: BookmarkFields;

			if (selectedFiles.length) {
				kind = "media";
				fields = { caption: content };
			} else if (looksLikeBookmarkURL(content)) {
				kind = "link";
				const url = normalizeBookmarkURL(content);
				let metadata;

				try {
					metadata = await bookmarkMetadata(client, url);
				} catch (error) {
					if (error instanceof EndpointError && [401, 403].includes(error.status)) throw error;
					// A preview failure can be completed manually, but an auth failure cannot.
					if (active) onmanual({ kind: "link", url, title: new URL(url).hostname });
					return;
				}

				fields = {
					url: metadata.normalizedURL,
					title: metadata.title || new URL(url).hostname,
					description: metadata.description,
					favicon: metadata.favicon,
					previewImage: metadata.previewImage,
					videoProvider: metadata.videoProvider,
					videoID: metadata.videoID,
				};
			} else {
				kind = "text";
				fields = { text: content };
			}

			const input: BookmarkSave = {
				source: null,
				groupId: destinationGroupID,
				ownerId: owner,
				kind,
				fields,
				files: selectedFiles,
				canContinue: () => active,
			};
			pending = onpending(input);
			const saved = await saveBookmark(client, input);
			await pending.commit(saved);
		} catch (error) {
			pending?.rollback();
			if (active && !(error instanceof BookmarkSaveCancelled)) message = errorMessage(error);
			return;
		} finally {
			if (active) busy = false;
		}

		if (active) clear();
	}

	function handleEscape(event: KeyboardEvent) {
		if (event.key !== "Escape" || !previews.length) return;
		event.preventDefault();
		clear();
	}
</script>

<div
	class={["quick-composer", { dragging }]}
	role="group"
	aria-label="Quick add"
	ondragover={dragOver}
	ondragleave={() => (dragging = false)}
	ondrop={dropFiles}
>
	{#if previews.length}
		<div class="composer-previews" aria-label="Selected images">
			{#each previews as preview, index (preview.url)}
				<div class="composer-preview">
					<img src={preview.url} alt={preview.file.name} />
					<button
						type="button"
						aria-label={`Remove ${preview.file.name}`}
						onclick={() => removeFile(index)}
					>
						<X size={14} />
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<form class="composer" onsubmit={submit} onpaste={pasteFiles}>
		<input
			id="bookmark-composer"
			bind:value
			aria-label="Add a bookmark"
			placeholder="Insert a link, image, or plain text"
			maxlength="10000"
			onkeydown={handleEscape}
		/>
		<label class="composer-attach" title="Choose images" aria-label="Choose images">
			<ImageIcon size={18} />
			<input
				type="file"
				accept="image/jpeg,image/png"
				multiple
				onchange={pickFiles}
				aria-label="Choose images"
			/>
		</label>
		<button
			type="button"
			class="composer-advanced"
			aria-label="Detailed editor"
			title="Detailed editor"
			disabled={busy || disabled}
			onclick={openDetailedEditor}
		>
			<MoreHorizontal size={17} />
		</button>
		<button
			type="submit"
			class="composer-add"
			disabled={busy || disabled || (!value.trim() && !previews.length)}
		>
			{#if busy}
				<LoaderCircle size={16} class="spin" />
			{:else}
				<Plus size={16} />
			{/if}
			{busy ? "Saving…" : "Add"}
		</button>
	</form>

	{#if message}
		<p class="composer-error" role="alert">{message}</p>
	{/if}
</div>

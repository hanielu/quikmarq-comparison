<script lang="ts">
	import { onDestroy } from "svelte";
	import {
		FileText,
		Image as ImageIcon,
		Link2,
		LoaderCircle,
		WandSparkles,
		X,
	} from "lucide-svelte";
	import { errorMessage } from "#lib/error-message.ts";
	import { useCmsClient } from "#lib/cms.svelte.ts";
	import { bookmarkMetadata } from "#lib/custom-endpoints.ts";
	import type { Bookmark, BookmarkKind, QuickDraft } from "./bookmark-list.ts";
	import { BookmarkSaveCancelled, saveBookmark, type BookmarkSave } from "./bookmark-operations.ts";
	import { normalizeBookmarkURL } from "./bookmark-url.ts";
	import { validateImages } from "./media-assets.ts";
	import type { BookmarkFields } from "#lib/quikmarq-client.ts";

	interface Props {
		bookmark: Bookmark | null;
		draft?: QuickDraft | null;
		groupId: string;
		ownerId: string;
		files?: File[];
		saving?: boolean;
		onpending: (input: BookmarkSave) => {
			commit(saved: Bookmark): Promise<void>;
			rollback(): void;
		};
		ondone: () => void;
	}

	let {
		bookmark,
		draft = null,
		groupId,
		ownerId,
		ondone,
		onpending,
		files = $bindable([]),
		saving = $bindable(false),
	}: Props = $props();
	const client = useCmsClient().api;

	function initialForm(source: Bookmark | null, quickDraft: QuickDraft | null) {
		return {
			kind: (source?.kind ?? quickDraft?.kind ?? "link") as BookmarkKind,
			url: source?.url ?? quickDraft?.url ?? "",
			title: source?.title ?? quickDraft?.title ?? "",
			description: source?.description ?? "",
			favicon: source?.favicon ?? "",
			previewImage: source?.previewImage ?? "",
			videoProvider: source?.videoProvider ?? "",
			videoID: source?.videoID ?? "",
			text: source?.text ?? quickDraft?.text ?? "",
			caption: source?.caption ?? quickDraft?.caption ?? "",
			imageIDs: (source?.images ?? []).map((image) =>
				typeof image === "string" ? image : image.id
			),
		};
	}

	// The parent keys this editor for each open action. Its form intentionally
	// captures initial props instead of overwriting someone's in-progress edits.
	// svelte-ignore state_referenced_locally
	let form = $state(initialForm(bookmark, draft));

	let dragging = $state(false);
	let metadataBusy = $state(false);
	let message = $state("");
	let metadataGeneration = 0;
	let active = true;

	onDestroy(() => {
		active = false;
		metadataGeneration++;
	});

	async function getMetadata() {
		const generation = ++metadataGeneration;
		const before = { ...form };
		metadataBusy = true;
		message = "";

		try {
			const metadata = await bookmarkMetadata(client, normalizeBookmarkURL(before.url));
			if (!active || generation !== metadataGeneration || form.url !== before.url) return;

			form.url = metadata.normalizedURL;
			if (form.title === before.title) form.title = metadata.title || form.title;
			if (form.description === before.description)
				form.description = metadata.description || form.description;
			if (form.favicon === before.favicon) form.favicon = metadata.favicon || form.favicon;
			if (form.previewImage === before.previewImage)
				form.previewImage = metadata.previewImage || form.previewImage;
			if (form.videoProvider === before.videoProvider)
				form.videoProvider = metadata.videoProvider || form.videoProvider;
			if (form.videoID === before.videoID) form.videoID = metadata.videoID || form.videoID;
		} catch (error) {
			if (active && generation === metadataGeneration) message = errorMessage(error);
		} finally {
			if (active && generation === metadataGeneration) metadataBusy = false;
		}
	}

	function queueFiles(incoming: File[]) {
		if (!incoming.length) return;

		const selection = [...files, ...incoming];
		const validation = validateImages(selection, form.imageIDs.length);
		if (validation) {
			message = validation;
			return;
		}

		files = selection;
		message = "";
	}

	function addFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		queueFiles(Array.from(input.files ?? []));
		input.value = "";
	}

	function pasteFiles(event: ClipboardEvent) {
		if (form.kind !== "media" || !event.clipboardData?.files.length) return;
		event.preventDefault();
		queueFiles(Array.from(event.clipboardData.files));
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

	function bookmarkFields(values: typeof form): BookmarkFields {
		switch (values.kind) {
			case "link":
				return {
					url: normalizeBookmarkURL(values.url),
					title: values.title.trim(),
					description: values.description.trim(),
					favicon: values.favicon.trim(),
					previewImage: values.previewImage.trim(),
					videoProvider: values.videoProvider.trim(),
					videoID: values.videoID.trim(),
				};
			case "text":
				return { text: values.text.trim() };
			case "media":
				return { caption: values.caption.trim() };
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;

		const values = { ...form, imageIDs: [...form.imageIDs] };
		const selectedFiles = [...files];
		const sourceBookmark = bookmark;
		const destinationGroupID = groupId;
		const owner = ownerId;

		saving = true;
		message = "";
		let pending: ReturnType<Props["onpending"]> | undefined;

		try {
			const input: BookmarkSave = {
				source: sourceBookmark,
				groupId: destinationGroupID,
				ownerId: owner,
				kind: values.kind,
				fields: bookmarkFields(values),
				imageIDs: values.imageIDs,
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
			if (active) saving = false;
		}

		if (active) ondone();
	}
</script>

<form class="editor-form" onsubmit={save} onpaste={pasteFiles}>
	<div class="editor-tabs" aria-label="Bookmark type">
		<button
			type="button"
			class={{ active: form.kind === "link" }}
			disabled={!!bookmark}
			onclick={() => (form.kind = "link")}
		>
			<Link2 size={16} /> Link
		</button>
		<button
			type="button"
			class={{ active: form.kind === "text" }}
			disabled={!!bookmark}
			onclick={() => (form.kind = "text")}
		>
			<FileText size={16} /> Note
		</button>
		<button
			type="button"
			class={{ active: form.kind === "media" }}
			disabled={!!bookmark}
			onclick={() => (form.kind = "media")}
		>
			<ImageIcon size={16} /> Images
		</button>
	</div>

	{#if form.kind === "link"}
		<div class="form-stack">
			<label>
				URL
				<div class="input-with-action">
					<input
						bind:value={form.url}
						type="text"
						inputmode="url"
						required
						placeholder="https://example.com/article"
					/>
					<button
						type="button"
						class="button button-outline"
						disabled={metadataBusy || !form.url.trim()}
						onclick={getMetadata}
					>
						{#if metadataBusy}
							<LoaderCircle size={16} class="spin" />
						{:else}
							<WandSparkles size={16} />
						{/if}
						Preview
					</button>
				</div>
			</label>
			<label>
				Title
				<input bind:value={form.title} maxlength="200" placeholder="Give this link a name" />
			</label>
			<label>
				Description
				<textarea
					bind:value={form.description}
					rows="3"
					maxlength="1000"
					placeholder="What makes it worth keeping?"></textarea>
			</label>
		</div>
	{:else if form.kind === "text"}
		<div class="form-stack">
			<label>
				Your note
				<textarea
					bind:value={form.text}
					rows="8"
					required
					maxlength="10000"
					placeholder="Write something you want to remember…"></textarea>
			</label>
		</div>
	{:else}
		<div class="form-stack">
			<div
				class={["media-dropzone", { dragging }]}
				role="group"
				aria-label="Add images"
				ondragover={dragOver}
				ondragleave={() => (dragging = false)}
				ondrop={dropFiles}
			>
				<label>
					Images <span class="muted">(up to 4 JPEG or PNG, 4 MB each)</span>
					<input type="file" accept="image/jpeg,image/png" multiple onchange={addFiles} />
				</label>
				<p>Choose files, paste images, or drop them here.</p>
			</div>

			{#if form.imageIDs.length || files.length}
				<div class="selected-files">
					{#each form.imageIDs as id (id)}
						<span>
							Saved image <button
								type="button"
								aria-label="Remove saved image"
								onclick={() =>
									(form.imageIDs = form.imageIDs.filter((candidate) => candidate !== id))}
							>
								<X size={14} />
							</button>
						</span>
					{/each}
					{#each files as file, index}
						<span>
							{file.name}
							<button
								type="button"
								aria-label={`Remove ${file.name}`}
								onclick={() => (files = files.filter((_, candidate) => candidate !== index))}
							>
								<X size={14} />
							</button>
						</span>
					{/each}
				</div>
			{/if}

			<label>
				Caption
				<textarea
					bind:value={form.caption}
					rows="3"
					maxlength="1000"
					placeholder="A note about these images"></textarea>
			</label>
		</div>
	{/if}

	{#if message}
		<p class="form-error" role="alert">{message}</p>
	{/if}
	<div class="dialog-actions">
		<button type="submit" class="button button-primary" disabled={saving}>
			{saving ? "Saving…" : bookmark ? "Save changes" : "Add bookmark"}
		</button>
	</div>
</form>

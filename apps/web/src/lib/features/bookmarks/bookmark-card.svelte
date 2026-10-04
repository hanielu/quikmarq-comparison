<script lang="ts">
	import { DropdownMenu } from "bits-ui";
	import {
		ArrowUpRight,
		Copy,
		FileText,
		Image as ImageIcon,
		Link2,
		MoreHorizontal,
		MoveRight,
		Pencil,
		Trash2,
	} from "lucide-svelte";
	import type { Asset, Bookmark } from "./bookmark-list.ts";
	import { bookmarkDisplayLink } from "./bookmark-url.ts";
	import type { Group } from "#lib/features/groups/group-ranking.ts";

	interface Props {
		bookmark: Bookmark;
		assets: Record<string, Asset>;
		/** Short-lived delivery URLs for private images, keyed by asset ID. */
		images: Record<string, string>;
		groups: Group[];
		busy: boolean;
		onedit: () => void;
		ondelete: () => void | Promise<void>;
		onmove: (groupID: string) => void | Promise<void>;
		oncopy: (groupID: string) => void | Promise<void>;
	}

	let { bookmark, assets, images, groups, busy, onedit, ondelete, onmove, oncopy }: Props =
		$props();

	const link = $derived(bookmarkDisplayLink(bookmark.url));
	const currentGroupID = $derived(bookmark.group);
	const imageCount = $derived(bookmark.images?.length ?? 0);
	const typeLabel = $derived(
		bookmark.kind === "link" ? "Link" : bookmark.kind === "text" ? "Note" : "Image"
	);
</script>

<article
	class={[
		"bookmark-card",
		"bookmark-row",
		{
			"bookmark-kind-link": bookmark.kind === "link",
			"bookmark-kind-text": bookmark.kind === "text",
			"bookmark-kind-media": bookmark.kind === "media",
		},
	]}
>
	<span class="bookmark-row-icon">
		{#if bookmark.kind === "link"}
			{#if bookmark.favicon}
				<img src={bookmark.favicon} alt="" loading="lazy" />
			{:else}
				<Link2 size={19} />
			{/if}
		{:else if bookmark.kind === "text"}
			<FileText size={19} />
		{:else}
			<ImageIcon size={19} />
		{/if}
	</span>

	{#if bookmark.kind === "link"}
		<div class="bookmark-body bookmark-row-content">
			<h2>{bookmark.title || bookmark.url || "Untitled link"}</h2>
			{#if link}
				<a class="domain" href={link.href} target="_blank" rel="noopener noreferrer">
					{link.hostname}
				</a>
			{/if}
			{#if bookmark.description}
				<p class="card-description">{bookmark.description}</p>
			{/if}
		</div>
		{#if bookmark.previewImage}
			<div class="card-cover bookmark-row-media">
				<img src={bookmark.previewImage} alt="" loading="lazy" />
			</div>
		{/if}
		{#if link}
			<a
				class="card-open"
				href={link.href}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={`Open ${bookmark.title || link.href}`}
			>
				<ArrowUpRight size={18} />
			</a>
		{/if}
	{:else if bookmark.kind === "text"}
		<div class="bookmark-body bookmark-row-content text-bookmark">
			<p>{bookmark.text}</p>
			<span class="card-bottom muted">Saved note</span>
		</div>
	{:else}
		<div class="bookmark-body bookmark-row-content">
			<p class="card-description">
				{bookmark.caption || `${imageCount} saved ${imageCount === 1 ? "image" : "images"}`}
			</p>
		</div>
		<div class={["media-grid", "bookmark-row-media", { many: imageCount > 1 }]}>
			{#each bookmark.images ?? [] as reference}
				{const id = $derived(typeof reference === "string" ? reference : reference.id)}
				{const imageURL = $derived(images[id])}
				<div class="media-tile">
					{#if imageURL}
						<img
							src={imageURL}
							alt={assets[id]?.alt || bookmark.caption || "Saved image"}
							loading="lazy"
						/>
					{:else}
						<ImageIcon size={25} />
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<div class="bookmark-card-top bookmark-row-actions">
		<span class="type-label">{typeLabel}</span>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class="icon-button" aria-label="Bookmark options" disabled={busy}>
				<MoreHorizontal size={18} />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content class="menu-content" align="end" sideOffset={5}>
					<DropdownMenu.Item onSelect={onedit}><Pencil size={15} /> Edit</DropdownMenu.Item>
					{#each groups as group (group.id)}
						{#if group.id !== currentGroupID}
							<DropdownMenu.Item onSelect={() => onmove(group.id)}>
								<MoveRight size={15} /> Move to {group.name}
							</DropdownMenu.Item>
						{/if}
						<DropdownMenu.Item onSelect={() => oncopy(group.id)}>
							<Copy size={15} /> Copy to {group.name}
						</DropdownMenu.Item>
					{/each}
					<DropdownMenu.Separator class="menu-separator" />
					<DropdownMenu.Item class="danger-text" onSelect={ondelete}>
						<Trash2 size={15} /> Delete
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	</div>
</article>

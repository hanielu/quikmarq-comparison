<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import {
		ArrowUpRight,
		ChevronLeft,
		ChevronRight,
		FileText,
		Image as ImageIcon,
		Link2,
	} from "lucide-svelte";
	import { errorMessage } from "#lib/error-message.ts";
	import { cmsURL } from "#lib/cms-config.ts";
	import { bookmarkListURL } from "#lib/features/bookmarks/bookmark-query.ts";
	import { publicAssetURL } from "#lib/share.ts";
	import BookmarkFilters from "#lib/features/bookmarks/bookmark-filters.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
	let navigationError = $state("");

	async function navigatePage(targetPage: number) {
		try {
			await goto(
				bookmarkListURL({ shareToken: page.params.token ?? "" }, data.query, data.kind, targetPage)
			);
			navigationError = "";
		} catch (error) {
			navigationError = errorMessage(error);
		}
	}
</script>

<svelte:head>
	<title>{data.collection.group.name} — shared on Quikmarq</title>
	<meta name="robots" content="noindex,nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="shared-shell">
	<header class="shared-header">
		<div class="shared-header-inner">
			<a class="brand public-brand" href="/">quikmarq</a>
			<span class="shared-badge">Read-only collection</span>
		</div>
	</header>

	<main class="shared-main shared-collection">
		<div class="shared-hero">
			<p class="eyebrow">SHARED WITH YOU</p>
			<h1>{data.collection.group.name}</h1>
			<p>
				A few things worth passing along. {data.collection.pagination.totalDocs}
				{data.collection.pagination.totalDocs === 1 ? "bookmark" : "bookmarks"}.
			</p>
		</div>

		<BookmarkFilters
			route={{ shareToken: page.params.token ?? "" }}
			appliedQuery={data.query}
			appliedKind={data.kind}
			searchId="shared-search"
			placeholder="Search this collection…"
			searchLabel="Search shared bookmarks"
		/>

		{#if navigationError}<p class="form-error" role="alert">{navigationError}</p>{/if}

		{#if data.collection.docs.length}
			<div class="bookmarks-grid shared-bookmarks">
				{#each data.collection.docs as bookmark (bookmark.id)}
					<article class="bookmark-card public-card">
						<div class="bookmark-card-top">
							<span class="type-label">
								{#if bookmark.kind === "link"}
									<Link2 size={14} /> Link
								{:else if bookmark.kind === "text"}
									<FileText size={14} /> Note
								{:else}
									<ImageIcon size={14} /> Image
								{/if}
							</span>
						</div>

						{#if bookmark.kind === "link"}
							{#if bookmark.previewImage}
								<div class="card-cover">
									<img src={bookmark.previewImage} alt="" loading="lazy" />
								</div>
							{/if}
							<div class="bookmark-body">
								<h2>{bookmark.title || bookmark.url || "Untitled link"}</h2>
								{#if bookmark.description}<p class="card-description">
										{bookmark.description}
									</p>{/if}
								{#if bookmark.url}
									<a
										class="public-link"
										href={bookmark.url}
										rel="noopener noreferrer"
										target="_blank"
									>
										Visit link <ArrowUpRight size={16} />
									</a>
								{/if}
							</div>
						{:else if bookmark.kind === "text"}
							<div class="bookmark-body text-bookmark"><p>{bookmark.text}</p></div>
						{:else}
							<div class={["media-grid", { many: bookmark.images.length > 1 }]}>
								{#each bookmark.images as image (image.id)}
									<div class="media-tile">
										<img
											src={publicAssetURL(image.thumbnailURL || image.url, cmsURL)}
											alt={image.alt || bookmark.caption || "Shared image"}
											loading="lazy"
										/>
									</div>
								{/each}
							</div>
							{#if bookmark.caption}
								<div class="bookmark-body"><p class="card-description">{bookmark.caption}</p></div>
							{/if}
						{/if}
					</article>
				{/each}
			</div>
		{:else}
			<div class="empty-list">
				<h2>Nothing to show here.</h2>
				<p>Try another search or bookmark type.</p>
			</div>
		{/if}

		{#if data.collection.pagination.totalPages > 1}
			<nav class="pagination" aria-label="Shared bookmark pages">
				<button
					class="button button-outline"
					disabled={!data.collection.pagination.hasPrevPage}
					onclick={() => navigatePage(data.page - 1)}
				>
					<ChevronLeft size={16} /> Previous
				</button>
				<span>Page {data.page} of {data.collection.pagination.totalPages}</span>
				<button
					class="button button-outline"
					disabled={!data.collection.pagination.hasNextPage}
					onclick={() => navigatePage(data.page + 1)}
				>
					Next <ChevronRight size={16} />
				</button>
			</nav>
		{/if}
	</main>

	<footer class="shared-footer">
		Curated with <a href="/">Quikmarq</a>
	</footer>
</div>

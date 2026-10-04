<script lang="ts">
	import { goto } from "$app/navigation";
	import { onDestroy } from "svelte";
	import { Search } from "lucide-svelte";
	import { errorMessage } from "#lib/error-message.ts";
	import { bookmarkListURL, type BookmarkListRoute } from "./bookmark-query.ts";
	import type { BookmarkKind } from "./bookmark-list.ts";

	interface Props {
		route: BookmarkListRoute;
		appliedQuery: string;
		appliedKind: BookmarkKind | "";
		searchId: string;
		placeholder: string;
		searchLabel: string;
	}

	let { route, appliedQuery, appliedKind, searchId, placeholder, searchLabel }: Props = $props();
	// Draft controls capture the first URL state; later navigation is synced below.
	// svelte-ignore state_referenced_locally
	let query = $state(appliedQuery);
	// svelte-ignore state_referenced_locally
	let kind = $state(appliedKind);
	let message = $state("");
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let appliedURL = "";

	// URL navigation is external state. Ignore same-URL data refreshes so they do
	// not erase text someone is currently typing into the search input.
	$effect(() => {
		const nextAppliedURL = bookmarkListURL(route, appliedQuery, appliedKind);
		if (nextAppliedURL === appliedURL) return;

		appliedURL = nextAppliedURL;
		clearTimeout(searchTimer);
		query = appliedQuery;
		kind = appliedKind;
		message = "";
	});

	onDestroy(() => clearTimeout(searchTimer));

	async function navigateToFilters() {
		clearTimeout(searchTimer);
		const target = bookmarkListURL(route, query, kind);
		if (target === location.pathname + location.search) return;

		try {
			await goto(target, { replace: true, reset: false });
			message = "";
		} catch (error) {
			message = errorMessage(error);
		}
	}

	function scheduleSearch() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(navigateToFilters, 300);
	}

	async function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		await navigateToFilters();
	}

	async function handleSearchKeydown(event: KeyboardEvent) {
		if (event.key !== "Escape" || !query) return;
		event.preventDefault();
		event.stopPropagation();
		query = "";
		await navigateToFilters();
	}

	async function selectKind(next: BookmarkKind | "") {
		kind = next;
		await navigateToFilters();
	}
</script>

<div class="list-toolbar">
	<form role="search" class="search-form" onsubmit={submitSearch}>
		<Search size={18} />
		<input
			id={searchId}
			bind:value={query}
			oninput={scheduleSearch}
			onkeydown={handleSearchKeydown}
			{placeholder}
			aria-label={searchLabel}
		/>
		<button class="search-submit" type="submit">Search</button>
	</form>

	<div class="kind-filter" aria-label="Bookmark type">
		<button class={{ current: !kind }} onclick={() => selectKind("")}>All</button>
		<button class={{ current: kind === "link" }} onclick={() => selectKind("link")}>Links</button>
		<button class={{ current: kind === "text" }} onclick={() => selectKind("text")}>Notes</button>
		<button class={{ current: kind === "media" }} onclick={() => selectKind("media")}>
			Images
		</button>
	</div>
</div>

{#if message}<p class="form-error" role="alert">{message}</p>{/if}

<script lang="ts">
	import { goto } from "$app/navigation";
	import { getContext, onDestroy, untrack } from "svelte";
	import { Dialog } from "bits-ui";
	import { ChevronLeft, ChevronRight, Search, X } from "lucide-svelte";
	import { errorMessage } from "#lib/error-message.ts";
	import { useCmsClient } from "#lib/cms.svelte.ts";
	import { bookmarkListURL } from "#lib/features/bookmarks/bookmark-query.ts";
	import { bookmarksPage } from "#lib/features/bookmarks/bookmarks.remote.ts";
	import { BookmarkWorkflow } from "#lib/features/bookmarks/bookmark-workflow.svelte.ts";
	import { groupActionsKey, type GroupActions } from "#lib/features/groups/group-actions.ts";
	import type { Bookmark, QuickDraft } from "#lib/features/bookmarks/bookmark-list.ts";
	import BookmarkCard from "#lib/features/bookmarks/bookmark-card.svelte";
	import BookmarkEditor from "#lib/features/bookmarks/bookmark-editor.svelte";
	import BookmarkFilters from "#lib/features/bookmarks/bookmark-filters.svelte";
	import GroupPicker from "#lib/features/groups/group-picker.svelte";
	import QuickComposer from "#lib/features/bookmarks/quick-composer.svelte";
	import type { PageData } from "./$types";

	interface EditorSession {
		bookmark: Bookmark | null;
		draft: QuickDraft | null;
		files: File[];
		fromComposer: boolean;
		key: number;
	}

	let { data }: { data: PageData } = $props();
	const client = useCmsClient().api;
	const groupActions = getContext<GroupActions>(groupActionsKey);
	if (!groupActions) throw new Error("The bookmark workspace requires group actions.");
	const pageQuery = $derived(
		bookmarksPage({
			ownerId: data.user.id,
			groupId: data.groupId,
			query: data.query,
			kind: data.kind,
			page: data.page,
		})
	);
	function queryKey() {
		return JSON.stringify([data.user.id, data.groupId, data.query, data.kind, data.page]);
	}
	// svelte-ignore state_referenced_locally
	const initialQueryKey = queryKey();
	// The server load supplies the first page; seeding prevents a duplicate hydration fetch.
	// A top-level await of QueryProxy re-suspends this component on every override/refresh.
	// svelte-ignore state_referenced_locally
	const initialPage = data.initialPage;
	// svelte-ignore state_referenced_locally
	if (initialPage) pageQuery.set(initialPage);
	const pageData = $derived(
		pageQuery.current ??
			(queryKey() === initialQueryKey && !pageQuery.error ? (initialPage ?? undefined) : undefined)
	);
	// Client-side filter/group navigation receives a fresh server snapshot too. Seed the
	// corresponding query once its route data arrives, without observing query.current.
	$effect(() => {
		const snapshot = data.initialPage;
		const query = pageQuery;
		if (snapshot) untrack(() => query.set(snapshot));
	});
	const workflow = new BookmarkWorkflow({
		client,
		groups: groupActions,
		get query() {
			return pageQuery;
		},
		get page() {
			if (!pageData) throw new Error("The bookmark page is not ready for changes.");
			return pageData;
		},
		get groupId() {
			return data.groupId;
		},
		get ownerId() {
			return data.user.id;
		},
	});
	onDestroy(workflow.dispose);

	// Initial URL filters should be open during SSR, before any effect runs.
	// svelte-ignore state_referenced_locally
	let filterOpen = $state(Boolean(data.query || data.kind));
	let editorOpen = $state(false);
	let editorSaving = $state(false);
	let editorSession = $state<EditorSession | null>(null);
	let editorKey = 0;
	let composerKey = $state(0);
	let navigationError = $state("");
	let refreshingOnReturn = false;
	// svelte-ignore state_referenced_locally
	let currentQueryKey = initialQueryKey;
	// svelte-ignore state_referenced_locally
	let currentGroupID = data.groupId;

	$effect(() => {
		const key = queryKey();
		if (key !== currentQueryKey) {
			currentQueryKey = key;
			navigationError = "";
			workflow.resetRoute();
			editorOpen = false;
			editorSaving = false;
			editorSession = null;
		}
		if (data.groupId === currentGroupID) return;
		currentGroupID = data.groupId;
		editorOpen = false;
		editorSaving = false;
		editorSession = null;
		filterOpen = Boolean(data.query || data.kind);
	});

	function openEditor(
		bookmark: Bookmark | null = null,
		draft: QuickDraft | null = null,
		files: File[] = []
	) {
		editorSession = {
			bookmark,
			draft,
			files: [...files],
			fromComposer: draft !== null || files.length > 0,
			key: ++editorKey,
		};
		editorSaving = false;
		editorOpen = true;
	}

	function finishEditor() {
		const resetComposer = editorSession?.fromComposer ?? false;
		editorOpen = false;
		editorSession = null;
		if (resetComposer) composerKey++;
	}

	async function navigatePage(nextPage: number) {
		const originKey = queryKey();
		try {
			await goto(bookmarkListURL({ groupId: data.groupId }, data.query, data.kind, nextPage));
		} catch (error) {
			if (queryKey() === originKey) navigationError = errorMessage(error);
		}
	}

	async function retryPage() {
		navigationError = "";
		try {
			await pageQuery.refresh();
		} catch {
			// The query exposes the failure in its error state beside the retry button.
		}
	}

	async function refreshVisiblePage() {
		if (
			document.visibilityState !== "visible" ||
			refreshingOnReturn ||
			editorOpen ||
			workflow.busyIDs.size
		)
			return;

		const originKey = queryKey();
		refreshingOnReturn = true;
		try {
			await workflow.refreshVisited(pageQuery);
			if (queryKey() === originKey) navigationError = "";
		} catch (error) {
			if (queryKey() === originKey) navigationError = errorMessage(error);
		} finally {
			refreshingOnReturn = false;
		}
	}
</script>

<!-- Returning from the admin refreshes only this page, without replacing an open editor draft. -->
<svelte:window onfocus={refreshVisiblePage} />
<svelte:document onvisibilitychange={refreshVisiblePage} />

<div class="workspace-container workspace-feed">
	{#key `${data.groupId}:${composerKey}`}
		<QuickComposer
			groupId={data.groupId}
			ownerId={data.user.id}
			disabled={!pageData}
			onpending={workflow.beginSave}
			onmanual={(draft) => openEditor(null, draft)}
			onadvanced={(draft, files) => openEditor(null, draft, files)}
		/>
	{/key}

	<div class="section-heading">
		<h2>Bookmarks</h2>
		<div class="section-actions">
			<details id="workspace-tools" class="filter-details" bind:open={filterOpen}>
				<summary aria-label="Search and filter"><Search size={17} /></summary>
				<div class="filter-panel">
					<BookmarkFilters
						route={{ groupId: data.groupId }}
						appliedQuery={data.query}
						appliedKind={data.kind}
						searchId="workspace-search"
						placeholder="Search this group…"
						searchLabel="Search bookmarks"
					/>
				</div>
			</details>

			<GroupPicker
				groups={groupActions.groups}
				counts={groupActions.counts}
				pendingGroupIds={groupActions.pendingGroupIds}
				selectedId={data.groupId}
				actions={groupActions}
			/>
		</div>
	</div>

	{#if workflow.errorText || navigationError}
		<p class="form-error" role="alert">{workflow.errorText || navigationError}</p>
	{/if}

	{#if !pageData}
		<div class="empty-list">
			{#if pageQuery.loading}
				<p role="status">Loading bookmarks…</p>
			{:else if pageQuery.error}
				<p role="alert">Could not load bookmarks: {errorMessage(pageQuery.error)}</p>
				<button class="button button-outline" onclick={retryPage}>Retry loading bookmarks</button>
			{:else}
				<p role="status">Loading bookmarks…</p>
			{/if}
		</div>
	{:else if pageData.bookmarks.length}
		<div class="bookmarks-grid bookmark-list">
			{#each pageData.bookmarks as bookmark (bookmark.id)}
				<BookmarkCard
					{bookmark}
					assets={pageData.assets}
					images={pageData.images}
					groups={groupActions.groups}
					busy={workflow.busyIDs.has(bookmark.id)}
					onedit={() => openEditor(bookmark)}
					ondelete={() => workflow.remove(bookmark)}
					onmove={(id) => workflow.move(bookmark, id)}
					oncopy={(id) => workflow.copy(bookmark, id)}
				/>
			{/each}
		</div>
	{:else}
		<div class={["empty-list", { simple: !data.query && !data.kind }]}>
			{#if data.query || data.kind}
				<h2>Nothing matched this search.</h2>
				<p>Try another phrase or bookmark type.</p>
				<a class="button button-outline" href={bookmarkListURL({ groupId: data.groupId }, "", "")}>
					Clear filters
				</a>
			{:else}
				<p>You have no bookmarks yet!</p>
			{/if}
		</div>
	{/if}

	{#if pageData && pageData.pagination.totalPages > 1}
		<nav class="pagination" aria-label="Bookmark pages">
			<button
				class="button button-outline"
				disabled={pageData.page <= 1}
				onclick={() => navigatePage(pageData.page - 1)}
			>
				<ChevronLeft size={16} /> Previous
			</button>
			<span>Page {pageData.page} of {pageData.pagination.totalPages}</span>
			<button
				class="button button-outline"
				disabled={pageData.page >= pageData.pagination.totalPages}
				onclick={() => navigatePage(pageData.page + 1)}
			>
				Next <ChevronRight size={16} />
			</button>
		</nav>
	{/if}
</div>

{#if pageData}
	<Dialog.Root bind:open={editorOpen}>
		<Dialog.Portal>
			<Dialog.Overlay class="dialog-overlay" />
			<Dialog.Content
				class="dialog-content editor-dialog"
				onInteractOutside={(event) => {
					if (editorSaving) event.preventDefault();
				}}
				onEscapeKeydown={(event) => {
					if (editorSaving) {
						event.preventDefault();
						return;
					}
					if (editorSession?.files.length) {
						event.preventDefault();
						editorSession.files = [];
					}
				}}
			>
				<div class="dialog-heading">
					<div>
						<Dialog.Title>
							{editorSession?.bookmark ? "Edit bookmark" : "Add to this group"}
						</Dialog.Title>
						<Dialog.Description>Keep something worth coming back to.</Dialog.Description>
					</div>
					<Dialog.Close class="icon-button" aria-label="Close dialog" disabled={editorSaving}>
						<X size={19} />
					</Dialog.Close>
				</div>

				{#if editorSession}
					{#key editorSession.key}
						<BookmarkEditor
							bookmark={editorSession.bookmark}
							draft={editorSession.draft}
							groupId={data.groupId}
							ownerId={data.user.id}
							bind:files={editorSession.files}
							bind:saving={editorSaving}
							onpending={workflow.beginSave}
							ondone={finishEditor}
						/>
					{/key}
				{/if}
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{/if}

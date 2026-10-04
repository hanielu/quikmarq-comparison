import { expect, test, type Page, type Response } from "@playwright/test";
import {
	addNote,
	card,
	openGroups,
	cmsURL,
	signUp,
	uniqueSuffix,
	collectionPath,
	updateMethod,
	errorEnvelope,
} from "./support";

test.skip(process.env.CMS_E2E !== "1", "Optimistic journey requires disposable live CMS.");
test.setTimeout(180_000);

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function observeWorkspaceReads(page: Page, groupIds: string[]) {
	const reads: Array<{ resource: "groups" | "counts"; groupIds: string[] }> = [];
	page.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (path.endsWith("/workspaceGroups")) {
			reads.push({ resource: "groups", groupIds: [] });
			return;
		}
		if (!path.endsWith("/workspaceGroupCount")) return;
		const body = request.postDataJSON() as { payloads: string[] };
		const payloads = body.payloads.map((payload) => Buffer.from(payload, "base64url").toString());
		reads.push({
			resource: "counts",
			groupIds: groupIds.filter((id) => payloads.some((payload) => payload.includes(id))),
		});
	});
	return reads;
}

async function completedCountResponse(response: Promise<Response>) {
	const result = await response;
	await result.finished();
	expect(result.ok()).toBe(true);
}

function nextCountResponse(page: Page) {
	return page.waitForResponse((response) =>
		new URL(response.url()).pathname.endsWith("/workspaceGroupCount")
	);
}

async function bookmarkAction(page: Page, content: string, action: string) {
	const options = card(page, content).first().getByRole("button", { name: "Bookmark options" });
	await expect(options).toBeEnabled();
	await options.click();
	await page.getByRole("menuitem", { name: action, exact: true }).click();
}

async function createGroup(page: Page, name: string) {
	await page.keyboard.press("Control+g");
	const dialog = page.getByRole("dialog", { name: "Create a group" });
	await dialog.getByLabel("Group name").fill(name);
	await dialog.getByRole("button", { name: "Create group" }).click();
	await expect(page.getByRole("button", { name: "Select group" })).toContainText(name);
	return new URL(page.url()).pathname.split("/").at(-1)!;
}

test("bookmark writes refresh only the affected group counts", async ({ page }) => {
	const unique = uniqueSuffix();
	await signUp(page, "Count Tester", `counts-${unique}@example.test`, `Counts-${unique}-pw`);
	const inboxId = new URL(page.url()).pathname.split("/").at(-1)!;
	const sourceName = `Source ${unique}`;
	const destinationName = `Destination ${unique}`;
	const sourceId = await createGroup(page, sourceName);
	const destinationId = await createGroup(page, destinationName);
	await page.goto(`/app/${sourceId}`);
	await page.waitForLoadState("networkidle");
	const reads = observeWorkspaceReads(page, [inboxId, sourceId, destinationId]);
	const note = `Counted note ${unique}`;
	const edited = `Edited counted note ${unique}`;

	await addNote(page, note);
	await expect(card(page, note).getByRole("button", { name: "Bookmark options" })).toBeEnabled();
	await page.waitForLoadState("networkidle");
	expect(reads.splice(0)).toEqual([{ resource: "counts", groupIds: [sourceId] }]);

	await bookmarkAction(page, note, "Edit");
	const editor = page.locator(".editor-dialog");
	await editor.getByLabel("Your note").fill(edited);
	await editor.getByRole("button", { name: "Save changes" }).click();
	await expect(card(page, edited).getByRole("button", { name: "Bookmark options" })).toBeEnabled();
	await page.waitForLoadState("networkidle");
	expect(reads.splice(0)).toEqual([]);

	const copiedCount = nextCountResponse(page);
	await bookmarkAction(page, edited, `Copy to ${destinationName}`);
	await completedCountResponse(copiedCount);
	await expect(card(page, edited).getByRole("button", { name: "Bookmark options" })).toBeEnabled();
	await expect(
		(await openGroups(page))
			.getByRole("link")
			.filter({ hasText: destinationName })
			.locator(".group-count")
	).toHaveText("1");
	await page.keyboard.press("Escape");
	expect(reads.splice(0)).toEqual([{ resource: "counts", groupIds: [destinationId] }]);

	const movedCounts = nextCountResponse(page);
	await bookmarkAction(page, edited, `Move to ${destinationName}`);
	await completedCountResponse(movedCounts);
	await expect(card(page, edited)).toHaveCount(0);
	await expect(
		(await openGroups(page))
			.getByRole("link")
			.filter({ hasText: destinationName })
			.locator(".group-count")
	).toHaveText("2");
	await page.keyboard.press("Escape");
	expect(reads.splice(0)).toEqual([{ resource: "counts", groupIds: [sourceId, destinationId] }]);

	await page.goto(`/app/${destinationId}`);
	await page.waitForLoadState("networkidle");
	reads.splice(0);
	page.once("dialog", (dialog) => dialog.accept());
	const deletedCount = nextCountResponse(page);
	await bookmarkAction(page, edited, "Delete");
	await completedCountResponse(deletedCount);
	await expect(card(page, edited)).toHaveCount(1);
	await expect((await openGroups(page)).locator(".group-row.active .group-count")).toHaveText("1");
	expect(reads.splice(0)).toEqual([{ resource: "counts", groupIds: [destinationId] }]);
});

test("a failed count refresh keeps the committed count until the next write retries it", async ({
	page,
}) => {
	const unique = uniqueSuffix();
	await signUp(
		page,
		"Count Retry Tester",
		`count-retry-${unique}@example.test`,
		`Retry-${unique}-pw`
	);
	let failed = false;
	await page.route(/\/_app\/remote\/[^/]+\/workspaceGroupCount$/, async (route) => {
		if (failed) return route.continue();
		failed = true;
		await route.fulfill({
			status: 503,
			contentType: "application/json",
			body: JSON.stringify({ type: "error", error: { message: "Temporary count failure" } }),
		});
	});

	await addNote(page, `First count ${unique}`);
	await expect(page.getByRole("alert")).toContainText(
		"Bookmark saved, but the list could not refresh"
	);
	await expect((await openGroups(page)).locator(".group-row.active .group-count")).toHaveText("1");
	await page.keyboard.press("Escape");

	await addNote(page, `Second count ${unique}`);
	await expect(
		card(page, `Second count ${unique}`).getByRole("button", { name: "Bookmark options" })
	).toBeEnabled();
	await expect((await openGroups(page)).locator(".group-row.active .group-count")).toHaveText("2");
	await page.keyboard.press("Escape");
	expect(failed).toBe(true);
});

test("a pending bookmark is visible immediately and a rejected delete rolls back", async ({
	page,
}) => {
	const unique = uniqueSuffix();
	await signUp(page, "Optimism Tester", `optimism-${unique}@example.test`, `Optimism-${unique}-pw`);
	const note = `Pending thought ${unique}`;
	const filters = page.locator("#workspace-tools");
	await filters.locator("summary").click();
	const search = page.getByRole("textbox", { name: "Search bookmarks" });
	await search.fill(note);
	await expect(page).toHaveURL(/\?q=/);
	await expect(card(page, note)).toHaveCount(0);
	await search.press("Escape");
	await expect(page).not.toHaveURL(/\?q=/);
	await filters.locator("summary").click();
	await expect(filters).toHaveJSProperty("open", false);
	const heldCreate = deferred();
	const releaseCreate = deferred();
	await page.route(`${cmsURL}${collectionPath("bookmarks")}*`, async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		heldCreate.resolve();
		await releaseCreate.promise;
		await route.continue();
	});

	await addNote(page, note);
	await heldCreate.promise;
	await expect(card(page, note)).toBeVisible();
	await expect(card(page, note).getByRole("button", { name: "Bookmark options" })).toBeDisabled();
	await expect((await openGroups(page)).locator(".group-row.active .group-count")).toHaveText("1");
	await page.keyboard.press("Escape");
	releaseCreate.resolve();
	await expect(card(page, note).getByRole("button", { name: "Bookmark options" })).toBeEnabled();
	await page.unroute(`${cmsURL}${collectionPath("bookmarks")}*`);

	const heldDelete = deferred();
	const releaseDelete = deferred();
	await page.route(`${cmsURL}${collectionPath("bookmarks")}/**`, async (route) => {
		if (route.request().method() !== "DELETE") return route.continue();
		heldDelete.resolve();
		await releaseDelete.promise;
		await route.fulfill({
			status: 409,
			headers: { "access-control-allow-origin": new URL(page.url()).origin },
			contentType: "application/json",
			body: JSON.stringify(errorEnvelope("Stale revision", 409)),
		});
	});
	page.once("dialog", (dialog) => dialog.accept());
	await card(page, note).getByRole("button", { name: "Bookmark options" }).click();
	await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
	await heldDelete.promise;
	await expect(card(page, note)).toHaveCount(0);
	await expect((await openGroups(page)).locator(".group-row.active .group-count")).toHaveText("0");
	await page.keyboard.press("Escape");
	releaseDelete.resolve();
	await expect(card(page, note)).toBeVisible();
	await expect(page.getByRole("alert")).toContainText("Stale revision");
	await page.unroute(`${cmsURL}${collectionPath("bookmarks")}/**`);

	// The previously visited empty search result must refresh when revisited.
	await filters.locator("summary").click();
	await search.fill(note);
	await expect(card(page, note)).toBeVisible();
	await search.press("Escape");
	await expect(card(page, note)).toBeVisible();
});

test("group rename is immediate while the write waits and rolls back on conflict", async ({
	page,
}) => {
	const unique = uniqueSuffix();
	await signUp(
		page,
		"Group Optimism Tester",
		`group-optimism-${unique}@example.test`,
		`Optimism-${unique}-pw`
	);
	const renamed = `Pending inbox ${unique}`;
	const heldRename = deferred();
	const releaseRename = deferred();
	await page.route(`${cmsURL}${collectionPath("groups")}/**`, async (route) => {
		if (route.request().method() !== updateMethod) return route.continue();
		heldRename.resolve();
		await releaseRename.promise;
		await route.fulfill({
			status: 409,
			headers: { "access-control-allow-origin": new URL(page.url()).origin },
			contentType: "application/json",
			body: JSON.stringify(errorEnvelope("Stale group revision", 409)),
		});
	});
	await openGroups(page);
	await page.getByRole("button", { name: "Options for Inbox" }).click();
	await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Rename group" });
	await dialog.getByLabel("Group name").fill(renamed);
	await dialog.getByRole("button", { name: "Save name" }).click();
	await heldRename.promise;
	await expect(page.getByRole("button", { name: "Select group" })).toContainText(renamed);
	releaseRename.resolve();
	await expect(page.getByRole("button", { name: "Select group" })).toContainText("Inbox");
	await expect(dialog.getByRole("alert")).toContainText("Stale group revision");
});

test("a failed first-time filter read hides old cards and can be retried", async ({ page }) => {
	const unique = uniqueSuffix();
	await signUp(page, "Filter Tester", `filter-${unique}@example.test`, `Filter-${unique}-pw`);
	const wanted = `Wanted ${unique}`;
	const other = `Other ${unique}`;
	for (const note of [wanted, other]) {
		await addNote(page, note);
		await expect(card(page, note).getByRole("button", { name: "Bookmark options" })).toBeEnabled();
	}
	const draft = `Unsent ${unique}`;
	await page.getByRole("textbox", { name: "Add a bookmark" }).fill(draft);

	// The first filtered navigation now arrives through a server-load snapshot. Model
	// its caught CMS failure by replacing only that page's initialPage with null;
	// the remote query must then expose the inline error and Retry control.
	const failedSnapshot = deferred();
	await page.route(/\/app\/[^/]+\/__data\.json/, async (route) => {
		if (new URL(route.request().url()).searchParams.get("q") !== wanted) return route.continue();
		const response = await route.fetch();
		const body = (await response.json()) as {
			nodes: Array<{ data?: unknown }>;
		};
		const encoded = body.nodes.at(-1)?.data;
		if (!Array.isArray(encoded) || !encoded[0] || typeof encoded[0] !== "object")
			throw new Error("The filtered server load did not return encoded page data.");
		const pageData = encoded[0] as Record<string, unknown>;
		if (typeof pageData.initialPage !== "number")
			throw new Error("The filtered server load did not include an initial page.");
		pageData.initialPage = encoded.length;
		encoded.push(null);
		failedSnapshot.resolve();
		await route.fulfill({ response, body: JSON.stringify(body) });
	});
	const remoteRead = /\/_app\/remote\/[^/]+\/bookmarksPage\?/;
	const failedRead = deferred();
	await page.route(remoteRead, async (route) => {
		const payload = new URL(route.request().url()).searchParams.get("payload");
		if (!payload || !Buffer.from(payload, "base64url").toString().includes(wanted))
			return route.continue();
		failedRead.resolve();
		await route.fulfill({
			status: 503,
			contentType: "application/json",
			body: JSON.stringify({ type: "error", error: { message: "Temporary read failure" } }),
		});
	});

	await page.locator("#workspace-tools summary").click();
	const search = page.getByRole("textbox", { name: "Search bookmarks" });
	await search.fill(wanted);
	await search.press("Enter");
	await failedSnapshot.promise;
	await failedRead.promise;
	await expect(page).toHaveURL((url) => url.searchParams.get("q") === wanted);
	await expect(page.locator("article.bookmark-card")).toHaveCount(0);
	await expect(page.getByRole("textbox", { name: "Add a bookmark" })).toHaveValue(draft);
	await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
	const retry = page.getByRole("button", { name: "Retry loading bookmarks" });
	await expect(retry).toBeVisible();

	await page.unroute(remoteRead);
	await page.unroute(/\/app\/[^/]+\/__data\.json/);
	await retry.click();
	await expect(card(page, wanted)).toBeVisible();
	await expect(card(page, other)).toHaveCount(0);
	await expect(page.locator("article.bookmark-card")).toHaveCount(1);
	await expect(page.getByRole("textbox", { name: "Add a bookmark" })).toHaveValue(draft);
	await expect(page.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
});

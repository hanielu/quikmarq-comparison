import { expect, test, type Page } from "@playwright/test";
import {
	card,
	openGroups,
	pngImage as image,
	cmsURL,
	cmsBackend,
	collectionPath,
	updateMethod,
} from "./support";

// Disposable local CMS or explicitly selected hosted deployment; both create fresh accounts.
test.skip(process.env.CMS_E2E !== "1", "Live journey requires CMS_E2E=1");
test.setTimeout(180_000);

async function cardAction(page: Page, content: string, action: string) {
	const trigger = card(page, content).getByRole("button", { name: "Bookmark options" });
	await expect(trigger).toBeEnabled();
	await trigger.click({ timeout: 5_000 });
	const item = page.getByRole("menuitem", { name: action, exact: true });
	await expect(item).toBeVisible();
	await item.click();
}

async function removeCard(page: Page, content: string, expectedRemaining: string[]) {
	const deleted = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname.startsWith(`${collectionPath("bookmarks")}/`) &&
			response.request().method() === "DELETE"
	);
	page.once("dialog", (dialog) => dialog.accept());
	await cardAction(page, content, "Delete");
	expect((await deleted).status()).toBe(200);
	await expect(card(page, content)).toHaveCount(0);
	await expect(page.locator("article.bookmark-card")).toHaveCount(expectedRemaining.length);
	for (const title of expectedRemaining) await expect(card(page, title)).toBeVisible();
	const remaining = expectedRemaining.length;
	const groups = await openGroups(page);
	const current = (await page.getByRole("button", { name: "Select group" }).textContent())?.trim();
	await expect(
		groups
			.getByRole("link")
			.filter({ hasText: current ?? "" })
			.locator(".group-count")
	).toHaveText(String(remaining));
	await page.keyboard.press("Escape");
}

async function groupAction(page: Page, name: string, action: string) {
	await openGroups(page);
	const trigger = page.getByRole("button", { name: `Options for ${name}` });
	await expect(trigger).toBeEnabled();
	await trigger.click({ timeout: 5_000 });
	await page.getByRole("menuitem", { name: action, exact: true }).click();
	// The next action opens another group's menu; wait for this one to close first.
	await expect(page.getByRole("menuitem", { name: action, exact: true })).toHaveCount(0);
}

test("live account and collection journey", async ({ page, browser }) => {
	const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
	const email = `quikmarq-e2e-${unique}@example.test`;
	const password = `E2e-${unique}-password`;
	const originalSource = `Ideas ${unique}`;
	const source = `Renamed ideas ${unique}`;
	const destination = `Archive ${unique}`;
	const linkTitle = `CMS guide ${unique}`;
	const editedLink = `Edited guide ${unique}`;
	const note = `A thought ${unique}`;
	const editedNote = `A clearer thought ${unique}`;
	const caption = `Snapshot ${unique}`;
	const editedCaption = `Edited snapshot ${unique}`;

	await page.goto("/signup");
	await page.waitForLoadState("networkidle");
	await page.getByLabel("Display name").fill("Journey Tester");
	await page.getByLabel("Email address").fill(email);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Create account" }).click();
	await expect(page).toHaveURL(/\/app\//);
	await expect((await openGroups(page)).getByRole("link", { name: /Inbox/ })).toBeVisible();

	await page.setViewportSize({ width: 390, height: 844 });
	await page.keyboard.press("Escape");
	await expect(page.getByRole("navigation", { name: "Your groups" })).toBeHidden();
	await openGroups(page);
	await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("navigation", { name: "Your groups" })).toBeHidden();
	await page.setViewportSize({ width: 1280, height: 900 });

	await page.keyboard.press("Control+g");
	const groupDialog = page.getByRole("dialog", { name: "Create a group" });
	await expect(groupDialog).toBeVisible();
	await groupDialog.getByLabel("Group name").fill(originalSource);
	await groupDialog.getByRole("button", { name: "Create group" }).click();
	await expect(page.getByRole("button", { name: "Select group" })).toContainText(originalSource);
	const sourceURL = new URL(page.url()).pathname;

	await page.keyboard.press("Control+g");
	await groupDialog.getByLabel("Group name").fill(destination);
	await groupDialog.getByRole("button", { name: "Create group" }).click();
	await expect(page.getByRole("button", { name: "Select group" })).toContainText(destination);
	const destinationURL = new URL(page.url()).pathname;

	await groupAction(page, destination, "Move up");
	await expect
		.poll(async () => (await openGroups(page)).locator("a").allTextContents())
		.toEqual([
			expect.stringContaining("Inbox"),
			expect.stringContaining(destination),
			expect.stringContaining(originalSource),
		]);
	await groupAction(page, originalSource, "Rename");
	await page.getByLabel("Group name").fill(source);
	await page.getByRole("button", { name: "Save name" }).click();
	await expect(
		(await openGroups(page)).getByRole("link", { name: new RegExp(source) })
	).toBeVisible();
	await page.keyboard.press("Escape");

	await page.goto(sourceURL);
	await page.waitForLoadState("networkidle");
	await page.keyboard.press("n");
	await expect(page.getByRole("textbox", { name: "Add a bookmark" })).toBeFocused();
	await page.getByRole("button", { name: "Detailed editor" }).click();
	const editor = page.locator(".editor-dialog");
	await expect(editor).toBeVisible();
	await editor.getByRole("button", { name: "Link", exact: true }).click();
	await editor.getByLabel("URL").fill("example.com/payload");
	await editor.getByLabel("Title").fill(linkTitle);
	await editor.getByRole("button", { name: "Add bookmark" }).click();
	await expect(editor).toBeHidden();
	await expect(card(page, linkTitle)).toBeVisible();

	await page.getByRole("textbox", { name: "Add a bookmark" }).fill(note);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await expect(card(page, note)).toBeVisible();

	await page.getByRole("button", { name: "Detailed editor" }).click();
	await editor.getByRole("button", { name: "Images", exact: true }).click();
	await editor
		.locator("input[type=file]")
		.setInputFiles({ name: "journey.png", mimeType: "image/png", buffer: image });
	await editor.getByLabel("Caption").fill(caption);
	await editor.getByRole("button", { name: "Add bookmark" }).click();
	await expect(editor).toBeHidden();
	await expect(card(page, caption)).toBeVisible();

	await cardAction(page, linkTitle, "Edit");
	await editor.getByLabel("Title").fill(editedLink);
	await editor.getByRole("button", { name: "Save changes" }).click();
	await expect(editor).toBeHidden();
	await expect(card(page, editedLink)).toBeVisible();
	await cardAction(page, note, "Edit");
	await editor.getByLabel("Your note").fill(editedNote);
	await editor.getByRole("button", { name: "Save changes" }).click();
	await expect(editor).toBeHidden();
	await expect(card(page, editedNote)).toBeVisible();
	await cardAction(page, caption, "Edit");
	await editor.getByLabel("Caption").fill(editedCaption);
	await editor.getByRole("button", { name: "Save changes" }).click();
	await expect(editor).toBeHidden();
	await expect(card(page, editedCaption)).toBeVisible();

	await page.keyboard.press("/");
	await expect(page.getByRole("textbox", { name: "Search bookmarks" })).toBeFocused();
	await page.getByRole("textbox", { name: "Search bookmarks" }).fill(editedNote);
	await expect(page).toHaveURL((url) => url.searchParams.get("q") === editedNote);
	await expect(card(page, editedNote)).toBeVisible();
	await expect(page.locator("article.bookmark-card")).toHaveCount(1);
	await page.getByRole("textbox", { name: "Search bookmarks" }).press("Escape");
	await expect(page.locator("article.bookmark-card")).toHaveCount(3);
	await page.getByRole("button", { name: "Images", exact: true }).click();
	await expect(card(page, editedCaption)).toBeVisible();
	await expect(page.locator("article.bookmark-card")).toHaveCount(1);
	await page.getByRole("button", { name: "All", exact: true }).click();
	await expect(page.locator("article.bookmark-card")).toHaveCount(3);
	const filters = page.locator("#workspace-tools");
	await filters.locator("summary").click();
	await expect(filters).toHaveJSProperty("open", false);

	await openGroups(page);
	await page.getByRole("button", { name: "Share this group" }).click();
	await page.getByRole("button", { name: "Turn on sharing" }).click();
	const shareInput = page.getByRole("textbox", { name: "Share URL" });
	const shareURL = await shareInput.inputValue();
	const anonymous = await browser.newContext();
	const shared = await anonymous.newPage();
	try {
		await shared.goto(shareURL);
		await expect(shared.getByRole("heading", { name: source })).toBeVisible();
		await expect(shared.locator("article.bookmark-card")).toHaveCount(3);
		await expect(shared.getByRole("textbox", { name: "Add a bookmark" })).toHaveCount(0);
		await page.getByRole("button", { name: "Create new link" }).click();
		await expect(shareInput).not.toHaveValue(shareURL);
		const rotatedURL = await shareInput.inputValue();
		await shared.goto(shareURL);
		await expect(shared.getByText("This shared collection is unavailable")).toBeVisible();
		await shared.goto(rotatedURL);
		await expect(shared.getByRole("heading", { name: source })).toBeVisible();
		await page.getByRole("button", { name: "Turn off sharing" }).click();
		await expect(page.getByRole("button", { name: "Turn on sharing" })).toBeVisible();
		await shared.goto(rotatedURL);
		await expect(shared.getByText("This shared collection is unavailable")).toBeVisible();
	} finally {
		await anonymous.close();
	}
	await page
		.getByRole("dialog", { name: "Share this group" })
		.getByRole("button", { name: "Close dialog" })
		.click();

	for (const [index, content] of [editedLink, editedNote, editedCaption].entries()) {
		const copied = page.waitForResponse(
			(response) =>
				response.url().startsWith(`${cmsURL}${collectionPath("bookmarks")}`) &&
				response.request().method() === "POST"
		);
		await cardAction(page, content, `Copy to ${destination}`);
		expect((await copied).status()).toBe(201);
		await expect(card(page, content)).toHaveCount(1);
		await expect(
			(await openGroups(page))
				.getByRole("link")
				.filter({ hasText: destination })
				.locator(".group-count")
		).toHaveText(String(index + 1));
		await page.keyboard.press("Escape");
		const moved = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname.startsWith(`${collectionPath("bookmarks")}/`) &&
				response.request().method() === updateMethod
		);
		await cardAction(page, content, "Move to Inbox");
		expect((await moved).status()).toBe(200);
		await expect(card(page, content)).toHaveCount(0);
		const remaining = 2 - index;
		await expect(page.locator("article.bookmark-card")).toHaveCount(remaining);
		await expect(
			(await openGroups(page)).getByRole("link", { name: /Inbox/ }).locator(".group-count")
		).toHaveText(String(index + 1));
		await page.keyboard.press("Escape");
	}
	await expect(page.getByRole("alert")).toHaveCount(0);
	await page.goto(destinationURL);
	await page.waitForLoadState("networkidle");
	await expect(page.locator("article.bookmark-card")).toHaveCount(3);
	for (const [index, content] of [editedLink, editedNote, editedCaption].entries()) {
		await expect(card(page, content)).toBeVisible();
		await removeCard(page, content, [editedLink, editedNote, editedCaption].slice(index + 1));
	}
	await (await openGroups(page)).getByRole("link", { name: /Inbox/ }).click();
	await expect(page.locator("article.bookmark-card")).toHaveCount(3);
	for (const [index, content] of [editedLink, editedNote, editedCaption].entries()) {
		await expect(card(page, content)).toBeVisible();
		await removeCard(page, content, [editedLink, editedNote, editedCaption].slice(index + 1));
	}

	page.once("dialog", (dialog) => dialog.accept());
	const sourceID = sourceURL.split("/").at(-1)!;
	const sourceDeletion = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === `${collectionPath("groups")}/${sourceID}` &&
			response.request().method() === "DELETE"
	);
	await groupAction(page, source, "Delete group");
	const sourceDeletionResponse = await sourceDeletion;
	expect(sourceDeletionResponse.status()).toBe(200);
	const groupsAfterSource = await openGroups(page);
	await expect(groupsAfterSource).toHaveAttribute("aria-busy", "false");
	await expect(groupsAfterSource.getByRole("link")).toHaveCount(2);
	page.once("dialog", (dialog) => dialog.accept());
	const destinationID = destinationURL.split("/").at(-1)!;
	const destinationDeletion = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === `${collectionPath("groups")}/${destinationID}` &&
			response.request().method() === "DELETE"
	);
	await groupAction(page, destination, "Delete group");
	expect((await destinationDeletion).status()).toBe(200);
	const groupsAfterDestination = await openGroups(page);
	await expect(groupsAfterDestination).toHaveAttribute("aria-busy", "false");
	await expect(groupsAfterDestination.getByRole("link")).toHaveCount(1);
	page.once("dialog", (dialog) => dialog.accept());
	const inboxID = new URL(page.url()).pathname.split("/").at(-1)!;
	const inboxDeletion = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === `${collectionPath("groups")}/${inboxID}` &&
			response.request().method() === "DELETE"
	);
	await groupAction(page, "Inbox", "Delete group");
	expect((await inboxDeletion).status()).toBe(cmsBackend === "ridu" ? 422 : 400);
	await expect(page.getByRole("alert")).toContainText("Cannot delete the final group");
	await expect((await openGroups(page)).getByRole("link", { name: /Inbox/ })).toBeVisible();
	await page.keyboard.press("Escape");

	await page.locator(".account-trigger").click();
	await page.getByRole("menuitem", { name: "Log out" }).click();
	await expect(page).toHaveURL(/\/login$/);
	await page.getByLabel("Email address").fill(email);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page).toHaveURL(/\/app\//);
	await expect((await openGroups(page)).getByRole("link", { name: /Inbox/ })).toBeVisible();
});

test("original-style composer saves directly and falls back to a manual link", async ({ page }) => {
	const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
	await page.goto("/signup");
	await page.waitForLoadState("networkidle");
	await page.getByLabel("Display name").fill("Composer Tester");
	await page.getByLabel("Email address").fill(`quikmarq-composer-${unique}@example.test`);
	await page.getByLabel("Password").fill(`E2e-${unique}-password`);
	await page.getByRole("button", { name: "Create account" }).click();
	await expect(page).toHaveURL(/\/app\//);

	// Browsers call the CMS custom endpoint directly, so a fulfilled response needs CORS headers.
	const cors = { "access-control-allow-origin": new URL(page.url()).origin };
	await page.route(`${cmsURL}/api/bookmark-metadata`, async (route) => {
		const url = (route.request().postDataJSON() as { url: string }).url;
		if (url.includes("/manual")) await route.fulfill({ status: 502, headers: cors, body: "{}" });
		else
			await route.fulfill({
				status: 200,
				headers: cors,
				contentType: "application/json",
				body: JSON.stringify({ normalizedURL: url, title: `Fast link ${unique}` }),
			});
	});

	const composer = page.getByRole("textbox", { name: "Add a bookmark" });
	await composer.fill(`example.com/fast-${unique}`);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await expect(card(page, `Fast link ${unique}`)).toBeVisible();
	await expect(composer).toHaveValue("");

	await composer.fill(`example.com/manual-${unique}`);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const editor = page.locator(".editor-dialog");
	await expect(editor).toBeVisible();
	await expect(editor.getByLabel("URL")).toHaveValue(`https://example.com/manual-${unique}`);
	await editor.getByLabel("Title").fill(`Manual link ${unique}`);
	await editor.getByRole("button", { name: "Add bookmark" }).click();
	await expect(editor).toBeHidden();
	await expect(card(page, `Manual link ${unique}`)).toBeVisible();

	await page.setViewportSize({ width: 390, height: 844 });
	const bounds = await page.locator(".quick-composer").boundingBox();
	expect(bounds).not.toBeNull();
	expect(Math.abs(bounds!.y + bounds!.height - 844)).toBeLessThan(2);
	await page
		.locator(".composer-attach input[type=file]")
		.setInputFiles({ name: "quick.png", mimeType: "image/png", buffer: image });
	await expect(page.locator(".composer-preview")).toHaveCount(1);
	await composer.fill(`Quick image ${unique}`);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await expect(card(page, `Quick image ${unique}`)).toBeVisible();
});

test("keyboard shortcuts and theme persist through a workspace reload", async ({ page }) => {
	const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
	await page.goto("/signup");
	await page.waitForLoadState("networkidle");
	await page.getByLabel("Display name").fill("Preference Tester");
	await page.getByLabel("Email address").fill(`preferences-${unique}@example.test`);
	await page.getByLabel("Password").fill(`Preferences-${unique}-password`);
	await page.getByRole("button", { name: "Create account" }).click();
	await expect(page).toHaveURL(/\/app\//);
	await page.waitForLoadState("networkidle");
	await page.keyboard.press("Control+/");
	await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();
	await page.locator(".account-trigger").click();
	await page.getByRole("menuitem", { name: /Dark theme/ }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("protected workspace and collection API reject anonymous visitors", async ({
	page,
	request,
}) => {
	await page.goto("/app");
	await expect(page).toHaveURL(/\/login/);
	const response = await request.get(`${cmsURL}${collectionPath("groups")}?depth=0`);
	expect([401, 403]).toContain(response.status());
});

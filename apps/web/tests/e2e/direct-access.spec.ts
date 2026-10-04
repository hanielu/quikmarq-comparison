import { expect, test, type BrowserContext } from "@playwright/test";
import {
	addImage,
	addNote,
	card,
	logIn,
	logOut,
	openGroups,
	cmsURL,
	cmsBackend,
	webURL,
	sessionCookieName,
	authorization,
	collectionPath,
	loginPath,
	signupPath,
	errorEnvelope,
	recordTraffic,
	signUp,
	uniqueSuffix,
} from "./support";
import { WORKSPACE_COUNT_BATCH_LIMIT } from "../../src/lib/features/workspace/workspace-count-batches.ts";
import { GROUP_RANK_MIDPOINT } from "../../src/lib/features/groups/group-ranking.ts";

test.skip(process.env.CMS_E2E !== "1", "Direct access checks require a disposable CMS");
test.setTimeout(150_000);

async function sessionToken(context: BrowserContext): Promise<string> {
	const cookie = (await context.cookies(webURL)).find((item) => item.name === sessionCookieName);
	expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
	expect(cookie?.value).toBeTruthy();
	return cookie!.value;
}

test("session handoff requires the web origin and a valid native session", async ({ request }) => {
	const unique = uniqueSuffix();
	const account = {
		displayName: "Handoff Tester",
		email: `handoff-${unique}@example.test`,
		password: `Handoff-${unique}-pw`,
	};
	const signupData =
		cmsBackend === "ridu"
			? {
					data: { email: account.email, displayName: account.displayName },
					password: account.password,
				}
			: account;
	expect((await request.post(`${cmsURL}${signupPath}`, { data: signupData })).status()).toBe(201);
	const login = await request.post(`${cmsURL}${loginPath}`, {
		data: {
			email: account.email,
			password: account.password,
			...(cmsBackend === "ridu" ? { transport: "token" } : {}),
		},
	});
	expect(login.status()).toBe(200);
	const { token } = await login.json();
	expect(typeof token).toBe("string");
	const endpoint = `${webURL}/auth/session`;
	expect(
		(
			await request.post(endpoint, {
				headers: { origin: "https://other.example.test" },
				data: { token },
			})
		).status()
	).toBe(403);
	expect((await request.post(endpoint, { data: { token } })).status()).toBe(403);
	expect(
		(
			await request.post(endpoint, {
				headers: { origin: webURL },
				data: { token: "invalid-native-session" },
			})
		).status()
	).toBe(401);
	const handoff = await request.post(endpoint, {
		headers: { origin: webURL },
		data: { token },
	});
	expect(handoff.status()).toBe(200);
	expect((await handoff.json()).user.email).toBe(account.email);
	const cookie = (await request.storageState()).cookies.find(
		(item) => item.name === sessionCookieName
	);
	expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
	expect(cookie?.value).toBe(token);
	expect((await (await request.get(endpoint)).json()).token).toBe(token);
	expect((await request.delete(endpoint, { headers: { origin: webURL } })).status()).toBe(200);
	expect((await (await request.get(endpoint)).json()).token).toBeUndefined();
});

test("browser writes go directly to the CMS and private images use signed URLs", async ({
	page,
	context,
	request,
}) => {
	const unique = uniqueSuffix();
	const traffic = recordTraffic(page);
	await signUp(page, "Direct Tester", `direct-${unique}@example.test`, `Direct-${unique}-pw`);
	const caption = `Private image ${unique}`;
	await addImage(page, caption);
	const image = card(page, caption).locator("img").first();
	await expect
		.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
		.toBeGreaterThan(0);
	const imageURL = new URL((await image.getAttribute("src")) ?? "");
	const token = await sessionToken(context);
	expect(imageURL.origin).toBe(cmsURL);
	expect(imageURL.pathname).toMatch(
		cmsBackend === "ridu" ? /^\/api\/uploads\/assets\// : /^\/api\/assets\/media\//
	);
	expect(imageURL.href).not.toContain(token);

	const webOrigin = new URL(page.url()).origin;
	const writes = traffic.filter(
		(exchange) =>
			exchange.url.origin === cmsURL &&
			["POST", "PATCH", "DELETE"].includes(exchange.method) &&
			exchange.url.pathname.startsWith("/api/")
	);
	expect(writes.some((exchange) => exchange.url.pathname === loginPath)).toBe(true);
	expect(writes.some((exchange) => exchange.url.pathname === collectionPath("assets"))).toBe(true);
	expect(
		traffic.filter(
			(exchange) =>
				exchange.url.origin === webOrigin &&
				/^\/api\/(assets|bookmarks|groups)/.test(exchange.url.pathname)
		)
	).toEqual([]);
	for (const exchange of writes.filter(
		(exchange) => ![signupPath, loginPath].includes(exchange.url.pathname)
	)) {
		expect(exchange.requestHeaders.authorization).toBe(authorization(token));
		expect(exchange.requestHeaders.cookie).toBeUndefined();
	}
	const media = await request.get(imageURL.href);
	expect(media.status()).toBe(200);
	expect((await media.body()).subarray(0, 8)).toEqual(
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
	);
	await logOut(page);
	expect((await context.cookies(webURL)).some((cookie) => cookie.name === sessionCookieName)).toBe(
		false
	);
	const afterLogout = await request.get(
		`${cmsURL}${cmsBackend === "ridu" ? "/api/auth/me" : "/api/users/me?depth=0"}`,
		{
			headers: { authorization: authorization(token) },
		}
	);
	expect((await afterLogout.json()).user).toBeFalsy();
	// Capability URLs deliberately conceal revocation as not-found.
	expect([401, 404]).toContain((await request.get(imageURL.href)).status());
});

test("concurrent server renders stay isolated per account", async ({ browser }) => {
	const unique = uniqueSuffix();
	const contexts = await Promise.all([
		browser.newContext({ baseURL: webURL }),
		browser.newContext({ baseURL: webURL }),
	]);
	try {
		const pages = await Promise.all(contexts.map((context) => context.newPage()));
		const accounts = pages.map((page, index) => ({
			page,
			note: `Only account ${index} ${unique}`,
			email: `isolated-${index}-${unique}@example.test`,
		}));
		for (const [index, account] of accounts.entries()) {
			await signUp(account.page, `Isolated ${index}`, account.email, `Isolated-${unique}-pw`);
			await addNote(account.page, account.note);
			await expect(card(account.page, account.note)).toBeVisible();
			// Reload only after the optimistic card has become a committed save.
			await expect(
				card(account.page, account.note).getByRole("button", { name: "Bookmark options" })
			).toBeEnabled();
		}
		for (let round = 0; round < 2; round++) {
			await Promise.all(accounts.map((account) => account.page.reload()));
			for (const [index, account] of accounts.entries()) {
				await expect(card(account.page, account.note)).toBeVisible();
				await expect(card(account.page, accounts[1 - index]!.note)).toHaveCount(0);
				await expect(account.page.locator(".account-name b")).toHaveText(`Isolated ${index}`);
			}
		}
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});

test("remote query inputs reject another owner's cache key", async ({ page }) => {
	test.skip(process.env.CMS_DEV_E2E !== "1", "Imports the dev server remote-query modules");
	const unique = uniqueSuffix();
	await signUp(page, "Remote Tester", `remote-${unique}@example.test`, `Remote-${unique}-pw`);
	const groupId = new URL(page.url()).pathname.split("/").at(-1)!;
	const outcomes = await page.evaluate(
		async ({ groupId, ownerId }) => {
			const workspacePath = "/src/lib/features/workspace/workspace.remote.ts";
			const bookmarksPath = "/src/lib/features/bookmarks/bookmarks.remote.ts";
			const { workspaceGroups, workspaceGroupCount } = await import(
				/* @vite-ignore */ workspacePath
			);
			const { bookmarksPage } = await import(/* @vite-ignore */ bookmarksPath);
			const calls = await Promise.allSettled([
				workspaceGroups(ownerId),
				workspaceGroupCount({ ownerId, groupId }),
				bookmarksPage({ ownerId, groupId, query: "", kind: "", page: 1 }),
			]);
			return calls.map(
				(call) =>
					call.status === "rejected" &&
					typeof call.reason === "object" &&
					call.reason?.status === 401
			);
		},
		{ groupId, ownerId: `another-${unique}` }
	);
	expect(outcomes).toEqual([true, true, true]);
});

test("count batches are bounded and a larger workspace still renders", async ({
	page,
	context,
	request,
}) => {
	test.skip(process.env.CMS_DEV_E2E !== "1", "Imports the dev server remote-query modules");
	const unique = uniqueSuffix();
	await signUp(page, "Batch Tester", `batch-${unique}@example.test`, `Batch-${unique}-pw`);
	const token = await sessionToken(context);
	const me = await request.get(
		`${cmsURL}${cmsBackend === "ridu" ? "/api/auth/me" : "/api/users/me?depth=0"}`,
		{
			headers: { authorization: authorization(token) },
		}
	);
	expect(me.ok()).toBe(true);
	const meBody = await me.json();
	const ownerId = (cmsBackend === "ridu" ? meBody.session.user.id : meBody.user.id) as string;
	const rejected = await page.evaluate(
		async ({ limit, ownerId }) => {
			const path = "/src/lib/features/workspace/workspace.remote.ts";
			const { workspaceGroupCount } = await import(/* @vite-ignore */ path);
			const calls = Array.from({ length: limit + 1 }, (_, index) =>
				workspaceGroupCount({ ownerId, groupId: `oversized-${index}` })
			);
			return (await Promise.allSettled(calls)).map((call) =>
				call.status === "rejected" && typeof call.reason === "object" ? call.reason?.status : 200
			);
		},
		{ limit: WORKSPACE_COUNT_BATCH_LIMIT, ownerId }
	);
	expect(rejected).toEqual(Array(WORKSPACE_COUNT_BATCH_LIMIT + 1).fill(413));
	for (let index = 0; index < WORKSPACE_COUNT_BATCH_LIMIT; index++) {
		const created = await request.post(`${cmsURL}${collectionPath("groups")}?depth=0`, {
			headers: { authorization: authorization(token) },
			data: { owner: ownerId, name: `Extra group ${index}`, rank: GROUP_RANK_MIDPOINT },
		});
		expect(created.ok(), await created.text()).toBe(true);
	}
	await page.reload({ waitUntil: "networkidle" });
	await expect((await openGroups(page)).getByRole("link")).toHaveCount(
		WORKSPACE_COUNT_BATCH_LIMIT + 1
	);
});

test("tabs follow sign-out and protected SSR rejects an invalid session cookie", async ({
	page,
	context,
}) => {
	const unique = uniqueSuffix();
	const email = `tabs-${unique}@example.test`;
	const password = `Tabs-${unique}-pw`;
	await signUp(page, "Tab Tester", email, password);
	const other = await context.newPage();
	await other.goto("/app");
	await other.waitForLoadState("networkidle");
	await expect(other.locator(".account-name b")).toHaveText("Tab Tester");
	await logOut(page);
	await expect(other).toHaveURL(/\/login/);
	await logIn(page, email, password);
	await context.addCookies([
		{
			name: sessionCookieName,
			value: "invalid.session.token",
			url: webURL,
			httpOnly: true,
			sameSite: "Lax",
		},
	]);
	await page.reload();
	await expect(page).toHaveURL(/\/login/);
});

test("stale group revision reports conflict and preserves the latest save", async ({
	page,
	context,
}) => {
	const unique = uniqueSuffix();
	await signUp(page, "Revision Tester", `revision-${unique}@example.test`, `Revision-${unique}-pw`);
	const stale = await context.newPage();
	await stale.goto(page.url());
	await stale.waitForLoadState("networkidle");
	for (const [tab, name] of [
		[page, `Fresh ${unique}`],
		[stale, `Stale ${unique}`],
	] as const) {
		const picker = tab.getByRole("button", { name: "Select group" });
		const options = tab.getByRole("button", { name: "Options for Inbox" });
		const rename = tab.getByRole("menuitem", { name: "Rename", exact: true });
		if (tab === page) {
			await picker.click();
			await options.click();
			await rename.click();
		} else {
			await picker.press("Enter");
			await options.press("Enter");
			await rename.press("Enter");
		}
		const dialog = tab.getByRole("dialog", { name: "Rename group" });
		await expect(dialog).toBeVisible();
		await expect(picker).toHaveAttribute("aria-expanded", "false");
		await dialog.getByLabel("Group name").fill(name);
		await dialog.getByRole("button", { name: "Save name" }).click();
		if (tab === page)
			await expect(tab.getByRole("button", { name: "Select group" })).toContainText(name);
	}
	await expect(stale.getByRole("alert")).toBeVisible();
	await stale.reload();
	await expect(stale.getByRole("button", { name: "Select group" })).toContainText(
		`Fresh ${unique}`
	);
});

test("a CMS write failure preserves session and rolls back the attempted note", async ({
	page,
	context,
}) => {
	const unique = uniqueSuffix();
	await signUp(page, "Outage Tester", `outage-${unique}@example.test`, `Outage-${unique}-pw`);
	await page.route(`${cmsURL}${collectionPath("bookmarks")}*`, (route) =>
		route.request().method() === "POST"
			? route.fulfill({
					status: 503,
					headers: { "access-control-allow-origin": new URL(page.url()).origin },
					contentType: "application/json",
					body: JSON.stringify(errorEnvelope("CMS is unavailable", 503)),
				})
			: route.continue()
	);
	const note = `During outage ${unique}`;
	await addNote(page, note);
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(card(page, note)).toHaveCount(0);
	await page.unroute(`${cmsURL}${collectionPath("bookmarks")}*`);
	expect(await sessionToken(context)).toBeTruthy();
	await page.reload();
	await expect(page.locator(".account-name b")).toHaveText("Outage Tester");
});

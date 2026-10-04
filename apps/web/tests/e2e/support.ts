import { expect, type Page } from "@playwright/test";

export const cmsBackend = process.env.CMS_BACKEND ?? process.env.PUBLIC_CMS_BACKEND ?? "ridu";
if (cmsBackend !== "ridu" && cmsBackend !== "payload")
	throw new Error("CMS_BACKEND must be ridu or payload");
export const cmsURL = new URL(
	process.env.CMS_URL ??
		process.env.PUBLIC_CMS_URL ??
		(cmsBackend === "ridu" ? "http://localhost:18087" : "http://localhost:18088")
).origin;
export const webURL = new URL(process.env.WEB_URL ?? "http://127.0.0.1:4175").origin;
export const sessionCookieName = `quikmarq_${cmsBackend}_session`;
export const authorization = (token: string) =>
	`${cmsBackend === "ridu" ? "Session" : "JWT"} ${token}`;
export const collectionPath = (collection: string) =>
	`${cmsBackend === "ridu" ? "/api/collections" : "/api"}/${collection}`;
export const updateMethod = cmsBackend === "ridu" ? "POST" : "PATCH";
export const loginPath = cmsBackend === "ridu" ? "/api/auth/users/login" : "/api/users/login";
export const signupPath = cmsBackend === "ridu" ? "/api/auth/users/create-user" : "/api/users";
export function errorEnvelope(message: string, status: number) {
	return cmsBackend === "ridu"
		? { error: { code: status === 409 ? "conflict" : "internal", status, message, issues: [] } }
		: { errors: [{ message }] };
}

export const pngImage = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64"
);

export function uniqueSuffix() {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export async function signUp(page: Page, displayName: string, email: string, password: string) {
	await page.goto("/signup");
	await page.waitForLoadState("networkidle");
	await page.getByLabel("Display name").fill(displayName);
	await page.getByLabel("Email address").fill(email);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Create account" }).click();
	await expect(page).toHaveURL(/\/app\//);
}

export async function logIn(page: Page, email: string, password: string) {
	await page.goto("/login");
	await page.waitForLoadState("networkidle");
	await page.getByLabel("Email address").fill(email);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Log in" }).click();
	await expect(page).toHaveURL(/\/app\//);
}

export async function logOut(page: Page) {
	await page.locator(".account-trigger").click();
	await page.getByRole("menuitem", { name: "Log out" }).click();
	await expect(page).toHaveURL(/\/login/);
}

export function card(page: Page, content: string) {
	return page.locator("article.bookmark-card").filter({ hasText: content });
}

export async function openGroups(page: Page) {
	const navigation = page.getByRole("navigation", { name: "Your groups" });
	const trigger = page.getByRole("button", { name: "Select group" });
	if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
	await expect(navigation).toBeVisible();
	return navigation;
}

export async function addNote(page: Page, note: string) {
	await page.getByRole("textbox", { name: "Add a bookmark" }).fill(note);
	await page.getByRole("button", { name: "Add", exact: true }).click();
}

export async function addImage(page: Page, caption: string) {
	await page.getByRole("button", { name: "Detailed editor" }).click();
	const editor = page.locator(".editor-dialog");
	await expect(editor).toBeVisible();
	await editor.getByRole("button", { name: "Images", exact: true }).click();
	await editor
		.locator("input[type=file]")
		.setInputFiles({ name: "direct.png", mimeType: "image/png", buffer: pngImage });
	await editor.getByLabel("Caption").fill(caption);
	await editor.getByRole("button", { name: "Add bookmark" }).click();
	await expect(editor).toBeHidden();
	await expect(card(page, caption)).toBeVisible();
	await expect(card(page, caption).locator("img").first()).toHaveAttribute(
		"src",
		cmsBackend === "ridu" ? /[?&]grant=/ : /\/api\/assets\/media\//,
		{
			timeout: 10_000,
		}
	);
}

export interface Exchange {
	url: URL;
	method: string;
	requestHeaders: Record<string, string>;
	status: number;
	responseHeaders: Record<string, string>;
}

/** Record every network exchange a page makes, including CORS preflights. */
export function recordTraffic(page: Page) {
	const exchanges: Exchange[] = [];
	page.on("response", async (response) => {
		const request = response.request();
		exchanges.push({
			url: new URL(request.url()),
			method: request.method(),
			requestHeaders: await request.allHeaders(),
			status: response.status(),
			responseHeaders: await response.allHeaders(),
		});
	});
	return exchanges;
}

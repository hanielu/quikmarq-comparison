import { expect, test } from "@playwright/test";
import { createClient } from "../../src/lib/ridu.generated.ts";
import { card, logIn, pngImage, cmsURL, cmsBackend, uniqueSuffix } from "./support";

test.skip(
	process.env.CMS_ADMIN_E2E !== "1" || cmsBackend !== "ridu",
	"Admin journey requires a disposable Ridu database"
);

test("admin image metadata and the canonical bookmark caption stay consistent with Inbox", async ({
	page,
	context,
}) => {
	test.setTimeout(120_000);
	const unique = uniqueSuffix();
	const password = `Admin-assets-${unique}-password`;
	const adminEmail = `admin-assets-${unique}@example.test`;
	const admin = createClient({ baseURL: cmsURL, auth: { collection: "admins" } });
	await admin.auth.createUser({ data: { email: adminEmail }, password });

	let token: string | null = null;
	const owner = createClient({
		baseURL: cmsURL,
		auth: {
			collection: "users",
			token: {
				get token() {
					return token;
				},
				issued(value) {
					token = value;
				},
				cleared(value) {
					if (token === value) token = null;
				},
			},
		},
	});
	const email = `asset-owner-${unique}@example.test`;
	const user = await owner.auth.createUser({
		data: { email, displayName: "Asset Owner" },
		password,
	});
	await owner.auth.login({ email, password });
	const groups = await owner.list("groups");
	expect(groups.docs).toHaveLength(1);
	const group = groups.docs[0];
	const asset = await owner.upload(
		"assets",
		new File([pngImage], "caption-regression.png", { type: "image/png" }),
		{
			data: {
				owner: user.id,
				group: group.id,
				alt: "Caption regression image",
			},
		}
	);
	const bookmark = await owner.create("bookmarks", {
		owner: user.id,
		group: group.id,
		kind: "media",
		position: "0",
		caption: "Original bookmark caption",
		images: [asset.id],
	});

	await logIn(page, email, password);
	await expect(card(page, "Original bookmark caption")).toBeVisible();

	const adminPage = await context.newPage();
	await adminPage.goto(`${cmsURL}/admin/login`);
	await adminPage.getByLabel("Email address").fill(adminEmail);
	await adminPage.getByLabel("Password", { exact: true }).fill(password);
	await adminPage.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(adminPage.getByRole("navigation", { name: "Admin navigation" })).toBeVisible();
	await adminPage.goto(`${cmsURL}/admin/collections/assets/${asset.id}`);
	await expect(adminPage.getByLabel("Caption", { exact: true })).toHaveCount(0);
	await expect(adminPage.getByText("Edit the bookmark's Caption", { exact: false })).toBeVisible();
	const alt = adminPage.getByLabel("Alt", { exact: true });
	await expect(alt).toHaveValue("Caption regression image");
	await alt.fill("Accessibility text saved from the embedded admin");
	const save = adminPage
		.locator(".ridu-document-actions")
		.getByRole("button", { name: "Save", exact: true });
	await expect(save).toBeEnabled();
	const savedResponse = adminPage.waitForResponse(
		(response) =>
			response.request().method() === "PATCH" &&
			new URL(response.url()).pathname === `/api/collections/assets/${asset.id}/upload`
	);
	await save.click();
	const response = await savedResponse;
	expect(response.status(), await response.text()).toBe(200);
	expect(response.request().headers()["content-type"]).toContain("application/json");
	const submitted = response.request().postDataJSON();
	expect(submitted).toMatchObject({
		data: { alt: "Accessibility text saved from the embedded admin" },
	});
	expect(submitted.data).not.toHaveProperty("caption");
	expect(submitted).not.toHaveProperty("file");
	await expect(adminPage.getByText("Upload outcome unknown", { exact: true })).toHaveCount(0);
	await expect(adminPage.getByRole("button", { name: "Reload saved document" })).toHaveCount(0);

	await adminPage.reload();
	await expect(alt).toHaveValue("Accessibility text saved from the embedded admin");
	const saved = await owner.find("assets", asset.id);
	expect(saved).not.toHaveProperty("caption");
	expect(saved._revision).toBe(asset._revision + 1);
	expect(saved.owner).toBe(user.id);
	expect(saved.group).toBe(group.id);
	expect(saved.filename).toBe(asset.filename);
	expect(saved.objectKey).toBe(asset.objectKey);
	const source = await owner.readUploadSource("assets", asset.id);
	expect(Buffer.from(await source.arrayBuffer())).toEqual(pngImage);
	const privateOwner = await adminPage.request.get(`${cmsURL}/api/collections/users/${user.id}`);
	expect(privateOwner.status()).toBe(403);

	await adminPage.goto(`${cmsURL}/admin/collections/bookmarks/${bookmark.id}`);
	const caption = adminPage.getByLabel("Caption", { exact: true });
	await expect(caption).toHaveValue("Original bookmark caption");
	await caption.fill("Caption saved from the embedded admin");
	const publishedResponse = adminPage.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname === `/api/collections/bookmarks/${bookmark.id}/publish`
	);
	await adminPage
		.locator(".ridu-document-actions")
		.getByRole("button", { name: "Publish changes", exact: true })
		.click();
	expect((await publishedResponse).status()).toBe(200);
	await page.bringToFront();
	// Headless pages stay visible/focused here; deliver the tab-return event explicitly.
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(card(page, "Caption saved from the embedded admin")).toBeVisible();
	await expect(card(page, "Original bookmark caption")).toHaveCount(0);
	await expect(page.getByAltText("Accessibility text saved from the embedded admin")).toBeVisible();

	// Returning to the workspace must not replace an in-progress editor session.
	await page.getByRole("button", { name: "Detailed editor" }).click();
	const editor = page.locator(".editor-dialog");
	await editor.getByRole("button", { name: "Images", exact: true }).click();
	await editor.getByLabel("Caption").fill("Unsaved caption draft");
	await adminPage.bringToFront();
	const current = await owner.find("bookmarks", bookmark.id);
	await owner.publishChanges(
		"bookmarks",
		bookmark.id,
		{ caption: "A newer saved caption" },
		{
			revision: current._revision,
		}
	);
	await page.bringToFront();
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(editor.getByLabel("Caption")).toHaveValue("Unsaved caption draft");
	await expect(card(page, "Caption saved from the embedded admin")).toBeVisible();
	await editor.getByRole("button", { name: "Close dialog" }).click();
	await adminPage.bringToFront();
	await page.bringToFront();
	await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
	await expect(card(page, "A newer saved caption")).toBeVisible();

	await card(page, "A newer saved caption")
		.getByRole("button", { name: "Bookmark options" })
		.press("Enter");
	await page.getByRole("menuitem", { name: "Edit", exact: true }).dispatchEvent("click");
	await editor.getByLabel("Caption").fill("Caption saved from Inbox");
	await editor.getByRole("button", { name: "Save changes" }).click();
	await expect(editor).toBeHidden();
	await expect(card(page, "Caption saved from Inbox")).toBeVisible();
	await adminPage.reload();
	await expect(caption).toHaveValue("Caption saved from Inbox");
	expect(await owner.find("assets", asset.id)).not.toHaveProperty("caption");

	const sharing = await owner.request(`/api/collections/groups/${group.id}/share`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ rotate: false }),
	});
	expect(sharing.status).toBe(200);
	const { token: shareToken } = await sharing.json();
	const shared = await adminPage.request.post(`${cmsURL}/api/share/resolve`, {
		data: { token: shareToken, page: 1, limit: 24, query: "", kind: "media" },
	});
	expect(shared.status()).toBe(200);
	const collection = await shared.json();
	expect(collection.docs[0].caption).toBe("Caption saved from Inbox");
	expect(collection.docs[0].images[0]).not.toHaveProperty("caption");
});

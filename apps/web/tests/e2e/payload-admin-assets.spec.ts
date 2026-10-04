import { expect, test } from "@playwright/test";
import { card, logIn, cmsURL, cmsBackend, webURL, pngImage, uniqueSuffix } from "./support";

test.skip(
	process.env.CMS_ADMIN_E2E !== "1" || cmsBackend !== "payload",
	"Admin journey requires a disposable CMS"
);
test.setTimeout(180_000);

test("Payload admin asset alt and bookmark caption flow back to Inbox and public sharing", async ({
	page,
	context,
	request,
	browser,
}) => {
	const unique = uniqueSuffix();
	const password = `Admin-assets-${unique}-password`;
	const adminEmail = `admin-assets-${unique}@example.test`;
	const ownerEmail = `asset-owner-${unique}@example.test`;
	const admin = await request.post(`${cmsURL}/api/admins`, {
		data: { email: adminEmail, password },
	});
	expect(admin.status(), await admin.text()).toBe(201);
	const signup = await request.post(`${cmsURL}/api/users`, {
		data: { email: ownerEmail, password, displayName: "Asset Owner" },
	});
	expect(signup.status(), await signup.text()).toBe(201);
	const ownerID = (await signup.json()).doc.id as string;
	const login = await request.post(`${cmsURL}/api/users/login`, {
		data: { email: ownerEmail, password },
	});
	expect(login.ok(), await login.text()).toBe(true);
	const token = (await login.json()).token as string;
	const headers = { authorization: `JWT ${token}` };
	const groups = await request.get(`${cmsURL}/api/groups?depth=0`, { headers });
	expect(groups.ok()).toBe(true);
	const group = (await groups.json()).docs[0] as { id: string };
	expect(group.id).toBeTruthy();

	const upload = await request.post(`${cmsURL}/api/assets?depth=0`, {
		headers,
		multipart: {
			_payload: JSON.stringify({ owner: ownerID, group: group.id, alt: "Original image alt" }),
			file: { name: "caption-regression.png", mimeType: "image/png", buffer: pngImage },
		},
	});
	expect(upload.status(), await upload.text()).toBe(201);
	const asset = (await upload.json()).doc as { id: string; filename: string };
	const create = await request.post(`${cmsURL}/api/bookmarks?depth=0`, {
		headers,
		data: {
			owner: ownerID,
			group: group.id,
			kind: "media",
			position: "0",
			caption: "Original bookmark caption",
			images: [asset.id],
		},
	});
	expect(create.status(), await create.text()).toBe(201);
	const bookmark = (await create.json()).doc as { id: string };

	await logIn(page, ownerEmail, password);
	await expect(card(page, "Original bookmark caption")).toBeVisible();
	const adminPage = await context.newPage();
	await adminPage.goto(`${cmsURL}/admin/login`);
	await adminPage.waitForLoadState("networkidle");
	await adminPage.locator('input[name="email"]').fill(adminEmail);
	await adminPage.locator('input[name="password"]').fill(password);
	await adminPage.getByRole("button", { name: /log in|login|sign in/i }).click();
	await expect(adminPage).toHaveURL(/\/admin(?:\/(?!login)|$)/);
	await adminPage.goto(`${cmsURL}/admin/collections/assets/${asset.id}`);
	await expect(adminPage.getByLabel("Caption", { exact: true })).toHaveCount(0);
	const alt = adminPage.locator('[name="alt"]');
	await expect(alt).toHaveValue("Original image alt");
	await alt.fill("Accessibility text saved from Payload admin");
	await adminPage.getByRole("button", { name: /^save/i }).first().click();
	await expect
		.poll(async () => {
			const result = await request.get(`${cmsURL}/api/assets/${asset.id}?depth=0`, { headers });
			return result.ok() ? (await result.json()).alt : null;
		})
		.toBe("Accessibility text saved from Payload admin");
	const savedAsset = await request.get(`${cmsURL}/api/assets/${asset.id}?depth=0`, { headers });
	const savedAssetDoc = await savedAsset.json();
	expect(savedAssetDoc).not.toHaveProperty("caption");
	expect(savedAssetDoc.filename).toBe(asset.filename);

	await adminPage.goto(`${cmsURL}/admin/collections/bookmarks/${bookmark.id}`);
	const caption = adminPage.locator('[name="caption"]');
	await expect(caption).toHaveValue("Original bookmark caption");
	await caption.fill("Caption saved from Payload admin");
	await adminPage.getByRole("button", { name: /^save/i }).first().click();
	await expect
		.poll(async () => {
			const result = await request.get(`${cmsURL}/api/bookmarks/${bookmark.id}?depth=0`, {
				headers,
			});
			return result.ok() ? (await result.json()).caption : null;
		})
		.toBe("Caption saved from Payload admin");
	await page.bringToFront();
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(card(page, "Caption saved from Payload admin")).toBeVisible();
	await expect(page.getByAltText("Accessibility text saved from Payload admin")).toBeVisible();

	const sharing = await request.post(`${cmsURL}/api/groups/${group.id}/share`, {
		headers,
		data: { rotate: false },
	});
	expect(sharing.ok(), await sharing.text()).toBe(true);
	const shareToken = (await sharing.json()).token as string;
	const publicPage = await browser.newPage();
	try {
		await publicPage.goto(`${webURL}/share/${encodeURIComponent(shareToken)}`);
		await expect(card(publicPage, "Caption saved from Payload admin")).toBeVisible();
		await expect(
			publicPage.getByAltText("Accessibility text saved from Payload admin")
		).toBeVisible();
	} finally {
		await publicPage.close();
	}
});

import { expect, test } from "@playwright/test";
import { cmsBackend, cmsURL } from "./support.ts";

test("landing page leads to account creation", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Explore, capture");
	await page.getByRole("link", { name: /Start collecting/ }).click();
	await expect(page).toHaveURL(/\/signup$/);
	await expect(page.getByRole("heading", { name: "Make yourself at home." })).toBeVisible();
	await expect(page.getByLabel("Email address")).toBeVisible();
});

test("login form is keyboard accessible at a narrow viewport", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/login");
	await page.keyboard.press("Tab");
	await expect(page.locator(":focus")).toBeVisible();
	await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("the same app identifies its selected CMS and links to the native admin", async ({ page }) => {
	await page.goto("/");
	const identity = page.getByLabel("CMS for this app");
	await expect(identity).toContainText(cmsBackend === "ridu" ? "RiduCMS" : "PayloadCMS");
	await expect(identity.getByRole("link", { name: "CMS admin" })).toHaveAttribute(
		"href",
		new URL("/admin", cmsURL).href
	);
	await expect(page.getByText("This is a CMS comparison demo.", { exact: false })).toBeVisible();
});

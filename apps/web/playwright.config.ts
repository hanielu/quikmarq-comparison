import { defineConfig, devices } from "@playwright/test";
import { cmsBackend, cmsURL, webURL } from "./tests/e2e/support.ts";

const live = process.env.CMS_E2E === "1";

export default defineConfig({
	testDir: "./tests/e2e",
	// The full suite creates fresh accounts in the explicitly selected disposable
	// services started by the root comparison runner.
	testMatch: live ? undefined : ["**/public.spec.ts"],
	workers: live ? 1 : undefined,
	outputDir: `../../.data/playwright/${cmsBackend}`,
	use: {
		baseURL: webURL,
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		...devices["Desktop Chrome"],
		launchOptions: { args: ["--test-third-party-cookie-phaseout"] },
	},
	webServer: process.env.WEB_URL
		? undefined
		: {
				command: "bun run dev -- --host 127.0.0.1 --port 4175 --strictPort",
				url: webURL,
				reuseExistingServer: !process.env.CI,
				timeout: 30_000,
				env: { PUBLIC_CMS_BACKEND: cmsBackend, PUBLIC_CMS_URL: cmsURL },
			},
});

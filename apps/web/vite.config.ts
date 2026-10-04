import { sveltekit } from "@sveltejs/kit/vite";
import nodeAdapter from "@sveltejs/adapter-node";
import vercelAdapter from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		UnoCSS(),
		sveltekit({
			paths: { origin: process.env.ORIGIN || undefined },
			adapter:
				process.env.WEB_ADAPTER === "vercel"
					? vercelAdapter()
					: nodeAdapter({ out: process.env.WEB_BUILD_DIRECTORY ?? "build" }),
			preprocess: vitePreprocess(),
			compilerOptions: { experimental: { async: true } },
			experimental: { remoteFunctions: true },
		}),
	],
});

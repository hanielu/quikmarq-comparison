<script lang="ts">
	import "@fontsource/inter/latin-400.css";
	import "@fontsource/inter/latin-500.css";
	import "@fontsource/inter/latin-600.css";
	import "@fontsource/lexend/latin-500.css";
	import "@fontsource/lexend/latin-600.css";
	import "@fontsource/righteous/latin-400.css";
	import "virtual:uno.css";
	import "../app.css";
	import "../interaction.css";
	import { onMount, untrack, type Snippet } from "svelte";
	import { provideCmsClient } from "#lib/cms.svelte.ts";
	import CmsIdentity from "#lib/cms-identity.svelte";
	import type { LayoutData } from "./$types";

	type Theme = "system" | "light" | "dark";

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	// One client for this mounted app. Later layout snapshots refresh the user but never
	// replace a newer sign-in or sign-out in this tab.
	// The app context is stable for this layout lifetime; subsequent data arrives in the effect.
	// svelte-ignore state_referenced_locally
	const client = provideCmsClient(data.session);
	$effect(() => {
		const session = data.session;
		untrack(() => client.acceptSession(session));
	});
	onMount(() => {
		client.activate();
		return () => client.dispose();
	});

	function browserTheme(serverTheme: Theme): Theme {
		// The cookie is the SSR source of truth. The inline app.html script uses
		// this same precedence before hydration to avoid a theme flash.
		const cookie = document.cookie.match(/(?:^|; )quikmarq_theme=(system|light|dark)(?:;|$)/)?.[1];
		if (cookie === "system" || cookie === "light" || cookie === "dark") return cookie;

		const stored = localStorage.getItem("quikmarq_theme");
		if (stored === "system" || stored === "light" || stored === "dark") {
			document.cookie = `quikmarq_theme=${stored}; Path=/; SameSite=Lax; Max-Age=31536000`;
			return stored;
		}
		return serverTheme;
	}

	$effect(() => {
		const serverTheme = data.theme;
		const preference = matchMedia("(prefers-color-scheme: dark)");

		function syncTheme() {
			const selected = browserTheme(serverTheme);
			document.documentElement.dataset.theme =
				selected === "system" ? (preference.matches ? "dark" : "light") : selected;
		}

		syncTheme();
		preference.addEventListener("change", syncTheme);
		return () => preference.removeEventListener("change", syncTheme);
	});
</script>

<CmsIdentity />
{@render children()}

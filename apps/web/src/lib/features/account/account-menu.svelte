<script lang="ts">
	import { goto, invalidate } from "$app/navigation";
	import { errorMessage } from "#lib/error-message.ts";
	import { useCmsClient } from "#lib/cms.svelte.ts";
	import { AUTH_DEPENDENCY } from "#lib/auth-dependency.ts";
	import { DropdownMenu } from "bits-ui";
	import { ChevronDown, LogOut, Moon, Settings2, Share2, Sun } from "lucide-svelte";
	import { onMount } from "svelte";

	type Theme = "system" | "light" | "dark";

	let {
		serverTheme,
		canShare,
		onShare,
		onShortcuts,
	}: {
		serverTheme: Theme;
		canShare: boolean;
		onShare: () => Promise<void>;
		onShortcuts: () => void;
	} = $props();

	const client = useCmsClient();
	// The session is reactive: another tab's sign-out or account switch updates this menu.
	const user = $derived(client.session?.user);

	let themeOverride = $state<Theme | null>(null);
	let open = $state(false);
	let busy = $state(false);
	let message = $state("");
	const theme = $derived(themeOverride ?? serverTheme);

	onMount(() => {
		const cookie = document.cookie.match(/(?:^|; )quikmarq_theme=(system|light|dark)(?:;|$)/)?.[1];
		const saved = cookie ?? localStorage.getItem("quikmarq_theme");
		if (saved === "system" || saved === "light" || saved === "dark") themeOverride = saved;
	});

	function setTheme(value: Theme) {
		themeOverride = value;
		document.documentElement.dataset.theme =
			value === "system"
				? matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light"
				: value;
		localStorage.setItem("quikmarq_theme", value);
		document.cookie = `quikmarq_theme=${value}; Path=/; SameSite=Lax; Max-Age=31536000`;
	}

	async function logout() {
		if (busy) return;
		busy = true;
		message = "";

		try {
			await client.signOut();
			await invalidate(AUTH_DEPENDENCY);
			await goto("/login");
		} catch (error) {
			message = errorMessage(error);
			open = true;
		} finally {
			busy = false;
		}
	}
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger class="account-trigger" aria-label="Account settings">
		<span class="avatar">
			{(user?.displayName || user?.email || "U").slice(0, 1).toUpperCase()}
		</span>
		<span class="account-name">
			<b>{user?.displayName || user?.email}</b>
			<small>My account</small>
		</span>
		<ChevronDown size={16} />
	</DropdownMenu.Trigger>

	<DropdownMenu.Portal>
		<DropdownMenu.Content class="menu-content account-menu" sideOffset={8} align="end">
			<DropdownMenu.Item onSelect={onShortcuts}>
				<Settings2 size={15} /> Keyboard shortcuts
			</DropdownMenu.Item>
			{#if canShare}
				<DropdownMenu.Item onSelect={onShare}>
					<Share2 size={15} /> Share this group
				</DropdownMenu.Item>
			{/if}

			<DropdownMenu.Separator class="menu-separator" />
			<DropdownMenu.Item onSelect={() => setTheme("system")}>
				<Settings2 size={15} /> System theme {theme === "system" ? "✓" : ""}
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => setTheme("light")}>
				<Sun size={15} /> Light theme {theme === "light" ? "✓" : ""}
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => setTheme("dark")}>
				<Moon size={15} /> Dark theme {theme === "dark" ? "✓" : ""}
			</DropdownMenu.Item>

			<DropdownMenu.Separator class="menu-separator" />
			<DropdownMenu.Item onSelect={logout} disabled={busy}>
				<LogOut size={15} /> Log out
			</DropdownMenu.Item>
			{#if message}
				<p class="form-error" role="alert">{message}</p>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>

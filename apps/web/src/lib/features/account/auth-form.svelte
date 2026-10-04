<script lang="ts">
	import { goto, invalidate } from "$app/navigation";
	import { page } from "$app/state";
	import { errorMessage } from "#lib/error-message.ts";
	import { useCmsClient } from "#lib/cms.svelte.ts";
	import { AUTH_DEPENDENCY } from "#lib/auth-dependency.ts";
	import { ArrowRight } from "lucide-svelte";

	let { mode }: { mode: "login" | "signup" } = $props();
	const client = useCmsClient();
	let email = $state("");
	let password = $state("");
	let displayName = $state("");
	let busy = $state(false);
	let message = $state("");
	const isSignup = $derived(mode === "signup");

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;

		busy = true;
		message = "";

		try {
			if (isSignup) {
				await client.api.createUser({
					email: email.trim(),
					displayName: displayName.trim(),
					password,
				});
			}

			// The session cookie is written before this resolves, so /app renders signed in.
			await client.signIn(email.trim(), password);
			await invalidate(AUTH_DEPENDENCY);
			const next = page.url.searchParams.get("next");
			await goto(next?.startsWith("/app") && !next.startsWith("//") ? next : "/app");
		} catch (error) {
			message = errorMessage(error);
		} finally {
			busy = false;
		}
	}
</script>

<div class="auth-page">
	<div class="auth-side">
		<a href="/" class="brand">quikmarq</a>
		<div class="auth-side-copy">
			<h1>
				Explore, capture,
				<br />
				reminisce web odysseys.
			</h1>
			<p>Save the pages, notes, and images you want to find again.</p>
		</div>
		<span class="auth-side-foot">Your internet, thoughtfully collected. CMS comparison demo.</span>
	</div>

	<main class="auth-main">
		<div class="auth-card">
			<h2>{isSignup ? "Make yourself at home." : "Welcome back."}</h2>
			<p>
				{isSignup
					? "Begin your odyssey with an email and password."
					: "Pick up where your curiosity left off."}
			</p>
			<form onsubmit={submit} class="form-stack">
				{#if isSignup}
					<label>
						Display name
						<input
							bind:value={displayName}
							autocomplete="name"
							required
							minlength="2"
							maxlength="80"
							placeholder="Your name"
						/>
					</label>
				{/if}
				<label>
					Email address
					<input
						bind:value={email}
						type="email"
						autocomplete="email"
						required
						placeholder="you@example.com"
					/>
				</label>
				<label>
					Password
					<input
						bind:value={password}
						type="password"
						autocomplete={isSignup ? "new-password" : "current-password"}
						required
						minlength="8"
						placeholder="At least 8 characters"
					/>
				</label>
				{#if message}
					<p class="form-error" role="alert">{message}</p>
				{/if}
				<button class="button button-primary button-lg full-width" disabled={busy}>
					{busy ? "One moment…" : isSignup ? "Create account" : "Log in"}
					<ArrowRight size={17} />
				</button>
			</form>
			<p class="auth-switch">
				{isSignup ? "Already have an account?" : "New to Quikmarq?"}
				<a href={isSignup ? "/login" : "/signup"}>{isSignup ? "Log in" : "Create an account"}</a>
			</p>
			<p class="auth-legal">
				By continuing, you agree to our <a href="/terms">Terms</a>
				and
				<a href="/privacy">Privacy Policy</a>
				.
			</p>
		</div>
	</main>
</div>

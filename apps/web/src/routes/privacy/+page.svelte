<script lang="ts">
	import { cmsName } from "#lib/cms-config.ts";
</script>

<svelte:head>
	<title>Privacy — Quikmarq</title>
</svelte:head>

<div class="legal-shell">
	<header class="legal-header">
		<a class="brand public-brand" href="/">quikmarq</a>
		<a href="/signup">Get started →</a>
	</header>

	<main class="legal-content">
		<p class="eyebrow">YOUR DATA</p>
		<h1>Privacy policy</h1>
		<p class="legal-intro">
			This comparison demo stores the information you provide so you can try its bookmark workspace.
			Use sample content; the operator may reset the demo.
		</p>

		<h2>Information you provide</h2>
		<p>
			We store your email address, display name, account credentials, groups, bookmarks, notes, and
			uploaded images. Login credentials are handled by {cmsName}.
		</p>

		<h2>How the service uses it</h2>
		<p>
			We use this information to authenticate you, save and retrieve your content, show your
			workspace, and operate read-only collection sharing when you enable it.
		</p>

		<h2>Sharing</h2>
		<p>
			A share link makes that collection visible to anyone with the link. You can disable sharing or
			rotate the link in the collection settings. Your private account information is not included
			on the shared page.
		</p>

		<h2>Storage and retention</h2>
		<p>
			Content stays in this deployment until you delete it, your account is removed, or the operator
			resets the demo. Operational logs may be retained for security and reliability. Browser theme
			preference is saved locally and in a cookie.
		</p>

		<h2>Your choices</h2>
		<p>
			You can edit or delete your content within the app. For account export or deletion requests,
			contact the service operator.
		</p>

		<p class="legal-note">
			Updated October 2026. If you deploy your own copy, you operate its accounts and data. Your
			hosting providers may retain service logs.
		</p>
	</main>

	<footer>
		<a href="/terms">Terms of use</a>
		<a href="/">Home</a>
	</footer>
</div>

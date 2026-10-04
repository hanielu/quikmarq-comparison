<script lang="ts">
	import { ArrowRight } from "lucide-svelte";
</script>

<svelte:head>
	<title>Quikmarq — Explore, capture, reminisce web odysseys</title>
	<meta
		name="description"
		content="A bookmark app you can run with RiduCMS or PayloadCMS using the same interface."
	/>
</svelte:head>

<div class="marketing-shell">
	<header class="marketing-nav">
		<a href="/" class="brand">quikmarq</a>
		<nav aria-label="Main navigation">
			<a href="/login">Log in</a>
			<a class="button button-primary" href="/signup">
				Get started <ArrowRight size={16} />
			</a>
		</nav>
	</header>

	<main>
		<section class="hero" aria-labelledby="hero-title">
			<div class="hero-copy">
				<h1 id="hero-title">
					Explore, capture,
					<br />
					reminisce web odysseys.
				</h1>

				<div class="hero-features" aria-label="What you can do with Quikmarq">
					<details class="feature-item" open>
						<summary>Capture Beyond Bookmarks</summary>
						<p>Keep notes and images alongside the pages you want to revisit, all in one place.</p>
					</details>
					<details class="feature-item">
						<summary>Effortless Bookmarking</summary>
						<p>Save useful links as you discover them and find them again in your collection.</p>
					</details>
					<details class="feature-item">
						<summary>Collections Worth Sharing</summary>
						<p>
							Bring related finds together in groups and share a read-only view when you choose.
						</p>
					</details>
				</div>
			</div>

			<aside class="hero-auth-card" aria-labelledby="hero-auth-title">
				<h2 id="hero-auth-title">Begin your odyssey</h2>
				<p>
					This is a CMS comparison demo. Create your own account to try saving links, notes, and
					images.
				</p>
				<a class="button button-primary button-lg full-width" href="/signup">
					Start collecting <ArrowRight size={18} />
				</a>
				<p class="hero-auth-switch">
					Already have an account? <a href="/login">Log in</a>
				</p>
			</aside>
		</section>
	</main>

	<footer class="marketing-footer">
		<span>© {new Date().getFullYear()} Quikmarq · CMS comparison demo</span>
		<div>
			<a href="/terms">Terms</a>
			<a href="/privacy">Privacy</a>
		</div>
	</footer>
</div>

<script lang="ts">
	import { cmsAdminURL, cmsName } from "./cms-config.ts";
</script>

<aside class="cms-identity" aria-label="CMS for this app">
	<span>Quikmarq · {cmsName}</span>
	<a href={cmsAdminURL} target="_blank" rel="noreferrer">CMS admin ↗</a>
</aside>

<style>
	.cms-identity {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.4rem 1rem;
		font-size: 0.75rem;
		line-height: 1.4;
		border-bottom: 1px solid var(--line);
		background: var(--surface);
		color: var(--muted);
	}
	a {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>

# Quikmarq comparison

This repository runs the same bookmark application with Ridu or Payload.

- `apps/web` owns one SvelteKit UI and finite application-specific CMS adapters.
- `backends/ridu` owns executable Go configuration, generated contracts and the embedded admin.
- `backends/payload` owns Payload configuration, its native API and Next.js admin.
- `deploy` and `scripts` own repeatable setup and the two Railway templates.

Use Bun and strict TypeScript/Svelte 5. Keep authorization, native CMS operations,
revision conflicts, upload cleanup, and session isolation intact. Never implement
a generic CMS compatibility API or maintain a second backend schema. Regenerate
contracts from executable configuration. Browser writes reach the selected CMS
directly; server reads use the same application adapter.

Keep the original Quikmarq repositories and Ridu framework outside changes.
Keep deployment data, credentials and caches ignored. Do not stage or commit
unless explicitly requested. Verify both backends against the same browser journey
and inspect production containers before publishing the templates.

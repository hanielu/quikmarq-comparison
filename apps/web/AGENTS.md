# Shared Quikmarq web app

This SvelteKit 3/Svelte 5 app is built from one source for both comparison deployments.

- `PUBLIC_CMS_BACKEND=ridu|payload` and `PUBLIC_CMS_URL` select the native adapter at build time.
- Go config and Payload config own their schemas. Do not edit generated contracts.
- `quikmarq-client.ts` owns this bookmark app's view types and operations. `ridu-client.ts`
  uses the generated Ridu SDK; `payload-client.ts` uses native Payload REST.
- Components receive the stable browser client from `cms.svelte.ts`; feature controllers
  receive its `.api`. Server loads and remote queries use `locals.cms`.
- Keep writes/uploads direct to the selected CMS. Only `/auth/session` hands the validated
  credential to the first-party HttpOnly cookie used for SSR. Cookies/channels are backend scoped.
- Preserve account isolation, optimistic compensation, stale revisions, expected error status
  and issues, private signed URLs, and the shared SSR preload flow.
- Keep strict TypeScript and Svelte 5 runes, named feature owners, Bits UI accessibility,
  and explicit `#lib` extensions. Use Bun. Tests belong in `tests/`.
- Ridu 0.13 deletes are unconditional; Payload deletes use If-Match. Do not claim the
  adapter enforces a revision condition absent from the native API.

Run `bun run format:check`, `bun run check`, `bun run test`, and builds for both backend configs.
The browser suite uses `CMS_E2E=1 CMS_BACKEND=... CMS_URL=... WEB_URL=...` against
explicitly selected disposable services. Do not run it against an unrelated deployment.

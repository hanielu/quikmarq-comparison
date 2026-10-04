# Shared Quikmarq web

One SvelteKit 3/Svelte 5 app runs with either native CMS. The same routes, styles,
SSR preloads, remote queries, optimistic workflows, and account UI are used by both.

Set these build-time variables:

```sh
PUBLIC_CMS_BACKEND=ridu
PUBLIC_CMS_URL=http://localhost:18087
ORIGIN=http://localhost:4177
```

Use `payload` with its own CMS URL for the other deployment. Each build identifies
its CMS and links to that CMS's admin. Accounts and data belong to the selected CMS;
changing backends does not migrate them.

The default build uses adapter-node for Railway. `WEB_BUILD_DIRECTORY=build/ridu`
or `build/payload` lets the comparison runner retain both builds. Set
`WEB_ADAPTER=vercel` for a Vercel build instead. For Node deployments, `ORIGIN` sets
SvelteKit's canonical web origin at build time, including the same-origin auth and
remote-query checks. Railway forwards the service's `ORIGIN` through the Dockerfile's
build argument. Changing the public web domain requires a rebuild. `/readyz` checks
the web server; CMS readiness is independent.

Browser writes, authentication, uploads, image URL batches, and custom endpoints
reach the CMS directly. `/auth/session` validates a token with the CMS before setting
this app's HttpOnly session cookie. Server renders use that cookie and request-scoped
clients. Ridu uses `Authorization: Session`, Payload uses `Authorization: JWT`.

The finite app adapter projects groups, bookmarks, and assets to the UI. It preserves
each native API: Ridu publishes edits and exposes `_revision`; Payload patches edits
and exposes `revision`. Both guard edits with If-Match. Payload guards deletes too;
Ridu 0.13's delete API has no revision precondition. Private images use session-bound
URLs from each CMS. Generated source contracts remain in their owning backends;
`ridu.generated.ts` is an unchanged generated SDK contract copied from Ridu.

From the repository root, install with `bun install`, then use `CMS_BACKEND=ridu bun run dev`
or `CMS_BACKEND=payload bun run dev`. Create an ordinary account in the web app and try a note, a link,
an uploaded image, group ordering, move/copy, and a shared collection. The native admin
has a separate administrator account.

From this directory:

```sh
bun run format:check
bun run check
bun run test
PUBLIC_CMS_BACKEND=ridu PUBLIC_CMS_URL=http://localhost:18087 ORIGIN=http://localhost:4177 bun run build
PUBLIC_CMS_BACKEND=payload PUBLIC_CMS_URL=http://localhost:18088 ORIGIN=http://localhost:4178 bun run build
```

The same browser suite runs against the explicit pair of disposable services selected
by `CMS_E2E=1 CMS_BACKEND=ridu|payload CMS_URL=... WEB_URL=... bun run test:e2e`.
Use `CMS_DEV_E2E=1` only with a Vite dev server for the two remote-module probes.
Native admin journeys additionally require `CMS_ADMIN_E2E=1` and a fresh CMS with
no administrator yet. Default `test:e2e` only checks public pages.

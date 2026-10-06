# Quikmarq: Ridu and Payload

The same small bookmark app, backed by either [Ridu](https://riducms.com) or
[Payload](https://payloadcms.com). Save notes and links, upload images, organise
collections, and share a collection. One SvelteKit frontend uses each CMS's native API.

This is a working app you can deploy and inspect yourself. Each CMS has its own
SQLite database, uploads and accounts. The CMS/admin/API and the SvelteKit frontend
run as separate services, so Railway shows their memory separately.

## Try it locally

Requires Bun 1.4.0, Go 1.25.13 or newer, and Node 24.

```sh
bun install --frozen-lockfile
bun run dev
```

Open <http://127.0.0.1:4177> and create an account. The default is Ridu.
To run the Payload version instead:

```sh
CMS_BACKEND=payload bun run dev
```

Open <http://127.0.0.1:4178>. To run both:

```sh
bun run dev --all
```

Local scripts create separate databases, upload directories and random secrets
under ignored `.data/ridu` and `.data/payload`. The same frontend source is used
for both; cookies and auth channels are scoped to the chosen CMS. Local HTTP
cookie settings are only applied by these local scripts.

## Production builds

Build and run both versions locally in production mode:

```sh
bun run build:comparison
bun run serve:comparison
```

Use the same two application URLs as above. Each CMS also provides its native admin:

- Ridu: <http://127.0.0.1:18087/admin>
- Payload: <http://127.0.0.1:18088/admin>

App accounts are ordinary users. The admin has its own first-administrator setup.
No universal demo/admin password is shipped.

For an independent frontend build, set `PUBLIC_CMS_BACKEND` to `ridu` or `payload`
and `PUBLIC_CMS_URL` to the CMS's public origin, set `ORIGIN` to the frontend's
public origin, then run `bun run build:web`.
The Node adapter is the default; `WEB_ADAPTER=vercel` builds for Vercel.

## Deploy on Railway

Choose either version. Each template supplies its own domains, generated secrets,
two services and a persistent volume; no environment variables need filling in.

**Ridu**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/quikmarq-with-ridu)

**Payload**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/quikmarq-with-payload)

| Template | CMS service | Frontend service | Persistent data |
| --- | --- | --- | --- |
| Ridu | Go binary with embedded admin | Shared SvelteKit app, Ridu adapter | SQLite and local uploads |
| Payload | Payload/Next.js server | Shared SvelteKit app, Payload adapter | SQLite and local uploads |

The service definitions and template maintenance steps are in [deploy/README.md](deploy/README.md).
Railway's template deployment currently provisions a 5 GB volume; the direct IaC
definition requests 1 GB. Both store the database and uploads at `/data`.

Both CMS services run one replica in the same region. No external database,
bucket credentials, memory cap, or forced garbage collection is needed.
SQLite and local uploads are deliberately scoped to one host.

## Use the app and inspect memory

1. Deploy either version, or both in the same Railway workspace.
2. Sign up in each app and make the same few notes, links and image bookmarks.
3. Try edits, collections and sharing; each installation keeps its own data.
4. Open the CMS service's Metrics tab in Railway and inspect its RAM after startup
   settles, while using the app, and after leaving it idle.

The frontend service is separate from the CMS. Railway's reported service RAM
is not Node's heap, Go's allocated bytes, or a build's peak. Your account, data
and usage can affect the result. This repository doesn't display a performance
score or assume a particular memory saving.

## Source layout

```text
apps/web/          one SvelteKit UI, two application-specific clients
backends/ridu/     executable Go config, generated contracts, embedded admin
backends/payload/  Payload config, native REST API and Next.js admin
scripts/           local development, production pair and contract sync
.railway/          current Railway infrastructure-as-code entry
deploy/           service definitions and template release guide
```

Generated contracts stay with their CMS. The shared UI uses a finite bookmark,
collection and account model; neither CMS pretends to expose the other's API.
Run `bun run generate` after changing backend config. `bun run generate:check`
checks the Ridu contract and its frontend copy.

Both clients preserve native API behavior. Ridu edits use its versioned publish
operation; Payload edits use `PATCH` with an application revision guard. Ridu
0.15 does not revision-guard deletes; the Payload application does. These are
application-level implementations, not a claim of identical internal work.

## Verification

```sh
bun run check
bun run test
bun run generate:check
```

The browser journey exercises the same frontend against both CMSs. See
[apps/web/README.md](apps/web/README.md) for the disposable and hosted test commands.
Production image builds use the root as their build context:

```sh
docker build --platform linux/amd64 -f backends/ridu/Dockerfile -t quikmarq-ridu .
docker build --platform linux/amd64 -f backends/payload/Dockerfile -t quikmarq-payload .
docker build --platform linux/amd64 -f apps/web/Dockerfile --build-arg PUBLIC_CMS_BACKEND=ridu --build-arg PUBLIC_CMS_URL=https://your-ridu-cms.up.railway.app --build-arg ORIGIN=https://your-ridu-web.up.railway.app -t quikmarq-web .
```

The original `quikmarq-ridu` and `quikmarq-payload` deployments are independent
and are not updated by this repository.

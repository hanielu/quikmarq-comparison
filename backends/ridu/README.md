# Quikmarq Ridu backend

Quikmarq's original Go content model, native Ridu REST API, and embedded admin,
using the published Ridu 0.16.0 packages. The shared SvelteKit frontend lives in
`../../apps/web`; this directory owns only the CMS.

From the comparison repository root, install with `bun install`. Run backend
commands from this directory, or use `bun run --cwd backends/ridu <command>`.

```sh
bun run dev
bun run generate:check
bun run check
bun run test
bun run build
```

The generated TypeScript client is `generated/ridu.generated.ts`. Ridu owns it,
alongside the schema, OpenAPI, Go contracts and plugin registries. Change the Go
configuration in `content/` and run `bun run generate`; update the frontend's
copied client when its contract changes. `PROJECT.md` records file ownership.

Development uses `.ridu/development.sqlite` and `.ridu/uploads`. An empty CMS
opens `/admin` with the first-admin setup; app users register through the shared
frontend. Admin and app accounts are separate, as in the original application.

## Production

Build the image from the repository root:

```sh
docker build -f backends/ridu/Dockerfile -t quikmarq-ridu .
```

The image runs only the Go binary, with its admin embedded. It includes the exact
committed SQLite migration history and applies it before the listener becomes
ready. It rejects changed or missing migration files and readiness bypasses.

Run one replica with a persistent volume mounted at `/data`. Database and uploads
use `/data/quikmarq.sqlite` and `/data/uploads`; no bucket or S3 credentials are
needed. Both must remain on durable host-local storage. SQLite does not support
horizontal replicas or zero-downtime schema migrations.

Set `QUIKMARQ_SHARE_SECRET` to a stable generated secret of at least 32 bytes.
Set `RIDU_ALLOWED_HOSTS` to the CMS public hostname and Railway's health-check
hostname, and `RIDU_ALLOWED_ORIGINS` to the frontend's and CMS's exact public
origins. Include the CMS origin for admin authentication behind an HTTPS edge
whose forwarded protocol headers are not trusted. Leave proxy CIDRs unset until
the immediate proxy networks and header sanitization are verified. Keep secure
cookies enabled for HTTPS. Use `/readyz` as the platform health check.
See `.env.example` for the local and production settings.

The startup command is `./dist/quikmarq-ridu serve-with-migrations` outside Docker.
Its working directory must contain `migrations/`. The same command handles a fresh
volume and verifies migrations on restart. For future schema edits, create and
review an immutable migration before shipping; do not replace committed artifacts.

# Quikmarq Payload CMS

This is a normal Payload 3 application in Next.js. Payload owns the admin at `/admin`, the REST API at `/api`, auth, upload processing, and SQLite migrations. `groups`, `bookmarks`, and `assets` keep their application behavior in collection access rules and hooks. Payload's generated `src/payload-types.ts` is the schema contract; `src/payload.d.ts` applies its module augmentation only inside this package.

## Runtime

- `DATABASE_URL=file:/data/quikmarq-payload.sqlite` uses the service's persistent SQLite volume. The adapter uses UUID IDs, WAL, transactions, and committed migrations during production Payload initialization. This deployment must run one Node process on one host.
- `PAYLOAD_SECRET` is required in production. `QUIKMARQ_SHARE_SECRET` signs stable group capabilities and short-lived media capabilities and must contain at least 32 bytes.
- `CMS_URL` is the public CMS origin used to construct media URLs. `WEB_URL` is the application origin admitted by CORS and CSRF. `UPLOAD_DIR` selects local upload storage when S3 is absent.
- Local uploads are the demo default. Set `UPLOAD_DIR=/data/uploads` alongside the SQLite file on the service's persistent volume. The native Payload admin and the application's private/share media endpoints use these files. `/readyz` returns 200 after Payload initializes, migrations run, SQLite responds, and a small upload-storage write/read/delete probe succeeds.
- S3 remains optional: configure `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` together. Partial configurations fail at initialization. The official Payload S3 adapter uses the private `quikmarq-payload/uploads` prefix and virtual-host requests. Readiness verifies the selected bucket with the same write/read/delete probe.
- Run `bun run --cwd backends/payload generate`, `check`, `test`, and `build` from the workspace root. The build includes standalone Node output and its static assets. The server entry is `backends/payload/.next/standalone/backends/payload/server.js` and reads `PORT` at runtime.
- Build the container from the comparison repository root with `docker build -f backends/payload/Dockerfile .`. The builder uses the root Bun workspace; the final image runs Node 24 and contains only Next.js standalone output. Mount one persistent volume at `/data`, keep one replica, and provide deployment secrets and public origins as environment variables.

### SQLite write scheduling

The app retains Payload's documented `transactionOptions: {}` so nested hooks, revision claims, and cascades are atomic. In the installed Payload 3.90.2 SQLite adapter and `@libsql/client` 0.14.0, `busyTimeout` is set on the initial connection, but libSQL opens a fresh connection after each transaction. A local probe measured `PRAGMA busy_timeout` at 5000 ms before the first transaction and 0 ms afterward. Concurrent synchronous `BEGIN`s can therefore return `SQLITE_BUSY`, including while the first transaction awaits an upload hook. No supported adapter option restores the timeout on every connection, and Drizzle's libSQL transaction method ignores its `transactionOptions` argument.

`src/database/sqlite.ts` wraps only the official adapter's transaction start/end methods with an asynchronous FIFO for this single-process SQLite file. It leaves Payload's operations, request transaction reuse, read queries, and the official adapter's commit/rollback implementation intact. It does not schedule direct writes that Payload intentionally performs outside a transaction, such as failed-login attempt counters. This queue is not a cross-process lock; do not add replicas or another writer to this SQLite volume. The initial RAM comparison was measured before the queue was added.

## Application API

Payload's native REST collections are `/api/admins`, `/api/users`, `/api/groups`, `/api/bookmarks`, and `/api/assets`. Public signup uses `POST /api/users`; app login uses `POST /api/users/login`. The Payload admin has a distinct `admins` auth collection. Browser calls from the separate web origin send `Authorization: JWT <token>`; collection reads request `depth=0` for IDs or bookmark `depth=1` to populate images.

Groups and bookmarks expose numeric `revision` values. Application `PATCH` and `DELETE` calls send `If-Match: <revision>`; a stale value returns 409, and a missing value returns 428. Payload admin edits claim the current revision internally. Group rank is a 32-character lowercase base-36 key. Deleting the final group fails; deleting another group removes its bookmarks and assets in the same SQLite transaction. Bookmark `kind` is fixed after creation, and its server-generated `position` changes only when moved to a different group. Media bookmarks keep their text in `caption`; asset `alt` is accessibility text.

Upload files with native `POST /api/assets` multipart `file` and `_payload` JSON (`group`, optional `alt`). JPEG/PNG uploads are limited to 4 MB and create a 320×320 `thumb`. Images are owned by their uploader and cannot be moved between groups. `POST /api/assets/:id/duplicate` with `{ "group": "...", "alt": "..." }` copies the bytes into another owned group and returns a Payload asset document. Removed bookmark images are deleted when no bookmark in the original group still references them.

The narrow custom endpoints are:

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /api/bookmark-metadata` | `{ "url": "https://..." }` authenticated | `{ normalizedURL, title, description, favicon, previewImage, videoProvider?, videoID? }` |
| `GET /api/groups/:id/share` | authenticated owner/admin | `{ sharingEnabled, token? }` |
| `POST /api/groups/:id/share` | `{ "rotate": boolean }` authenticated owner/admin | `{ sharingEnabled: true, token }` |
| `DELETE /api/groups/:id/share` | authenticated owner/admin | `{ sharingEnabled: false }` |
| `POST /api/share/resolve` | `{ token, page?, limit?, query?, kind? }` public | `{ group: {id,name}, docs, pagination }` narrow public DTO |
| `POST /api/assets/signed-urls` | `{ items: [{id,size?:"thumb"}] }` authenticated | `{ urls: [{id,url}] }` |

`GET /api/share/media/:capability` and `GET /api/assets/media/:capability` serve only checked image bytes with `private, no-store`. Sharing uses stable HMAC group tokens; rotate/disable increments `shareVersion` and invalidates prior group and media capabilities. Shared media URLs expire after ten minutes and recheck current group state and asset ownership on every fetch. Private media URLs expire after thirty minutes and recheck the issuing Payload session, so logout revokes them. The public share response contains no owner or auth data.

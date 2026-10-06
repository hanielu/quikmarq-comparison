# Ridu backend ownership

The executable Go configuration is the content source of truth. This backend is
part of the root Bun workspace; it uses published Ridu 0.16.0 Go and npm packages.

| Location | Owner and purpose |
| --- | --- |
| `content/*.go` | Application collections, fields, access, hooks and custom endpoints. |
| `cmd/server/main.go` | Application runtime, storage, HTTP and migration-startup wiring. |
| `admin/src/admin.config.ts` and local components | Application admin customizations. |
| `ridu.toml` | Project layout and generation destinations. |
| `ridu.plugins.json` | Reviewed paired Go/admin plugin registration. |
| `generated/` | Ridu-owned schema, OpenAPI and exact Go/TypeScript contracts. |
| `content/ridu_plugins.generated.go`, `admin/src/ridu.plugins.generated.ts` | Ridu-owned plugin registries. |
| `migrations/*.ridu.json` | Immutable reviewed production migrations. |
| `internal/adminassets/dist/` | Disposable admin build output embedded in the binary. |
| `.ridu/` | Disposable development database, uploads and CLI/build caches. |

Do not edit generated contracts by hand. Run `bun run generate` after authoring
configuration changes, `bun run generate:check` to check drift, and `bun run check`
for the project contract. Use `bun run ridu -- migrate create --name <change>` to
create a migration before production schema changes, and review its plan.

`bun run build` builds the customized admin and production binary. `bun run start`
applies the adjacent committed migrations and starts the server with strict
readiness checks. See `README.md` for durable SQLite and upload storage settings.

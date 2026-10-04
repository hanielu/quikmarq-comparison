# Railway deployment and templates

The service definition is `railway-project.ts`. `.railway/railway.ts` selects
`ridu`, `payload`, or `both` through `DEMO_BACKENDS` (default: both). It uses the
current official Railway TypeScript SDK. The original app deployments are outside
this project.

## Review the definition

```sh
bun run railway:plan
DEMO_BACKENDS=ridu bun run railway:plan
DEMO_BACKENDS=payload bun run railway:plan
```

These commands render the desired configuration locally; they do not call Railway.
For a fork, set `QUIKMARQ_SOURCE_REPO=your-account/your-repository`.

Each pair has:

- A CMS service built from `backends/ridu/Dockerfile` or `backends/payload/Dockerfile`.
- A frontend built from the same `apps/web/Dockerfile`, with the backend selected at build time.
- One volume mounted at `/data` on the CMS; SQLite and uploads live there.
- One replica in `us-west2`, `/readyz` healthchecks, and app sleeping disabled.
- Separate public CMS and web domains, with origins referenced by service name.

The API/frontend ports are 8080/3000. The source directory is the repository root
for every Docker build. Do not set a backend root directory that removes the
workspace manifest or shared lockfile from its build context.

SQLite migrations run after the volume is mounted, during normal startup.
There is no pre-deploy SQLite migration command. The Ridu runtime contains only
the compiled Go binary, migration artifacts and certificates; the admin is embedded.
Payload runs its standard standalone Next.js output on Node 24.

## Prepare the source project

After the source is reviewed and published, use two **new** Railway projects
named `quikmarq-comparison-ridu` and `quikmarq-comparison-payload`, selecting
`DEMO_BACKENDS=ridu` or `DEMO_BACKENDS=payload` respectively. Do not generate a template from the existing Quikmarq
production project: it includes unrelated services and credentials.

Create the services and volumes using the definition. Generate a public domain
for each CMS (port 8080) and frontend (port 3000) before attaching the GitHub
sources. Generated platform domains are managed by Railway, so they are not
hard-coded into the IaC file.

The frontend needs `PUBLIC_CMS_BACKEND`, `PUBLIC_CMS_URL` and `ORIGIN` during
its Docker build. The Dockerfile declares these build arguments; Railway supplies
them from service variables. SvelteKit uses `ORIGIN` for its canonical request
origin and session validation. Rebuild the frontend after changing either public
domain. [Railway's Dockerfile guide](https://docs.railway.com/builds/dockerfiles)
describes this build argument behavior.

Give each CMS its own random `QUIKMARQ_SHARE_SECRET` of at least 32 bytes. Payload
also needs a random `PAYLOAD_SECRET`. IaC uses `preserve()` for these secrets so a
later apply doesn't rotate them. Never put actual values in source. The template
composer will replace these source-project secrets with generated defaults.

`PUBLIC_CMS_URL`, CORS and `ORIGIN` refer to the generated service domains.
Ridu explicitly permits both the web origin and its own public admin origin.
Keep secure cookies on in hosted deployments and leave trusted proxy CIDRs unset
until the immediate proxy/header policy is known.

To maintain the Ridu source project through the CLI (choose its project when
linking, and use `payload` for the other source project):

```sh
bunx @railway/cli@5.63.1 login
bunx @railway/cli@5.63.1 link
DEMO_BACKENDS=ridu bunx @railway/cli@5.63.1 config plan
DEMO_BACKENDS=ridu bunx @railway/cli@5.63.1 config apply
```

Always inspect the live plan and its project/environment before applying. The
configuration owns its whole selected project; applying it to an unrelated project
could remove resources omitted from this file.

## Create two template drafts

Generate each template from its corresponding source project. Each source contains
exactly one CMS, its frontend and its data volume, so unrelated services and
credentials cannot enter the template.

Railway's supported flow is **Project Settings → Generate Template from Project**.
The current CLI supports the same operation:

```sh
bunx @railway/cli@5.63.1 templates create --project PROJECT_ID --environment ENVIRONMENT_ID --json
```

This creates an unpublished draft. In the template composer:

1. Retain exactly one CMS, its frontend, and its `/data` volume.
2. Check both GitHub sources point at this public repository and use root build contexts.
3. Set the corresponding Dockerfile paths and enable public HTTP networking for both services,
   with target ports CMS `8080` and frontend `3000`, so their public-domain
   references exist before either source builds.
4. Set `QUIKMARQ_SHARE_SECRET` to `${{secret(64)}}`; set Payload's `PAYLOAD_SECRET`
   to another `${{secret(64)}}`. Do not retain source-project credentials.
5. Keep the public-domain references, local storage paths, one replica and readiness checks.
6. Remove any source-project-specific domain, environment value or identifier.
7. Deploy a fresh copy from the draft, then exercise signup, notes, images,
   sharing, native admin setup and restart persistence.

Publish the drafts as **Quikmarq with Ridu** and **Quikmarq with Payload**. Save
the real resulting URLs in the root README and use Railway's provided deployment
button. No placeholder template code should be presented as a working button.

The hosted test creates only ordinary accounts and their own disposable content.
It does not initialize an administrator or reset an existing database.

## Reader experience

A reader chooses a template, deploys it in their workspace, opens the frontend
and signs up. They can inspect the CMS's native admin separately and watch the
CMS service's RAM in their own Railway dashboard. Deploying both templates gives
independent data/accounts with the same user interface.

The two frontend services use the same source but are separately built with their
CMS selection. Their RAM stays visible separately from the CMS comparison.

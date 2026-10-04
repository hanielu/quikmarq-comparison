# Deploy and Host Quikmarq with Payload on Railway

Quikmarq is a small bookmark app for notes, links and images. This version uses
PayloadCMS and its Next.js admin/API, with the same SvelteKit frontend as the Ridu version.

## About Hosting Quikmarq with Payload

This template deploys the frontend and CMS as separate services. A persistent
volume holds SQLite and uploads. Both services run production Node builds.
After deployment, open the frontend and create your own account.

## Why Deploy Quikmarq with Payload on Railway

Try a working Payload app and inspect its CMS memory usage in your own Railway
Metrics tab. The Ridu template uses the same frontend source, so you can also
try that version and compare your own deployments.

## Common Use Cases

- Save notes and links in named collections.
- Upload image bookmarks and share a collection.
- Explore Payload's native admin, collections and API.
- Compare the hosting footprint of the two CMS implementations.

## Dependencies for Quikmarq with Payload

A Railway account and a browser. Both services build from the public comparison
repository. There is no separate database service or required object-storage bucket.

### Deployment Dependencies

- One CMS replica and one frontend replica in the same region.
- One persistent volume mounted at `/data`, holding SQLite and local uploads.
- Generated public domains and deployment-generated authentication/share secrets.
- A standalone production Payload/Next.js CMS and a Node SvelteKit frontend.

The local database/upload setup is for one host. The app's own admin setup is
separate from ordinary frontend signup. No shared admin credentials are provided.

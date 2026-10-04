# Deploy and Host Quikmarq with Ridu on Railway

Quikmarq is a small bookmark app for notes, links and images. This version uses
RiduCMS, with one shared SvelteKit frontend and a Go CMS/API with its admin embedded.

## About Hosting Quikmarq with Ridu

This template deploys the frontend and CMS as separate services. A persistent
volume holds SQLite and uploads. The CMS is one Go binary; the frontend runs on
Node. After deployment, open the frontend and create your own account.

## Why Deploy Quikmarq with Ridu on Railway

Try a working Ridu app and inspect its CMS memory usage in your own Railway
Metrics tab. The Payload template uses the same frontend source, so you can also
try that version and compare your own deployments.

## Common Use Cases

- Save notes and links in named collections.
- Upload image bookmarks and share a collection.
- Explore Ridu's native admin, Go configuration and API.
- Compare the hosting footprint of the two CMS implementations.

## Dependencies for Quikmarq with Ridu

A Railway account and a browser. Both services build from the public comparison
repository. There is no separate database service or required object-storage bucket.

### Deployment Dependencies

- One CMS replica and one frontend replica in the same region.
- One persistent volume mounted at `/data`, holding SQLite and local uploads.
- Generated public domains and a deployment-generated share secret.
- A production Go binary with embedded admin, and a Node SvelteKit frontend.

The local database/upload setup is for one host. The app's own admin setup is
separate from ordinary frontend signup. No shared admin credentials are provided.

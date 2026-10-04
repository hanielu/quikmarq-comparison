FROM oven/bun:1.4.0 AS bun

FROM node:24.13.0-bookworm-slim AS builder
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
# Build-only values satisfy config evaluation. Deployment secrets are read at runtime.
RUN PAYLOAD_SECRET=build-only-not-a-deployment-secret \
    QUIKMARQ_SHARE_SECRET=build-only-share-secret-not-for-deployment \
    bun run --cwd backends/payload build

FROM node:24.13.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:/data/quikmarq-payload.sqlite \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=builder /app/backends/payload/.next/standalone ./
RUN mkdir -p /data/uploads
WORKDIR /app/backends/payload
EXPOSE 3000
CMD ["node", "server.js"]

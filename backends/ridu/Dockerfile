# Build from the comparison repository root:
# docker build -f backends/ridu/Dockerfile -t quikmarq-ridu .
FROM node:24-bookworm-slim AS build
COPY --from=golang:1.25.13-bookworm /usr/local/go /usr/local/go
COPY --from=oven/bun:1.4.0 /usr/local/bin/bun /usr/local/bin/bun
ENV PATH="/usr/local/go/bin:${PATH}" \
    CGO_ENABLED=0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY . .
RUN bun install --frozen-lockfile
WORKDIR /source/backends/ridu
RUN bun run generate:check && bun run build

# The customized Svelte admin is embedded in the binary. No JS server or build
# tooling is required by this runtime image.
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /source/backends/ridu/dist/quikmarq-ridu /app/quikmarq-ridu
COPY --from=build /source/backends/ridu/migrations/*.ridu.json /app/migrations/
ENV PORT=8080 \
    RIDU_SQLITE_PATH=/data/quikmarq.sqlite \
    RIDU_UPLOAD_PATH=/data/uploads \
    RIDU_READINESS_DRAIN_DELAY=-1s
EXPOSE 8080
CMD ["/app/quikmarq-ridu", "serve-with-migrations"]

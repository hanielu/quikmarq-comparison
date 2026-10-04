FROM oven/bun:1.4.0 AS build
WORKDIR /workspace
COPY . .
RUN bun install --frozen-lockfile
ARG PUBLIC_CMS_BACKEND
ARG PUBLIC_CMS_URL
ARG ORIGIN
ENV PUBLIC_CMS_BACKEND=$PUBLIC_CMS_BACKEND
ENV PUBLIC_CMS_URL=$PUBLIC_CMS_URL
ENV ORIGIN=$ORIGIN
RUN bun run --cwd apps/web build

FROM oven/bun:1.4.0 AS dependencies
WORKDIR /deps
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json
COPY backends/payload/package.json ./backends/payload/package.json
COPY backends/ridu/package.json ./backends/ridu/package.json
COPY backends/ridu/admin/package.json ./backends/ridu/admin/package.json
RUN bun install --frozen-lockfile --production --filter @quikmarq-comparison/web

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app/apps/web
# Keep the production web dependency subset and its Bun workspace symlink layout.
COPY --from=dependencies /deps/node_modules /app/node_modules
COPY --from=dependencies /deps/apps/web/node_modules ./node_modules
COPY --from=build /workspace/apps/web/package.json ./package.json
COPY --from=build /workspace/apps/web/build ./build
USER node
EXPOSE 3000
CMD ["node", "build/index.js"]

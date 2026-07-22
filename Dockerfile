# syntax=docker/dockerfile:1
FROM node:22.15-alpine AS deps
WORKDIR /app
# Token for the private @triolla-io GitHub Packages registry, passed as a
# build arg (set NPM_GITHUB_TOKEN in Coolify env, "Available at Buildtime").
# It's used only for this npm ci and lives solely in this throwaway deps
# stage — the final runner image copies node_modules, never ~/.npmrc.
ARG NPM_GITHUB_TOKEN
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -n "$NPM_GITHUB_TOKEN" ]; then \
      npm config set "//npm.pkg.github.com/:_authToken=$NPM_GITHUB_TOKEN"; \
    fi \
 && npm ci --ignore-scripts \
 && rm -f "$HOME/.npmrc"
COPY prisma ./prisma
RUN npx prisma generate && echo "export * from './client';" > ./lib/generated/prisma/index.ts

FROM node:22.15-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/lib/generated/prisma ./lib/generated/prisma
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Persist Turbopack's build filesystem cache across deploys (warm rebuilds).
# Requires experimental.turbopackFileSystemCacheForBuild in next.config.ts.
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:22.15-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/public ./public
COPY --from=builder /app/extension/dist ./extension/dist
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# scripts/ + lib/ + tsconfig.json let ops scripts (e.g. scripts/staging/anonymize.ts)
# run inside the container via `npx tsx` — they are inert at serve time.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/tsconfig.json ./tsconfig.json
EXPOSE 3000
ENV PORT=3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]

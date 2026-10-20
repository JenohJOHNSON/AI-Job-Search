# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S elan -g 1001 && adduser -S elan -u 1001 -G elan
USER elan

# The background worker is built from Dockerfile.worker: Railway always builds a Dockerfile's last
# stage and has no target setting, so each service needs its own file.
FROM base AS web
ENV PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=elan:elan /app/.next/standalone ./
COPY --from=builder --chown=elan:elan /app/.next/static ./.next/static
COPY --from=builder --chown=elan:elan /app/public ./public
# Keep Prisma's migration CLI and committed SQL beside the standalone server so
# every Railway deployment can bring a new Neon database up to date before serving.
# Only this image migrates. Migrations use DIRECT_URL when set: Prisma's migration lock is a
# session advisory lock, which a transaction-mode pooler (Neon "-pooler" hosts) can leave held.
COPY --from=builder --chown=elan:elan /app/node_modules ./node_modules
COPY --from=builder --chown=elan:elan /app/package.json /app/tsconfig.json ./
COPY --from=builder --chown=elan:elan /app/prisma ./prisma
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health || exit 1
CMD ["sh", "-c", "DATABASE_URL=\"${DIRECT_URL:-$DATABASE_URL}\" ./node_modules/.bin/prisma migrate deploy && exec env PORT=3000 HOSTNAME=0.0.0.0 node server.js"]

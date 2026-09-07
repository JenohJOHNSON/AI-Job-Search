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

FROM base AS web
COPY --from=builder --chown=elan:elan /app/.next/standalone ./
COPY --from=builder --chown=elan:elan /app/.next/static ./.next/static
COPY --from=builder --chown=elan:elan /app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health || exit 1
CMD ["node", "server.js"]

FROM base AS worker
COPY --from=builder --chown=elan:elan /app/node_modules ./node_modules
COPY --chown=elan:elan package.json tsconfig.json ./
COPY --chown=elan:elan prisma ./prisma
COPY --chown=elan:elan lib ./lib
COPY --chown=elan:elan ai ./ai
COPY --chown=elan:elan matching ./matching
COPY --chown=elan:elan providers ./providers
COPY --chown=elan:elan workers ./workers
CMD ["./node_modules/.bin/tsx", "workers/main.ts"]

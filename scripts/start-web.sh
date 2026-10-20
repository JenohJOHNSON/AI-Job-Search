#!/bin/sh
# Web container entrypoint: apply pending migrations, then start the standalone Next.js server.
set -e

# Migrations need a direct connection: Prisma's migration lock is a session advisory lock, which a
# transaction-mode pooler can leave held, so every later deploy times out with P1002. Use DIRECT_URL
# when set. Otherwise a Neon pooled host ("<endpoint>-pooler.<region>.aws.neon.tech") is turned into
# Neon's direct host by removing "-pooler"; any other DATABASE_URL is used unchanged.
migrate_url="${DIRECT_URL:-$(printf '%s' "$DATABASE_URL" | sed 's#\(@[^/?]*\)-pooler\.#\1.#')}"
DATABASE_URL="$migrate_url" ./node_modules/.bin/prisma migrate deploy

exec env PORT=3000 HOSTNAME=0.0.0.0 node server.js

# AIDetective — single-container deployment.
#
# How this build works (read before "fixing" the Dockerfile):
#  - next.config.ts enables `output: "standalone"`. The build stage therefore
#    runs the repo's own `bun run build`, which also copies .next/static and
#    public/ into .next/standalone (required for a working UI).
#  - The runtime starts the self-contained server: bun .next/standalone/server.js
#    (verified start command; `next start` is not used with standalone output).
#  - The full /app copy keeps the Prisma CLI available so the container can
#    apply the schema at startup (`bun run db:push`, idempotent).
#  - SQLite is the local-first database. Mount volumes for /app/db and
#    /app/uploads (see docker-compose.yml) so data survives replacement.

# ── Stage 1: dependencies ─────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN bunx prisma generate
# Runs the repo build script: `next build` + static/public copy into standalone.
RUN bun run build

# ── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    # Safe defaults for plain `docker run` (no env file). docker-compose's
    # env_file overrides these with your .env values.
    DATABASE_URL=file:/app/db/custom.db \
    AIDETECTIVE_UPLOADS_DIR=/app/uploads
COPY --from=build /app /app
RUN mkdir -p /app/db /app/uploads
EXPOSE 3000
# Apply the schema (idempotent) and start the standalone server.
CMD ["sh", "-c", "bun run db:push && bun .next/standalone/server.js"]

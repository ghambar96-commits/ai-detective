# AIDetective — single-container deployment.
#
# Notes on this build (read before "fixing" the Dockerfile):
#  - next.config.ts does NOT enable `output: "standalone"`, so the image runs
#    the regular `.next` build via `next start` (not `.next/standalone/server.js`).
#  - The build needs devDependencies (TypeScript, Tailwind, ESLint), hence a
#    plain `bun install` — not `--production`.
#  - SQLite is the local-first database. The container applies the Prisma
#    schema at startup (`bun run db:push`) and then serves on port 3000.
#  - Mount volumes for /app/db and /app/uploads (see docker-compose.yml) so
#    data survives container replacement.

# ── Stage 1: dependencies ─────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN bunx prisma generate
RUN bunx next build

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
# Apply the schema (idempotent) and start the server.
CMD ["sh", "-c", "bun run db:push && bunx next start -p 3000"]

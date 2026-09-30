#!/usr/bin/env bun
/**
 * AIDetective — one-command project setup (`bun run setup`).
 *
 * 1. Creates .env from .env.example when missing (never overwrites).
 * 2. Rewrites the SQLite DATABASE_URL to an absolute project path: the Prisma
 *    CLI resolves relative SQLite paths against prisma/ while the generated
 *    client resolves them elsewhere at runtime — an absolute path makes both
 *    behave identically. (This was a real fresh-install failure mode.)
 * 3. Ensures the db/ and uploads/ directories exist.
 *
 * Idempotent: safe to run repeatedly.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env");

if (!existsSync(envPath)) {
  cpSync(path.join(root, ".env.example"), envPath);
  console.log("✓ Created .env from .env.example");
} else {
  console.log("• .env already exists — leaving your configuration untouched");
}

mkdirSync(path.join(root, "db"), { recursive: true });
mkdirSync(path.join(root, "uploads"), { recursive: true });
console.log("✓ Ensured db/ and uploads/ directories exist");

const absoluteUrl = `file:${path.join(root, "db", "custom.db").split(path.sep).join("/")}`;
let env = readFileSync(envPath, "utf8");
const relativePattern = /^(\s*DATABASE_URL\s*=\s*)file:\.\/db\/custom\.db\s*$/m;

if (relativePattern.test(env)) {
  env = env.replace(relativePattern, `$1${absoluteUrl}`);
  writeFileSync(envPath, env);
  console.log(`✓ Pointed DATABASE_URL at an absolute path: ${absoluteUrl}`);
} else {
  console.log(`• DATABASE_URL is already customized (expected form: ${absoluteUrl})`);
}

console.log("\nSetup complete. Next steps:");
console.log("  bun run dev        # dashboard + REST API on http://localhost:3000");
console.log("  docker compose up --build   # or run everything in Docker\n");

/**
 * AIDetective — API key authentication & rate limiting.
 *
 * - Plaintext keys are returned ONCE at creation and never stored (sha256 only).
 * - Keys are never logged (see logger redaction).
 * - Local dashboard mode: when requireApiKey=false, unauthenticated local
 *   requests are allowed; if a key IS provided it is validated anyway.
 * - Optional per-key rate limit (requests/minute, sliding window, in-memory).
 *   TODO(phase-3): swap for a shared store when running multiple workers.
 */
import { createHash, randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AppError } from "../core/errors";
import { createLogger } from "../core/logger";
import { getSettingsService } from "../services/settings";

const log = createLogger("security");

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  rateLimit: number | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateApiKey(): { plaintext: string; prefix: string; hash: string } {
  const plaintext = `adk_${randomBytes(24).toString("hex")}`;
  return { plaintext, prefix: plaintext.slice(0, 12), hash: hashApiKey(plaintext) };
}

export async function createApiKey(name: string, rateLimit?: number | null) {
  const { plaintext, prefix, hash } = generateApiKey();
  const record = await db.apiKey.create({
    data: { name, prefix, keyHash: hash, rateLimit: rateLimit ?? null },
  });
  log.info("api key created", { keyId: record.id, name });
  return { record, plaintext };
}

// ─── In-memory sliding-window rate limiter ────────────────────────────────────

const g = globalThis as unknown as { __aidetectiveRateStore?: Map<string, number[]> };
const rateStore = (g.__aidetectiveRateStore ??= new Map<string, number[]>());

function checkRateLimit(keyId: string, limitPerMinute: number): boolean {
  if (limitPerMinute <= 0) return true;
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (rateStore.get(keyId) ?? []).filter((t) => t > windowStart);
  if (hits.length >= limitPerMinute) {
    rateStore.set(keyId, hits);
    return false;
  }
  hits.push(now);
  rateStore.set(keyId, hits);
  return true;
}

export interface AuthResult {
  ok: boolean;
  localMode: boolean;
  keyId?: string;
}

function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim() || null;
  const xKey = req.headers.get("x-api-key");
  if (xKey) return xKey.trim();
  return null;
}

/** Authenticate a request against the configured security mode. Throws AppError. */
export async function authenticate(req: NextRequest): Promise<AuthResult> {
  const settings = await getSettingsService().getSecurity();
  const token = extractToken(req);

  if (!token) {
    if (settings.requireApiKey) {
      throw new AppError(
        "UNAUTHORIZED",
        "API key required. Pass it as 'Authorization: Bearer <key>' or 'X-API-Key: <key>'."
      );
    }
    return { ok: true, localMode: true };
  }

  const keyHash = hashApiKey(token);
  const record = await db.apiKey.findUnique({ where: { keyHash } });

  if (!record || record.revokedAt) {
    log.warn("invalid api key presented", {});
    throw new AppError("UNAUTHORIZED", "Invalid or revoked API key");
  }

  if (record.rateLimit !== null && !checkRateLimit(record.id, record.rateLimit)) {
    throw new AppError("RATE_LIMITED", `Rate limit exceeded (${record.rateLimit} requests/minute for this key)`);
  }

  // fire-and-forget lastUsed update
  void db.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);

  return { ok: true, localMode: false, keyId: record.id };
}

import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, corsPreflight, jsonOk, readJson } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { createApiKey } from "@/lib/aidetective/security/auth";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

const createSchema = z.object({
  name: z.string().min(1).max(80),
  rateLimit: z.number().int().min(1).max(10_000).nullable().optional(),
});

/** GET /api/v1/api-keys — list keys (hashes/plaintext are never returned). */
export const GET = apiHandler(async () => {
  await ensureBootstrap();
  const keys = await db.apiKey.findMany({ orderBy: { createdAt: "desc" } });
  return jsonOk({
    total: keys.length,
    keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      rateLimit: k.rateLimit,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      revoked: Boolean(k.revokedAt),
      revokedAt: k.revokedAt?.toISOString() ?? null,
    })),
  });
});

/**
 * POST /api/v1/api-keys — create a key.
 * The plaintext key is shown exactly once in this response; only its sha256
 * hash is stored. Never logged.
 */
export const POST = apiHandler(async ({ req }) => {
  await ensureBootstrap();
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid API key payload", parsed.error.issues);
  const { record, plaintext } = await createApiKey(parsed.data.name, parsed.data.rateLimit ?? null);
  return jsonOk(
    {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      rateLimit: record.rateLimit,
      createdAt: record.createdAt.toISOString(),
      key: plaintext,
      notice: "Store this key now — it is never shown again and never stored in plaintext.",
    },
    undefined,
    201
  );
});

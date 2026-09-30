import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, corsPreflight, jsonOk, readJson } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

const createSchema = z.object({
  name: z.string().min(1).max(120),
  modality: z.enum(["text", "image", "audio", "document", "mixed"]),
  description: z.string().max(2000).optional(),
  labels: z.array(z.string().max(60)).max(20).optional(),
});

/** GET /api/v1/models — model registry (builtin detectors + LLM runtimes + custom entries). */
export const GET = apiHandler(async () => {
  await ensureBootstrap();
  const models = await db.model.findMany({ orderBy: [{ modality: "asc" }, { name: "asc" }] });
  return jsonOk({
    total: models.length,
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      modality: m.modality,
      provider: m.provider,
      location: m.location,
      status: m.status,
      capabilities: safeParse<string[]>(m.capabilities) ?? [],
      configuration: safeParse<Record<string, unknown>>(m.configuration) ?? {},
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
  });
});

const registerSchema = z.object({
  name: z.string().min(1).max(160),
  version: z.string().min(1).max(40),
  modality: z.enum(["text", "image", "audio", "document", "mixed"]),
  provider: z.string().min(1).max(60),
  location: z.enum(["local", "remote"]),
  status: z.enum(["available", "unavailable", "experimental", "disabled"]).default("experimental"),
  capabilities: z.array(z.string()).max(20).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
});

/** POST /api/v1/models — register an external/custom model metadata entry. */
export const POST = apiHandler(async ({ req }) => {
  await ensureBootstrap();
  const parsed = registerSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid model payload", parsed.error.issues);
  const m = await db.model.create({
    data: {
      name: parsed.data.name,
      version: parsed.data.version,
      modality: parsed.data.modality,
      provider: parsed.data.provider,
      location: parsed.data.location,
      status: parsed.data.status,
      capabilities: JSON.stringify(parsed.data.capabilities ?? []),
      configuration: JSON.stringify(parsed.data.configuration ?? {}),
    },
  });
  return jsonOk({ id: m.id, name: m.name }, undefined, 201);
});

function safeParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

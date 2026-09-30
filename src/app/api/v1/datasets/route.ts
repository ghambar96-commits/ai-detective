import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, corsPreflight, jsonOk, readJson } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

/** GET /api/v1/datasets — dataset registry. */
export const GET = apiHandler(async () => {
  await ensureBootstrap();
  const datasets = await db.dataset.findMany({ orderBy: { createdAt: "desc" } });
  return jsonOk({
    total: datasets.length,
    datasets: datasets.map((d) => ({
      id: d.id,
      name: d.name,
      modality: d.modality,
      description: d.description,
      labels: safeParse<string[]>(d.labels) ?? [],
      sampleCount: d.sampleCount,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      exportReady: false, // TODO(phase-3): import/export backends
    })),
  });
});

const createSchema = z.object({
  name: z.string().min(1).max(140),
  modality: z.enum(["text", "image", "audio", "document", "mixed"]),
  description: z.string().max(2000).optional(),
  labels: z.array(z.string().max(60)).max(20).optional(),
});

/** POST /api/v1/datasets — create a dataset (metadata + labels). */
export const POST = apiHandler(async ({ req }) => {
  await ensureBootstrap();
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid dataset payload", parsed.error.issues);
  const d = await db.dataset.create({
    data: {
      name: parsed.data.name,
      modality: parsed.data.modality,
      description: parsed.data.description,
      labels: JSON.stringify(parsed.data.labels ?? []),
    },
  });
  return jsonOk({ id: d.id, name: d.name }, undefined, 201);
});

function safeParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

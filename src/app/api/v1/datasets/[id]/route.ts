import { db } from "@/lib/db";
import { apiHandler, corsPreflight, jsonOk } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

/** GET /api/v1/datasets/{id} */
export const GET = apiHandler<{ id: string }>(async ({ params }) => {
  await ensureBootstrap();
  const d = await db.dataset.findUnique({ where: { id: params.id } });
  if (!d) throw new AppError("NOT_FOUND", `Dataset "${params.id}" not found`);
  return jsonOk({
    id: d.id,
    name: d.name,
    modality: d.modality,
    description: d.description,
    labels: safeParse<string[]>(d.labels) ?? [],
    sampleCount: d.sampleCount,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  });
});

/** DELETE /api/v1/datasets/{id} */
export const DELETE = apiHandler<{ id: string }>(async ({ params }) => {
  await ensureBootstrap();
  const d = await db.dataset.findUnique({ where: { id: params.id } });
  if (!d) throw new AppError("NOT_FOUND", `Dataset "${params.id}" not found`);
  await db.dataset.delete({ where: { id: params.id } });
  return jsonOk({ deleted: true, id: params.id });
});

function safeParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

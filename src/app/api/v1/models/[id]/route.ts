import { db } from "@/lib/db";
import { apiHandler, corsPreflight, jsonOk } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

/** DELETE /api/v1/models/{id} — remove a registry entry. */
export const DELETE = apiHandler<{ id: string }>(async ({ params }) => {
  await ensureBootstrap();
  const existing = await db.model.findUnique({ where: { id: params.id } });
  if (!existing) throw new AppError("NOT_FOUND", `Model "${params.id}" not found`);
  await db.model.delete({ where: { id: params.id } });
  return jsonOk({ deleted: true, id: params.id });
});

/** PATCH /api/v1/models/{id} — update status/configuration of a registry entry. */
export const PATCH = apiHandler<{ id: string }>(async ({ req, params }) => {
  await ensureBootstrap();
  const body = (await req.json().catch(() => ({}))) as { status?: string; configuration?: Record<string, unknown> };
  const existing = await db.model.findUnique({ where: { id: params.id } });
  if (!existing) throw new AppError("NOT_FOUND", `Model "${params.id}" not found`);
  const status = ["available", "unavailable", "experimental", "disabled"].includes(body.status ?? "")
    ? body.status!
    : existing.status;
  const updated = await db.model.update({
    where: { id: params.id },
    data: { status, ...(body.configuration ? { configuration: JSON.stringify(body.configuration) } : {}) },
  });
  return jsonOk({ id: updated.id, status: updated.status });
});

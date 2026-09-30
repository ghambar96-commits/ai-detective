import { db } from "@/lib/db";
import { apiHandler, corsPreflight, jsonOk } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

/** DELETE /api/v1/api-keys/{id} — revoke a key (soft revoke, hash remains for auditing). */
export const DELETE = apiHandler<{ id: string }>(async ({ params }) => {
  await ensureBootstrap();
  const key = await db.apiKey.findUnique({ where: { id: params.id } });
  if (!key) throw new AppError("NOT_FOUND", `API key "${params.id}" not found`);
  if (key.revokedAt) return jsonOk({ id: key.id, revoked: true, alreadyRevoked: true });
  await db.apiKey.update({ where: { id: params.id }, data: { revokedAt: new Date() } });
  return jsonOk({ id: key.id, revoked: true, alreadyRevoked: false });
});

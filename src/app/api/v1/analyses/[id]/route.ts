import { apiHandler, corsPreflight, jsonOk } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { deleteAnalysis, getAnalysisDetail, getAnalysisOrThrow } from "@/lib/aidetective/services/analysis-store";
import { unlink } from "fs/promises";
import { createLogger } from "@/lib/aidetective/core/logger";
import { isInsideUploads } from "@/lib/aidetective/security/files";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api:analyses");

export const OPTIONS = () => corsPreflight();

/** GET /api/v1/analyses/{id} — full analysis with signals, runs, evidence. */
export const GET = apiHandler<{ id: string }>(async ({ params }) => {
  await ensureBootstrap();
  const detail = await getAnalysisDetail(params.id);
  if (!detail) {
    throw new AppError("NOT_FOUND", `Analysis "${params.id}" not found`);
  }
  return jsonOk(detail);
});

/** DELETE /api/v1/analyses/{id} — remove analysis + stored upload. */
export const DELETE = apiHandler<{ id: string }>(async ({ params }) => {
  await ensureBootstrap();
  await getAnalysisOrThrow(params.id); // 404 if missing
  const { storagePath } = await deleteAnalysis(params.id);
  if (storagePath && isInsideUploads(storagePath)) {
    await unlink(storagePath).catch((error) => {
      log.warn("failed to remove stored upload", { analysisId: params.id, error: String(error) });
    });
  }
  return jsonOk({ deleted: true, id: params.id });
});

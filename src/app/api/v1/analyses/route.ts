import { apiHandler, corsPreflight, jsonOk } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { listAnalyses } from "@/lib/aidetective/services/analysis-store";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

/**
 * GET /api/v1/analyses
 * Searchable, paginated history.
 * Query: query, modality, classification, status, from, to, sort, order, page, pageSize
 */
export const GET = apiHandler(async ({ req }) => {
  await ensureBootstrap();
  const url = new URL(req.url);
  const sp = url.searchParams;
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? 20) || 20));

  const dateFrom = sp.get("from");
  const dateTo = sp.get("to");
  const parseDate = (v: string | null, endOfDay = false): Date | undefined => {
    if (!v) return undefined;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new AppError("VALIDATION_ERROR", `Invalid date: "${v}"`);
    return endOfDay ? new Date(d.setHours(23, 59, 59, 999)) : d;
  };

  const result = await listAnalyses({
    query: sp.get("query")?.trim() || undefined,
    modality: sp.get("modality") || undefined,
    classification: sp.get("classification") || undefined,
    status: sp.get("status") || undefined,
    from: parseDate(dateFrom),
    to: parseDate(dateTo, true),
    sort: sp.get("sort") || undefined,
    order: sp.get("order") === "asc" ? "asc" : "desc",
    page,
    pageSize,
  });
  return jsonOk(result);
});

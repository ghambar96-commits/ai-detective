import { NextResponse } from "next/server";
import { apiHandler, corsPreflight } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { getAnalysisDetail } from "@/lib/aidetective/services/analysis-store";
import { getRegistry } from "@/lib/aidetective/core/registry";
import { db } from "@/lib/db";
import { AppError } from "@/lib/aidetective/core/errors";
import { createLogger } from "@/lib/aidetective/core/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api:reports");

export const OPTIONS = () => corsPreflight();

/**
 * GET /api/v1/reports/{id}?format=json|html
 * Generates (and caches) a structured report for a completed analysis.
 */
export const GET = apiHandler<{ id: string }>(async ({ req, params }) => {
  await ensureBootstrap();
  const format = (new URL(req.url).searchParams.get("format") ?? "json").toLowerCase();
  const analysis = await getAnalysisDetail(params.id);
  if (!analysis) throw new AppError("NOT_FOUND", `Analysis "${params.id}" not found`);
  if (analysis.status !== "completed") {
    throw new AppError("CONFLICT", `Analysis is not completed yet (status: ${analysis.status})`);
  }

  const registry = getRegistry();
  const exporter = registry.listExporters().find((e) => e.format === format);
  if (!exporter) {
    throw new AppError("VALIDATION_ERROR", `Unknown report format "${format}". Available: ${registry.listExporters().map((e) => e.format).join(", ")}`);
  }

  const content = await exporter.export(analysis);

  // Cache the generated report (latest per format)
  try {
    await db.report.deleteMany({ where: { analysisId: params.id, format: exporter.format } });
    await db.report.create({ data: { analysisId: params.id, format: exporter.format, content } });
  } catch (error) {
    log.warn("report caching failed", { analysisId: params.id, error: String(error) });
  }

  const disposition = exporter.format === "html" ? "inline" : "attachment";
  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": exporter.mimeType === "application/json" ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
      "Content-Disposition": `${disposition}; filename="aidetective-report-${params.id}.${exporter.fileExt}"`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

/**
 * AIDetective — analysis persistence helpers.
 * All DB access for analyses lives here so API routes and the orchestrator
 * stay free of storage concerns (and so a future Postgres swap is localized).
 */
import { db } from "@/lib/db";
import type {
  AnalysisDetail,
  AnalysisOptions,
  AnalysisSummaryDTO,
  DetectorResult,
  Paginated,
  ScoreOutcome,
  Signal,
  SignalDirection,
} from "../core/types";
import { AppError } from "../core/errors";

type DbAnalysis = Awaited<ReturnType<typeof db.analysis.create>>;

export interface CreateAnalysisInput {
  inputType: "text" | "file";
  modality: string;
  status: string;
  fileName?: string;
  fileExt?: string;
  fileSize?: number;
  metadata?: Record<string, unknown>;
}

export async function createAnalysis(input: CreateAnalysisInput): Promise<DbAnalysis> {
  return db.analysis.create({
    data: {
      inputType: input.inputType,
      modality: input.modality,
      status: input.status,
      fileName: input.fileName,
      fileExt: input.fileExt,
      fileSize: input.fileSize,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export function directionOf(aiScore: number | null): SignalDirection {
  if (aiScore === null) return "neutral";
  if (aiScore > 0.55) return "ai_indicator";
  if (aiScore < 0.45) return "human_indicator";
  return "neutral";
}

export async function persistResults(
  analysisId: string,
  parts: {
    modality: string;
    detectorResults: DetectorResult[];
    signals: Signal[];
    outcome: ScoreOutcome;
    summary: string;
    warnings: string[];
    errors: string[];
    processingTimeMs: number;
    metadata: Record<string, unknown>;
    llm: { text: string; provider: string; model: string } | null;
  }
): Promise<void> {
  const { getRegistry } = await import("../core/registry");
  const registry = getRegistry();
  const runs = parts.detectorResults;
  await db.$transaction(async (tx) => {
    for (const run of runs) {
      await tx.analysisDetectorRun.create({
        data: {
          analysisId,
          detectorId: run.detectorId,
          detectorName: registry.detectors.get(run.detectorId)?.name ?? run.detectorId,
          version: run.version,
          source: registry.detectors.get(run.detectorId)?.source ?? "builtin",
          modality: parts.modality,
          status: run.status,
          durationMs: run.durationMs,
          summary: run.summary,
          error: run.error,
        },
      });
    }
    for (const signal of parts.signals) {
      await tx.analysisSignal.create({
        data: {
          analysisId,
          detectorId: signal.detectorId,
          signalKey: signal.id,
          name: signal.name,
          description: signal.description,
          value: signal.value !== undefined && signal.value !== null ? String(signal.value) : null,
          unit: signal.unit,
          aiScore: signal.aiScore,
          weight: signal.weight,
          direction: directionOf(signal.aiScore),
          evidence: signal.evidence.length ? JSON.stringify(signal.evidence) : null,
          notes: signal.notes,
        },
      });
    }
    await tx.analysis.update({
      where: { id: analysisId },
      data: {
        status: "completed",
        classification: parts.outcome.classification,
        likelihoodScore: parts.outcome.score,
        confidence: parts.outcome.confidence,
        summary: parts.summary,
        warnings: JSON.stringify(parts.warnings),
        errors: JSON.stringify(parts.errors),
        processingTime: parts.processingTimeMs,
        completedAt: new Date(),
        metadata: JSON.stringify(parts.metadata),
        llmInterpretation: parts.llm?.text,
        llmProvider: parts.llm?.provider,
        llmModel: parts.llm?.model,
      },
    });
  });
}

export async function markFailed(analysisId: string, errors: string[], processingTimeMs: number): Promise<void> {
  await db.analysis.update({
    where: { id: analysisId },
    data: {
      status: "failed",
      errors: JSON.stringify(errors),
      processingTime: processingTimeMs,
      completedAt: new Date(),
    },
  }).catch(() => undefined);
}

export async function setStatus(analysisId: string, status: "queued" | "processing"): Promise<void> {
  await db.analysis.update({ where: { id: analysisId }, data: { status } });
}

export function toSummaryDTO(row: DbAnalysis): AnalysisSummaryDTO {
  return {
    id: row.id,
    inputType: row.inputType,
    modality: row.modality,
    status: row.status as AnalysisSummaryDTO["status"],
    fileName: row.fileName,
    classification: row.classification as AnalysisSummaryDTO["classification"],
    likelihoodScore: row.likelihoodScore,
    confidence: row.confidence,
    processingTime: row.processingTime,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export function toDetailDTO(
  row: DbAnalysis & { signals: Array<Record<string, unknown>>; detectorRuns: Array<Record<string, unknown>> }
): AnalysisDetail {
  const metadata = safeParse<Record<string, unknown>>(row.metadata) ?? null;
  return {
    ...toSummaryDTO(row),
    summary: row.summary,
    warnings: safeParse<string[]>(row.warnings) ?? [],
    errors: safeParse<string[]>(row.errors) ?? [],
    llmInterpretation: row.llmInterpretation,
    llmProvider: row.llmProvider,
    llmModel: row.llmModel,
    metadata,
    signals: row.signals.map((s) => ({
      id: String(s.id),
      detectorId: String(s.detectorId),
      signalKey: String(s.signalKey),
      name: String(s.name),
      description: (s.description as string | null) ?? null,
      value: (s.value as string | null) ?? null,
      unit: (s.unit as string | null) ?? null,
      aiScore: (s.aiScore as number | null) ?? null,
      weight: Number(s.weight),
      direction: String(s.direction) as SignalDirection,
      evidence: safeParse(s.evidence as string | null) ?? null,
      notes: (s.notes as string | null) ?? null,
    })),
    detectorRuns: row.detectorRuns.map((r) => ({
      id: String(r.id),
      detectorId: String(r.detectorId),
      detectorName: String(r.detectorName),
      version: String(r.version),
      source: String(r.source),
      status: String(r.status) as "ok" | "skipped" | "error",
      durationMs: (r.durationMs as number | null) ?? null,
      summary: (r.summary as string | null) ?? null,
      error: (r.error as string | null) ?? null,
    })),
  };
}

export async function getAnalysisDetail(id: string): Promise<AnalysisDetail | null> {
  const row = await db.analysis.findUnique({
    where: { id },
    include: { signals: { orderBy: [{ detectorId: "asc" }, { weight: "desc" }] }, detectorRuns: { orderBy: { detectorId: "asc" } } },
  });
  if (!row) return null;
  return toDetailDTO(row as unknown as Parameters<typeof toDetailDTO>[0]);
}

export async function getAnalysisOrThrow(id: string) {
  const row = await db.analysis.findUnique({ where: { id } });
  if (!row) throw new AppError("NOT_FOUND", `Analysis "${id}" not found`);
  return row;
}

export interface ListAnalysesQuery {
  query?: string;
  modality?: string;
  classification?: string;
  status?: string;
  from?: Date;
  to?: Date;
  sort?: string;
  order?: "asc" | "desc";
  page: number;
  pageSize: number;
}

export async function listAnalyses(q: ListAnalysesQuery): Promise<Paginated<AnalysisSummaryDTO>> {
  const where: Record<string, unknown> = {};
  if (q.modality) where.modality = q.modality;
  if (q.classification) where.classification = q.classification;
  if (q.status) where.status = q.status;
  if (q.from || q.to) {
    where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
  }
  if (q.query) {
    where.OR = [
      { fileName: { contains: q.query } },
      { summary: { contains: q.query } },
      { classification: { contains: q.query } },
    ];
  }
  const sortField = q.sort === "likelihoodScore" || q.sort === "confidence" || q.sort === "processingTime" ? q.sort : "createdAt";
  const [total, rows] = await Promise.all([
    db.analysis.count({ where }),
    db.analysis.findMany({
      where,
      orderBy: { [sortField]: q.order ?? "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return {
    items: rows.map(toSummaryDTO),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

export async function deleteAnalysis(id: string): Promise<{ storagePath: string | null }> {
  const row = await getAnalysisOrThrow(id);
  const metadata = safeParse<{ storage?: { path?: string } }>(row.metadata);
  await db.analysis.delete({ where: { id } });
  return { storagePath: metadata?.storage?.path ?? null };
}

function safeParse<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export type { AnalysisOptions };

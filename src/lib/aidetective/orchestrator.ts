/**
 * AIDetective — Analysis Orchestrator.
 *
 * Pipeline:
 *   input → (file? parse) → analyzer (features → detectors) → raw signals
 *         → Scoring Engine → persisted result (+ optional LLM interpretation)
 *
 * Guarantees:
 *  - Raw detector signals are stored untouched; interpretation is separate.
 *  - `uncertain` / `inconclusive` / `failed` are first-class outcomes.
 *  - A detector error never aborts the analysis; it is recorded and surfaced.
 *  - LLM is optional and never influences the verdict.
 */
import { writeFile } from "fs/promises";
import { createLogger } from "./core/logger";
import { AppError } from "./core/errors";
import { getRegistry } from "./core/registry";
import { scoreAnalysis, confidenceLabel } from "./core/scoring";
import type {
  AnalysisDetail,
  AnalysisInput,
  AnalysisOptions,
  DetectorResult,
  Modality,
  ParseOutput,
  ScoreOutcome,
  Signal,
} from "./core/types";
import { config } from "./core/config";
import { getAnalyzerFor } from "./analyzers";
import { getSettingsService } from "./services/settings";
import {
  createAnalysis,
  getAnalysisDetail,
  getAnalysisOrThrow,
  markFailed,
  persistResults,
  setStatus,
} from "./services/analysis-store";
import { getJobQueue } from "./queue/job-queue";
import { interpretWithLLM } from "./llm/interpret";
import { isInsideUploads, sanitizeFilename, storagePathFor, validateUpload } from "./security/files";
import { db } from "@/lib/db";

const log = createLogger("orchestrator");

function buildSummary(outcome: ScoreOutcome, detectorCount: number, signalCount: number, modality: Modality): string {
  if (outcome.score === null) {
    return `No quantifiable signals were produced by ${detectorCount} detector(s) — the result is inconclusive.`;
  }
  const direction = outcome.score >= 0.62 ? "elevated likelihood of AI involvement" : outcome.score <= 0.42 ? "leans toward human authorship" : "falls in the ambiguous middle zone";
  return `${detectorCount} detector(s) produced ${signalCount} signal(s). Weighted likelihood of AI involvement: ${outcome.score.toFixed(2)} (${direction}) with ${confidenceLabel(outcome.confidence)} confidence. For ${modality} content this is a probabilistic estimate, not proof.`;
}

async function recordEvent(level: "info" | "warn" | "error", source: string, message: string, data?: Record<string, unknown>) {
  try {
    await db.systemEvent.create({ data: { level, source, message, data: data ? JSON.stringify(data) : null } });
  } catch {
    /* events must never break analysis */
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface TextAnalysisRequest {
  content: string;
  options?: AnalysisOptions;
}

/** Inline (synchronous) analysis for text submitted via API/dashboard. */
export async function analyzeText(request: TextAnalysisRequest): Promise<AnalysisDetail> {
  const content = request.content ?? "";
  const trimmed = content.trim();
  if (!trimmed) throw new AppError("VALIDATION_ERROR", "Text content is empty");
  if (content.length > config.security.maxTextChars) {
    throw new AppError("PAYLOAD_TOO_LARGE", `Text exceeds the ${Math.round(config.security.maxTextChars / 1000)}k character limit`);
  }

  const analysis = await createAnalysis({
    inputType: "text",
    modality: "text",
    status: "processing",
    metadata: { submittedChars: content.length },
  });

  const input: AnalysisInput = { kind: "text", text: content };
  return executePipeline(analysis.id, input, "text", request.options ?? {});
}

/** Queue-based analysis for uploaded files. Returns immediately with a queued analysis. */
export async function analyzeFileUpload(params: {
  buffer: Buffer;
  originalName: string;
  hintExt?: string;
  hintMime?: string;
  options?: AnalysisOptions;
}): Promise<AnalysisDetail> {
  const { buffer, originalName } = params;
  const validated = validateUpload(buffer, originalName, params.hintExt, params.hintMime);

  // Persist the analysis row first, then store the file under its id.
  const analysis = await createAnalysis({
    inputType: "file",
    modality: validated.detected.family === "text" || validated.detected.family === "document" ? "document" : validated.detected.family,
    status: "queued",
    fileName: validated.originalName,
    fileExt: validated.detected.ext,
    fileSize: validated.sizeBytes,
    metadata: {
      detectedMime: validated.detected.mime,
      detectedExt: validated.detected.ext,
      declaredNameHint: sanitizeFilename(originalName).slice(0, 120),
      uploadWarnings: validated.warnings,
    },
  });

  const storagePath = storagePathFor(analysis.id, validated.detected.ext);
  await writeFile(storagePath, validated.buffer, { mode: 0o600 });

  await db.analysis.update({
    where: { id: analysis.id },
    data: { metadata: JSON.stringify({ detectedMime: validated.detected.mime, detectedExt: validated.detected.ext, storage: { path: storagePath }, uploadWarnings: validated.warnings }) },
  });

  getJobQueue().enqueue(analysis.id);
  await recordEvent("info", "orchestrator", "File analysis queued", { analysisId: analysis.id, ext: validated.detected.ext });

  const detail = await getAnalysisDetail(analysis.id);
  return detail!;
}

export function startQueueWorker() {
  const queue = getJobQueue();
  queue.setProcessor(async (analysisId) => {
    await processQueuedAnalysis(analysisId);
  });
  log.info("queue worker attached", { concurrency: config.queue.concurrency });
}

/** Background worker entry: loads the stored file and runs the pipeline. */
export async function processQueuedAnalysis(analysisId: string): Promise<void> {
  const row = await getAnalysisOrThrow(analysisId);
  if (row.status !== "queued") return; // already handled (idempotent worker)
  await setStatus(analysisId, "processing");
  const metadata = safeJson<Record<string, unknown>>(row.metadata) ?? {};
  const storage = (metadata.storage as { path?: string } | undefined)?.path;

  try {
    if (!storage || !isInsideUploads(storage)) {
      throw new Error("Stored file path is missing or outside the uploads directory");
    }
    const { readFile } = await import("fs/promises");
    const buffer = await readFile(storage);
    const modality = (metadata.detectedExt as string | undefined) ?? row.fileExt ?? "bin";
    const kind: "text" | "image" | "audio" =
      ["png", "jpg", "jpeg", "webp"].includes(modality) ? "image" : ["wav", "mp3", "flac", "m4a"].includes(modality) ? "audio" : "text";

    const input: AnalysisInput = { kind, buffer, fileName: row.fileName ?? undefined };
    const routedModality: Modality = kind === "text" ? "document" : kind;
    await executePipeline(analysisId, input, routedModality, {}, storage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("queued analysis failed", { analysisId, error: message });
    await markFailed(analysisId, [message], 0);
    await recordEvent("error", "orchestrator", "Analysis failed", { analysisId, error: message });
  }
}

// ─── Pipeline core ────────────────────────────────────────────────────────────

async function executePipeline(
  analysisId: string,
  input: AnalysisInput,
  modality: Modality,
  options: AnalysisOptions,
  storagePath?: string
): Promise<AnalysisDetail> {
  const started = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  try {
    await setStatus(analysisId, "processing");
    let workingInput: AnalysisInput = input;
    let effectiveModality = modality;
    const meta: Record<string, unknown> = { ...(options.metadata ?? {}) };

    // ── 1. Route through a parser when the input is a file that needs extraction
    if (input.buffer) {
      const parseResult = await routeThroughParsers(input.buffer, input.fileName ?? "upload", meta, warnings);
      if (parseResult.kind === "unsupported") {
        throw new AppError("UNSUPPORTED_MEDIA_TYPE", "No parser available for this file content");
      }
      workingInput = {
        kind: parseResult.kind === "document" ? "text" : parseResult.kind,
        text: parseResult.text,
        buffer: parseResult.buffer,
        meta: parseResult.meta,
        fileName: input.fileName,
      };
      warnings.push(...(parseResult.warnings ?? []));
      effectiveModality = parseResult.kind === "document" ? "document" : (parseResult.kind as Modality);
      meta.parsedAs = parseResult.kind;
    }

    const analyzer = getAnalyzerFor(workingInput.kind, effectiveModality);

    // ── 2. Feature extraction
    const features: Record<string, unknown> = {};
    for (const extractor of analyzer.featureExtractors) {
      try {
        const extracted = await extractor.extract({ input: workingInput, modality: effectiveModality });
        Object.assign(features, extracted);
      } catch (error) {
        const message = `Feature extractor "${extractor.id}" failed: ${error instanceof Error ? error.message : String(error)}`;
        log.warn("feature extraction failed", { analysisId, extractor: extractor.id, error: message });
        errors.push(message);
      }
    }

    // ── 3. Detectors (errors isolated per detector)
    const detectors = analyzer.resolveDetectors(options);
    const detectorResults: DetectorResult[] = [];
    const signals: Signal[] = [];
    for (const detector of detectors) {
      const t0 = Date.now();
      try {
        const result = await detector.analyze({ input: workingInput, modality: effectiveModality, features, options });
        detectorResults.push({
          detectorId: detector.id,
          status: result.status,
          signals: result.signals,
          summary: result.summary,
          error: result.error,
          durationMs: Date.now() - t0,
          version: detector.version,
        });
        for (const signal of result.signals) signals.push(signal);
        if (result.error) errors.push(`${detector.id}: ${result.error}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error("detector crashed", { analysisId, detector: detector.id, error: message });
        detectorResults.push({
          detectorId: detector.id,
          status: "error",
          signals: [],
          error: message,
          durationMs: Date.now() - t0,
          version: detector.version,
        });
        errors.push(`${detector.id}: ${message}`);
        await recordEvent("error", `detector:${detector.id}`, `Detector error: ${detector.id}`, { analysisId, error: message });
      }
    }

    if (detectors.length === 0) {
      warnings.push("No detectors were selected or available for this content type.");
    }

    // ── 4. Scoring (deterministic, configurable)
    const scoringConfig = await getSettingsService().getScoring();
    const outcome = scoreAnalysis(signals, effectiveModality, scoringConfig);
    const summary = buildSummary(outcome, detectors.length, signals.length, effectiveModality);
    warnings.push(...analyzer.collectWarnings(features));

    // Modality-specific metadata snapshot
    if (effectiveModality === "text" || effectiveModality === "document") {
      const tf = features.textFeatures as { wordCount?: number; sentenceCount?: number; language?: string } | undefined;
      if (tf) Object.assign(meta, { words: tf.wordCount, sentences: tf.sentenceCount, language: tf.language });
    } else if (effectiveModality === "image") {
      Object.assign(meta, {
        format: features.imageFormat,
        width: features.imageWidth,
        height: features.imageHeight,
      });
    } else if (effectiveModality === "audio") {
      const tags = features.audioTags as { container?: string; durationSec?: number; sampleRate?: number | null } | undefined;
      if (tags) Object.assign(meta, { container: tags.container, durationSec: tags.durationSec, sampleRate: tags.sampleRate });
    }

    // ── 5. Optional LLM interpretation (explanation only — never the verdict)
    let llm: { text: string; provider: string; model: string } | null = null;
    try {
      const interpretation = await interpretWithLLM(
        {
          modality: effectiveModality,
          classification: outcome.classification,
          score: outcome.score,
          confidence: outcome.confidence,
          signals: signals.map((s) => ({
            detectorId: s.detectorId,
            name: s.name,
            value: s.value,
            aiScore: s.aiScore,
            direction: s.aiScore === null ? "neutral" : s.aiScore > 0.55 ? "ai_indicator" : s.aiScore < 0.45 ? "human_indicator" : "neutral",
            evidence: s.evidence.map((e) => ({ label: e.label, content: e.content })),
          })),
          warnings,
          detectorSummaries: detectorResults.map((r) => ({ detectorId: r.detectorId, status: r.status, summary: r.summary })),
          fileName: input.fileName,
        },
        options
      );
      if (interpretation) llm = { text: interpretation.text, provider: interpretation.provider, model: interpretation.model };
    } catch (error) {
      warnings.push(`LLM interpretation failed and was skipped: ${error instanceof Error ? error.message : String(error)}`);
    }

    const processingTimeMs = Date.now() - started;
    await persistResults(analysisId, {
      modality: effectiveModality,
      detectorResults,
      signals,
      outcome,
      summary,
      warnings,
      errors,
      processingTimeMs,
      metadata: meta,
      llm,
    });
    await recordEvent("info", "orchestrator", "Analysis completed", {
      analysisId,
      modality: effectiveModality,
      classification: outcome.classification,
      score: outcome.score,
      confidence: outcome.confidence,
      processingTimeMs,
    });
    log.info("analysis completed", { analysisId, classification: outcome.classification, processingTimeMs });

    const detail = await getAnalysisDetail(analysisId);
    if (!detail) throw new Error("analysis disappeared after persist");
    return detail;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const processingTimeMs = Date.now() - started;
    if (error instanceof AppError && error.code !== "INTERNAL_ERROR") {
      await markFailed(analysisId, [message], processingTimeMs);
      throw error;
    }
    log.error("analysis pipeline failed", { analysisId, error: message });
    await markFailed(analysisId, [message], processingTimeMs);
    await recordEvent("error", "orchestrator", "Analysis failed", { analysisId, error: message });
    throw new AppError("INTERNAL_ERROR", `Analysis failed: ${message}`);
  }
}

async function routeThroughParsers(
  buffer: Buffer,
  fileName: string,
  meta: Record<string, unknown>,
  warnings: string[]
): Promise<ParseOutput> {
  const registry = getRegistry();
  const { detectFileType } = await import("./security/files");
  const detected = detectFileType(buffer);
  const ext = sanitizeFilename(fileName).split(".").pop()?.toLowerCase() ?? "";

  const parsers = registry.listParsers();
  const parser = parsers.find((p) => p.canParse({ ext, detected }));
  if (!parser) {
    return { kind: "unsupported", meta: { detectedMime: detected.mime } };
  }
  const output = await parser.parse(buffer, { fileName, ext: detected.ext });
  meta.detectedMime = detected.mime;
  meta.detectedExt = detected.ext;
  meta.parser = parser.id;
  return output;
}

function safeJson<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

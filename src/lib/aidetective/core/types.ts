/**
 * AIDetective — central domain types.
 * Every detector, analyzer, parser, LLM provider and report generator
 * implements one of the interfaces declared here.
 */

// ─── Modality & lifecycle ─────────────────────────────────────────────────────

export type Modality = "text" | "image" | "audio" | "document";
export type InputKind = "text" | "image" | "audio" | "document" | "unsupported";
export type AnalysisStatus = "queued" | "processing" | "completed" | "failed";
export type Classification =
  | "likely_human"
  | "likely_ai_generated"
  | "likely_synthetic"
  | "uncertain"
  | "inconclusive";
export type SignalDirection = "ai_indicator" | "human_indicator" | "neutral";
export type DetectorStatus = "ok" | "skipped" | "error";
export type PluginType = "detector" | "parser" | "llm_provider" | "exporter";
export type PluginSource = "builtin" | "plugin";

// ─── Evidence & signals ───────────────────────────────────────────────────────

export interface EvidenceItem {
  kind: "quote" | "statistic" | "metadata" | "observation";
  label: string;
  content: string;
  meta?: Record<string, string | number | boolean | null>;
}

/**
 * A single measurable finding of one detector.
 * `aiScore`: 0 = strongly human-leaning, 0.5 = neutral, 1 = strongly AI-leaning.
 * `weight`: relative importance inside its modality (0..1).
 */
export interface Signal {
  id: string;
  detectorId: string;
  name: string;
  description?: string;
  value?: number | string | boolean | null;
  unit?: string;
  aiScore: number | null;
  weight: number;
  evidence: EvidenceItem[];
  notes?: string;
}

export interface DetectorResult {
  detectorId: string;
  status: DetectorStatus;
  signals: Signal[];
  summary?: string;
  error?: string;
  durationMs: number;
  version: string;
}

// ─── Core abstractions (stable plugin surface) ────────────────────────────────

export interface AnalysisInput {
  kind: "text" | "image" | "audio";
  text?: string;
  buffer?: Buffer;
  meta?: Record<string, unknown>;
  fileName?: string;
}

export interface AnalysisOptions {
  detectors?: string[];
  useLlm?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DetectorContext {
  input: AnalysisInput;
  modality: Modality;
  features: Record<string, unknown>;
  options: AnalysisOptions;
}

export interface DetectorCore {
  analyze(ctx: DetectorContext): Promise<{
    status: DetectorStatus;
    signals: Signal[];
    summary?: string;
    error?: string;
  }>;
}

export interface Detector extends DetectorCore {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly modalities: Modality[];
  readonly defaultWeight: number;
  /** Honest, user-visible limitations of this detector. */
  readonly limitations: string[];
}

export interface FeatureExtractor {
  readonly id: string;
  readonly modalities: Modality[];
  extract(ctx: { input: AnalysisInput; modality: Modality }): Promise<Record<string, unknown>>;
}

export interface Analyzer {
  readonly modality: Modality;
  readonly featureExtractors: FeatureExtractor[];
  /** Resolve the detectors that should run for this analysis (from the global registry). */
  resolveDetectors(options: AnalysisOptions): Detector[];
  /** Analyzer-level warnings (e.g. "very short text"). */
  collectWarnings(features: Record<string, unknown>): string[];
}

export interface DetectedFileType {
  mime: string;
  ext: string;
  family: "text" | "document" | "image" | "audio" | "archive" | "binary";
}

export interface ParseOutput {
  kind: InputKind;
  text?: string;
  buffer?: Buffer;
  meta?: Record<string, unknown>;
  warnings?: string[];
}

export interface FileParser {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly extensions: string[];
  readonly mimeTypes: string[];
  readonly outputKinds: InputKind[];
  canParse(info: { ext: string; detected: DetectedFileType }): boolean;
  parse(buffer: Buffer, info: { fileName: string; ext: string }): Promise<ParseOutput>;
}

// ─── LLM (optional layer — never decides the verdict) ─────────────────────────

export type LLMProviderId = "zai" | "ollama" | "openai_compatible" | (string & {});

export interface LLMConfig {
  enabled: boolean;
  provider: LLMProviderId;
  /** null = explicitly cleared in settings; undefined = never configured. */
  baseUrl?: string | null;
  model?: string | null;
  apiKey?: string | null;
  temperature: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompletionResult {
  text: string;
  model: string;
  provider: string;
  latencyMs: number;
}

export interface LLMProvider {
  readonly id: LLMProviderId;
  readonly label: string;
  readonly kind: "local" | "remote" | "managed";
  isConfigured(config: LLMConfig): boolean;
  complete(
    config: LLMConfig,
    messages: LLMMessage[],
    opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number; signal?: AbortSignal }
  ): Promise<LLMCompletionResult>;
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface ReportExporter {
  readonly id: string;
  readonly label: string;
  readonly format: string;
  readonly fileExt: string;
  readonly mimeType: string;
  export(analysis: AnalysisDetail): Promise<string>;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export interface ScoringConfig {
  /** Per-detector weight overrides (detectorId → weight). */
  weights: Record<string, number>;
  aiThreshold: number; // default 0.62
  humanThreshold: number; // default 0.42
  minSignals: number; // below this → uncertain
  maxConfidence: number; // hard cap, must be < 1
}

export interface ScoreBreakdownEntry {
  signalId: string;
  detectorId: string;
  weight: number;
  aiScore: number;
  contribution: number;
}

export interface ScoreOutcome {
  score: number | null; // 0..1 likelihood of AI involvement (null → inconclusive)
  confidence: number; // 0..maxConfidence
  classification: Classification;
  consistency: number; // 0..1 direction agreement
  usableSignals: number;
  breakdown: ScoreBreakdownEntry[];
}

// ─── Plugin contract ──────────────────────────────────────────────────────────

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  type: PluginType;
  modality?: Modality;
  entry: string;
  description?: string;
}

/** The object a plugin entry file must export as `register`. */
export interface PluginRegistrar {
  register(api: PluginApi): void;
}

export interface PluginApi {
  registerDetector(detector: Detector): void;
  registerParser(parser: FileParser): void;
  registerLLMProvider(provider: LLMProvider): void;
  registerExporter(exporter: ReportExporter): void;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  source: PluginSource;
  status: "loaded" | "error";
  error?: string;
  registered: { detectors: string[]; parsers: string[]; llmProviders: string[]; exporters: string[] };
}

// ─── API DTOs ─────────────────────────────────────────────────────────────────

export interface AnalysisSummaryDTO {
  id: string;
  inputType: string;
  modality: string;
  status: AnalysisStatus;
  fileName: string | null;
  classification: Classification | null;
  likelihoodScore: number | null;
  confidence: number | null;
  processingTime: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SignalDTO {
  id: string;
  detectorId: string;
  signalKey: string;
  name: string;
  description: string | null;
  value: string | null;
  unit: string | null;
  aiScore: number | null;
  weight: number;
  direction: SignalDirection;
  evidence: EvidenceItem[] | null;
  notes: string | null;
}

export interface DetectorRunDTO {
  id: string;
  detectorId: string;
  detectorName: string;
  version: string;
  source: string;
  status: DetectorStatus;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
}

export interface AnalysisDetail extends AnalysisSummaryDTO {
  summary: string | null;
  warnings: string[];
  errors: string[];
  llmInterpretation: string | null;
  llmProvider: string | null;
  llmModel: string | null;
  metadata: Record<string, unknown> | null;
  signals: SignalDTO[];
  detectorRuns: DetectorRunDTO[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

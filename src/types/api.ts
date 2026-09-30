/**
 * AIDetective — API contract types for /api/v1.
 * Mirrors the backend envelope: { ok: true, data, meta? } | { ok: false, error: { code, message, details? } }
 */

export type Modality = "text" | "image" | "audio" | "document";
export type AnyModality = Modality | "mixed";

export type Classification =
  | "likely_human"
  | "likely_ai_generated"
  | "likely_synthetic"
  | "uncertain"
  | "inconclusive";

export type AnalysisStatus = "queued" | "processing" | "completed" | "failed";
export type SignalDirection = "ai_indicator" | "human_indicator" | "neutral";
export type DetectorSource = "builtin" | "plugin";

/* ---------------------------------- envelope --------------------------------- */

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiEnvelope<T> =
  | { ok: true; data: T; meta?: Record<string, unknown> }
  | { ok: false; error: ApiErrorPayload };

/* ---------------------------------- analyze ---------------------------------- */

export interface AnalysisOptions {
  detectors?: string[];
  useLlm?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AnalysisEvidence {
  kind: string;
  label: string;
  content: string;
}

export interface AnalysisSignal {
  id: string;
  detectorId: string;
  signalKey: string;
  name: string;
  description: string;
  value: number;
  unit: string | null;
  aiScore: number;
  weight: number;
  direction: SignalDirection;
  evidence: AnalysisEvidence[] | null;
  notes: string | null;
}

export interface DetectorRun {
  id: string;
  detectorId: string;
  detectorName: string;
  version: string;
  source: DetectorSource;
  status: string;
  durationMs: number;
  summary: string | null;
  error: string | null;
}

export interface AnalysisDetail {
  id: string;
  inputType: string;
  modality: Modality;
  status: AnalysisStatus;
  fileName: string | null;
  classification: Classification | null;
  likelihoodScore: number | null;
  confidence: number | null;
  processingTime: number | null;
  createdAt: string;
  completedAt: string | null;
  summary: string | null;
  warnings: string[];
  errors: string[];
  llmInterpretation: string | null;
  llmProvider: string | null;
  llmModel: string | null;
  metadata: Record<string, unknown>;
  signals: AnalysisSignal[];
  detectorRuns: DetectorRun[];
}

/** First 11 fields of AnalysisDetail. */
export type AnalysisSummary = Pick<
  AnalysisDetail,
  | "id"
  | "inputType"
  | "modality"
  | "status"
  | "fileName"
  | "classification"
  | "likelihoodScore"
  | "confidence"
  | "processingTime"
  | "createdAt"
  | "completedAt"
>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListAnalysesQuery {
  query?: string;
  modality?: string;
  classification?: string;
  status?: string;
  from?: string;
  to?: string;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/* ----------------------------- stats & system ------------------------------- */

export interface RecentIssue {
  id: string;
  level: string;
  source: string;
  message: string;
  createdAt: string;
}

export interface StatsResponse {
  totals: {
    all: number;
    last24h: number;
    completed: number;
    failed: number;
    avgProcessingTimeMs: number | null;
  };
  byModality: Record<string, number>;
  byClassification: Record<string, number>;
  recentIssues: RecentIssue[];
}

export interface SystemStatus {
  app: {
    name: string;
    version: string;
    engineVersion: string;
    environment: string;
    nodeVersion: string;
    platform: string;
    uptimeSec: number;
    processUptimeSec?: number;
  };
  resources: {
    cpu: { cores: number; loadAvg1m: number; usagePct: number | null };
    memory: {
      totalBytes: number;
      freeBytes: number;
      usagePct: number;
      processRssBytes: number;
    };
    disk: { totalBytes: number; freeBytes: number; usagePct: number } | null;
    gpu: { name: string; memoryBytes: number | null } | null;
    gpuNote?: string;
  };
  services: {
    api: { status: string };
    database: { status: string; latencyMs: number | null; error?: string };
    queue: {
      implementation: string;
      queued: number;
      active: number;
      concurrency: number;
      processed: number;
      failed: number;
    };
    llm: {
      enabled: boolean;
      provider: string;
      providerLabel: string;
      configured: boolean;
      model: string | null;
      note: string;
    };
    detectors: {
      total: number;
      byModality: Record<string, number>;
      plugins: number;
    };
    security: { requireApiKey: boolean };
  };
  timestamp: string;
}

/* --------------------------------- detectors --------------------------------- */

export interface DetectorInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  modalities: Modality[];
  defaultWeight: number;
  limitations: string[];
  source: DetectorSource;
  enabled: boolean;
}

export interface DetectorsResponse {
  total: number;
  detectors: DetectorInfo[];
}

/* ---------------------------------- plugins ---------------------------------- */

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  type: string;
  modality: string;
  status: string;
  description: string;
  error: string | null;
  updatedAt: string;
}

export interface PluginsResponse {
  total: number;
  plugins: PluginInfo[];
  discoveredOnDisk: Array<Record<string, unknown>>;
  api: { manifest: string; entry: string };
  loadedFromPlugins: { detectors: number; parsers: number };
}

/* ----------------------------------- models ---------------------------------- */

export type ModelStatus = "available" | "unavailable" | "experimental" | "disabled";

export interface ModelInfo {
  id: string;
  name: string;
  version: string;
  modality: AnyModality;
  provider: string;
  location: "local" | "remote";
  status: ModelStatus;
  capabilities: string[];
  configuration: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface ModelsResponse {
  total: number;
  models: ModelInfo[];
}

export interface ModelCreateInput {
  name: string;
  version: string;
  modality: AnyModality;
  provider: string;
  location: "local" | "remote";
  status: ModelStatus;
  capabilities?: string[];
  configuration?: Record<string, unknown>;
}

/* ---------------------------------- datasets --------------------------------- */

export interface DatasetInfo {
  id: string;
  name: string;
  modality: AnyModality;
  description: string | null;
  labels: string[];
  sampleCount: number;
  createdAt: string;
  exportReady: boolean;
}

export interface DatasetsResponse {
  total: number;
  datasets: DatasetInfo[];
}

export interface DatasetCreateInput {
  name: string;
  modality: AnyModality;
  description?: string;
  labels?: string[];
}

export interface DatasetSampleInput {
  content: string;
  label?: string;
}

/* ---------------------------------- settings --------------------------------- */

export interface LLMProviderOption {
  id: string;
  label: string;
  kind: string;
}

export interface SettingsResponse {
  llm: {
    enabled: boolean;
    provider: string;
    baseUrl: string | null;
    model: string | null;
    apiKey: string | null;
    hasApiKey: boolean;
    temperature: number;
    timeoutMs: number;
  };
  scoring: {
    aiThreshold: number;
    humanThreshold: number;
    minSignals: number;
    maxConfidence: number;
  };
  security: { requireApiKey: boolean };
  providers: LLMProviderOption[];
}

export interface SettingsUpdateInput {
  llm?: {
    enabled?: boolean;
    provider?: string;
    baseUrl?: string | null;
    model?: string | null;
    apiKey?: string | null;
    temperature?: number;
    timeoutMs?: number;
  };
  scoring?: {
    aiThreshold?: number;
    humanThreshold?: number;
    minSignals?: number;
    maxConfidence?: number;
  };
  security?: { requireApiKey?: boolean };
}

export interface LLMTestResult {
  ok: boolean;
  provider: string;
  model: string | null;
  latencyMs: number | null;
  error: string | null;
}

/* ---------------------------------- api keys --------------------------------- */

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  rateLimit: number;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
  revokedAt: string | null;
}

export interface ApiKeysResponse {
  total: number;
  keys: ApiKeyInfo[];
}

export interface ApiKeyCreateResult {
  id: string;
  name: string;
  prefix: string;
  key: string;
  notice: string;
}

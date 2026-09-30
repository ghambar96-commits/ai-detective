/**
 * AIDetective — typed fetch client for /api/v1.
 * Unwraps the response envelope, throws ApiError(code, message, details),
 * and provides JSON / multipart / blob helpers. Toasting is left to callers.
 */
import type { ApiEnvelope } from "@/types/api";

const BASE = "/api/v1";

export class ApiError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/** Build a query string, skipping null/undefined/empty values. */
export function buildQuery(params: QueryParams = {}): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Unwrap the envelope; throw ApiError for HTTP/network/protocol failures. */
async function unwrap<T>(res: Response): Promise<T> {
  let payload: unknown = null;
  let parseFailed = false;
  try {
    payload = await res.json();
  } catch {
    parseFailed = true;
  }

  if (parseFailed || !isRecord(payload)) {
    throw new ApiError(
      `HTTP_${res.status}`,
      parseFailed
        ? `Unexpected non-JSON response (HTTP ${res.status})`
        : `Malformed API response (HTTP ${res.status})`
    );
  }

  if (payload.ok !== true) {
    const error = isRecord(payload.error) ? payload.error : {};
    throw new ApiError(
      typeof error.code === "string" ? error.code : `HTTP_${res.status}`,
      typeof error.message === "string" ? error.message : `Request failed (HTTP ${res.status})`,
      error.details
    );
  }

  return payload.data as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (cause) {
    throw new ApiError(
      "NETWORK_ERROR",
      cause instanceof Error ? `Network error: ${cause.message}` : "Network error",
      cause
    );
  }
  return unwrap<T>(res);
}

export function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  return request<T>(`${path}${buildQuery(params)}`, { method: "GET", cache: "no-store" });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

/** Multipart upload (used by POST /analyze/file). Returns the 202 payload. */
export function uploadFile<T>(path: string, file: File, options?: Record<string, unknown>): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  if (options) form.append("options", JSON.stringify(options));
  return request<T>(path, { method: "POST", body: form });
}

/** Fetch a raw text response (e.g. HTML report for iframe preview). */
export async function fetchRawText(path: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  } catch (cause) {
    throw new ApiError(
      "NETWORK_ERROR",
      cause instanceof Error ? `Network error: ${cause.message}` : "Network error",
      cause
    );
  }
  if (!res.ok) {
    // Try to surface the envelope error if present.
    try {
      const payload = (await res.json()) as ApiEnvelope<unknown>;
      if (payload.ok === false) {
        throw new ApiError(payload.error.code, payload.error.message, payload.error.details);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
    }
    throw new ApiError(`HTTP_${res.status}`, `Request failed (HTTP ${res.status})`);
  }
  return res.text();
}

/** Fetch any path as a Blob and trigger a browser download. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  } catch (cause) {
    throw new ApiError(
      "NETWORK_ERROR",
      cause instanceof Error ? `Network error: ${cause.message}` : "Network error",
      cause
    );
  }
  if (!res.ok) {
    try {
      const payload = (await res.json()) as ApiEnvelope<unknown>;
      if (payload.ok === false) {
        throw new ApiError(payload.error.code, payload.error.message, payload.error.details);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
    }
    throw new ApiError(`HTTP_${res.status}`, `Download failed (HTTP ${res.status})`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? fallbackName;

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------------------------------------------------------------------------
 * Domain helpers — one function per endpoint, fully typed.
 * ------------------------------------------------------------------------- */

import type {
  AnalysisDetail,
  AnalysisOptions,
  AnalysisSummary,
  ApiKeyCreateResult,
  ApiKeysResponse,
  DatasetCreateInput,
  DatasetInfo,
  DatasetSampleInput,
  DatasetsResponse,
  DetectorInfo,
  DetectorsResponse,
  LLMTestResult,
  ListAnalysesQuery,
  ModelCreateInput,
  ModelInfo,
  ModelsResponse,
  Paginated,
  PluginInfo,
  PluginsResponse,
  SettingsResponse,
  SettingsUpdateInput,
  StatsResponse,
  SystemStatus,
} from "@/types/api";

/* analyze */
export function analyzeText(content: string, options?: AnalysisOptions): Promise<AnalysisDetail> {
  return apiPost<AnalysisDetail>("/analyze", { content, options });
}
export function analyzeFile(file: File, options?: AnalysisOptions): Promise<AnalysisDetail> {
  return uploadFile<AnalysisDetail>("/analyze/file", file, options as Record<string, unknown> | undefined);
}

/* analyses */
export function listAnalyses(query: ListAnalysesQuery = {}): Promise<Paginated<AnalysisSummary>> {
  return apiGet<Paginated<AnalysisSummary>>("/analyses", query as QueryParams);
}
export function getAnalysis(id: string): Promise<AnalysisDetail> {
  return apiGet<AnalysisDetail>(`/analyses/${encodeURIComponent(id)}`);
}
export function deleteAnalysis(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/analyses/${encodeURIComponent(id)}`);
}

/* reports */
export function fetchReportJson(id: string): Promise<Record<string, unknown>> {
  return apiGet<Record<string, unknown>>(`/reports/${encodeURIComponent(id)}`, { format: "json" });
}
export function fetchReportHtml(id: string): Promise<string> {
  return fetchRawText(`/reports/${encodeURIComponent(id)}?format=html`);
}
export function downloadReport(id: string, format: "json" | "html"): Promise<void> {
  return downloadFile(
    `/reports/${encodeURIComponent(id)}?format=${format}`,
    `aidetective-report-${id}.${format}`
  );
}
export function openHtmlReport(id: string): void {
  window.open(`${BASE}/reports/${encodeURIComponent(id)}?format=html`, "_blank", "noopener");
}

/* stats / system */
export function getStats(): Promise<StatsResponse> {
  return apiGet<StatsResponse>("/stats");
}
export function getSystemStatus(): Promise<SystemStatus> {
  return apiGet<SystemStatus>("/system/status");
}

/* detectors */
export function getDetectors(): Promise<DetectorsResponse> {
  return apiGet<DetectorsResponse>("/detectors");
}

/* plugins */
export function getPlugins(): Promise<PluginsResponse> {
  return apiGet<PluginsResponse>("/plugins");
}

/* models */
export function listModels(): Promise<ModelsResponse> {
  return apiGet<ModelsResponse>("/models");
}
export function createModel(input: ModelCreateInput): Promise<{ id: string; name: string }> {
  return apiPost<{ id: string; name: string }>("/models", input);
}
export function updateModelStatus(id: string, status: ModelInfo["status"]): Promise<{ id: string; status: string }> {
  return apiPatch<{ id: string; status: string }>(`/models/${encodeURIComponent(id)}`, { status });
}
export function deleteModel(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/models/${encodeURIComponent(id)}`);
}

/* datasets */
export function listDatasets(): Promise<DatasetsResponse> {
  return apiGet<DatasetsResponse>("/datasets");
}
export function createDataset(input: DatasetCreateInput): Promise<{ id: string; name: string }> {
  return apiPost<{ id: string; name: string }>("/datasets", input);
}
export function deleteDataset(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/datasets/${encodeURIComponent(id)}`);
}
export function addDatasetSamples(id: string, samples: DatasetSampleInput[]): Promise<{ imported: number; note: string }> {
  return apiPost<{ imported: number; note: string }>(`/datasets/${encodeURIComponent(id)}/samples`, { samples });
}

/* settings / llm */
export function getSettings(): Promise<SettingsResponse> {
  return apiGet<SettingsResponse>("/settings");
}
export function putSettings(patch: SettingsUpdateInput): Promise<Partial<SettingsResponse>> {
  return apiPut<Partial<SettingsResponse>>("/settings", patch);
}
export function testLLM(): Promise<LLMTestResult> {
  return apiPost<LLMTestResult>("/llm/test");
}

/* api keys */
export function listApiKeys(): Promise<ApiKeysResponse> {
  return apiGet<ApiKeysResponse>("/api-keys");
}
export function createApiKey(name: string, rateLimit?: number): Promise<ApiKeyCreateResult> {
  return apiPost<ApiKeyCreateResult>("/api-keys", rateLimit ? { name, rateLimit } : { name });
}
export function revokeApiKey(id: string): Promise<{ revoked: boolean }> {
  return apiDelete<{ revoked: boolean }>(`/api-keys/${encodeURIComponent(id)}`);
}

/* openapi */
export function downloadOpenApi(): Promise<void> {
  return downloadFile("/openapi", "aidetective-openapi.json");
}

export type { DetectorInfo, PluginInfo, ModelInfo, DatasetInfo };

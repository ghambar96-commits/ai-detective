/** AIDetective — runtime configuration from environment variables (no secrets hardcoded). */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export const APP_NAME = "AIDetective";
export const APP_VERSION = "0.1.0";
export const ENGINE_VERSION = "0.1.0";

export const config = {
  app: {
    name: APP_NAME,
    version: APP_VERSION,
    engineVersion: ENGINE_VERSION,
  },
  /** Treat as plain market flag — actual defaults live in the settings service. */
  security: {
    /** Require API keys on /api/v1 (local dashboard mode works without). */
    requireApiKey: bool("AIDETECTIVE_REQUIRE_API_KEY", false),
    maxUploadMb: num("AIDETECTIVE_MAX_UPLOAD_MB", 25),
    maxTextChars: num("AIDETECTIVE_MAX_TEXT_CHARS", 200_000),
  },
  llm: {
    enabled: bool("AIDETECTIVE_LLM_ENABLED", false),
    provider: (process.env.AIDETECTIVE_LLM_PROVIDER ?? "zai") as string,
    baseUrl: process.env.AIDETECTIVE_LLM_BASE_URL ?? undefined,
    model: process.env.AIDETECTIVE_LLM_MODEL ?? undefined,
    apiKey: process.env.AIDETECTIVE_LLM_API_KEY ?? undefined,
    temperature: num("AIDETECTIVE_LLM_TEMPERATURE", 0.2),
    timeoutMs: num("AIDETECTIVE_LLM_TIMEOUT_MS", 25_000),
  },
  queue: {
    concurrency: Math.max(1, num("AIDETECTIVE_QUEUE_CONCURRENCY", 1)),
  },
  storage: {
    /** Uploaded files are stored here; filenames are sanitized + replaced by ids. */
    uploadsDir: process.env.AIDETECTIVE_UPLOADS_DIR ?? "uploads",
  },
  log: {
    level: (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error",
    /** Raw user content is only logged in explicit debug mode. */
    debugContent: bool("AIDETECTIVE_DEBUG_CONTENT", false),
  },
  scoring: {
    aiThreshold: num("AIDETECTIVE_SCORING_AI_THRESHOLD", 0.62),
    humanThreshold: num("AIDETECTIVE_SCORING_HUMAN_THRESHOLD", 0.42),
    minSignals: num("AIDETECTIVE_SCORING_MIN_SIGNALS", 2),
    maxConfidence: num("AIDETECTIVE_SCORING_MAX_CONFIDENCE", 0.92),
  },
} as const;

export type AppConfig = typeof config;

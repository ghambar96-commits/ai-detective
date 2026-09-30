/**
 * AIDetective — structured logging.
 * - JSON lines to stdout.
 * - Redacts secrets (authorization headers, api keys, tokens) by pattern.
 * - Raw user content is only logged when AIDETECTIVE_DEBUG_CONTENT=true.
 */
import { config } from "./config";

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/authorization[":=\s]+[^\s",}]+/gi, 'authorization: "[REDACTED]"'],
  [/x-api-key[":=\s]+[^\s",}]+/gi, 'x-api-key: "[REDACTED]"'],
  [/adk_[A-Za-z0-9_-]{8,}/g, "adk_[REDACTED]"],
  [/sk-[A-Za-z0-9_-]{8,}/g, "sk-[REDACTED]"],
  [/bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [REDACTED]"],
];

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (["apikey", "api_key", "key", "token", "secret", "password", "authorization"].includes(key)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

function log(level: Level, source: string, message: string, data?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[config.log.level]) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    source,
    message,
    ...(data ? { data: redact(data) as Record<string, unknown> } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(source: string): Logger;
}

export function createLogger(source: string): Logger {
  return {
    debug: (m, d) => log("debug", source, m, d),
    info: (m, d) => log("info", source, m, d),
    warn: (m, d) => log("warn", source, m, d),
    error: (m, d) => log("error", source, m, d),
    child: (sub) => createLogger(`${source}:${sub}`),
  };
}

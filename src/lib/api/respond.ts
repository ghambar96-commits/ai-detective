/**
 * AIDetective — REST API helpers: unified envelope, CORS, error mapping.
 * Every /api/v1 route returns:
 *   { ok: true,  data: ...,  meta?: ... }
 *   { ok: false, error: { code, message, details? } }
 */
import { NextResponse, type NextRequest } from "next/server";
import { AppError, toErrorPayload } from "@/lib/aidetective/core/errors";
import { createLogger } from "@/lib/aidetective/core/logger";
import { authenticate } from "@/lib/aidetective/security/auth";

const log = createLogger("api");

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Access-Control-Max-Age": "86400",
};

export function jsonOk<T>(data: T, meta?: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(
    { ok: true, data, ...(meta ? { meta } : {}) },
    { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } }
  );
}

export function jsonError(code: string, message: string, status: number, details?: unknown): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } }
  );
}

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export interface ApiContext<P = Record<string, string>> {
  req: NextRequest;
  params: P;
}

interface HandlerOptions {
  /** "required" forces an API key even in local mode (used for api-keys mgmt). */
  auth?: "default" | "required";
}

/**
 * Wrap a route handler: request logging (no bodies/secrets), structured error
 * responses, authentication. Handlers receive (req, params).
 */
export function apiHandler<P = Record<string, string>>(
  fn: (ctx: ApiContext<P>) => Promise<NextResponse>,
  options: HandlerOptions = {}
) {
  return async (req: NextRequest, routeCtx?: { params: Promise<P> }): Promise<NextResponse> => {
    const started = Date.now();
    const path = new URL(req.url).pathname;
    try {
      const auth = await authenticate(req);
      if (options.auth === "required" && auth.localMode) {
        throw new AppError(
          "UNAUTHORIZED",
          "This endpoint requires an API key (it manages secrets)."
        );
      }
      const params = routeCtx?.params ? await routeCtx.params : ({} as P);
      const res = await fn({ req, params });
      log.info("request", {
        method: req.method,
        path,
        status: res.status,
        durationMs: Date.now() - started,
        auth: auth.localMode ? "local" : `key:${auth.keyId}`,
      });
      return res;
    } catch (error) {
      const payload = toErrorPayload(error);
      const status = error instanceof AppError ? error.status : 500;
      if (status >= 500) {
        log.error("request failed", {
          method: req.method,
          path,
          code: payload.code,
          error: payload.message,
          durationMs: Date.now() - started,
        });
      } else {
        log.warn("request rejected", {
          method: req.method,
          path,
          code: payload.code,
          error: payload.message,
          durationMs: Date.now() - started,
        });
      }
      return jsonError(payload.code, payload.message, status, payload.details);
    }
  };
}

/** Parse a JSON body safely with a size ceiling. */
export async function readJson(req: NextRequest, maxBytes = 2_000_000): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) {
    throw new AppError("PAYLOAD_TOO_LARGE", `Body exceeds ${(maxBytes / 1_000_000).toFixed(1)} MB limit`);
  }
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON");
  }
}

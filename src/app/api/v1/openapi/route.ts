/**
 * GET /api/v1/openapi — OpenAPI 3.0 description of the public REST API.
 * Importable into Swagger UI, Postman, Insomnia, Redoc, etc.
 */
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/respond";
import { APP_NAME, APP_VERSION } from "@/lib/aidetective/core/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const envelope = (dataSchema: object) => ({
  type: "object",
  properties: { ok: { type: "boolean" }, data: dataSchema },
  required: ["ok", "data"],
});

const errorEnvelope = {
  type: "object",
  properties: {
    ok: { type: "boolean", enum: [false] },
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
      },
      required: ["code", "message"],
    },
  },
};

const analysisSummary = {
  type: "object",
  properties: {
    id: { type: "string" },
    inputType: { type: "string", enum: ["text", "file"] },
    modality: { type: "string", enum: ["text", "image", "audio", "document"] },
    status: { type: "string", enum: ["queued", "processing", "completed", "failed"] },
    fileName: { type: "string", nullable: true },
    classification: { type: "string", nullable: true, enum: ["likely_human", "likely_ai_generated", "likely_synthetic", "uncertain", "inconclusive"] },
    likelihoodScore: { type: "number", nullable: true, description: "0..1 weighted likelihood of AI involvement — probabilistic, NOT proof" },
    confidence: { type: "number", nullable: true, description: "0..1, capped below 1.0 by design" },
    processingTime: { type: "integer", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    completedAt: { type: "string", format: "date-time", nullable: true },
  },
};

const signal = {
  type: "object",
  properties: {
    id: { type: "string" },
    detectorId: { type: "string" },
    signalKey: { type: "string" },
    name: { type: "string" },
    value: { type: "string", nullable: true },
    unit: { type: "string", nullable: true },
    aiScore: { type: "number", nullable: true, description: "0=human .. 1=AI, 0.5 neutral" },
    weight: { type: "number" },
    direction: { type: "string", enum: ["ai_indicator", "human_indicator", "neutral"] },
    evidence: { type: "array", nullable: true, items: { type: "object", properties: { kind: { type: "string" }, label: { type: "string" }, content: { type: "string" } } } },
    notes: { type: "string", nullable: true },
  },
};

const analysisDetail = {
  type: "object",
  allOf: [
    { $ref: "#/components/schemas/AnalysisSummary" },
    {
      type: "object",
      properties: {
        summary: { type: "string", nullable: true },
        warnings: { type: "array", items: { type: "string" } },
        errors: { type: "array", items: { type: "string" } },
        llmInterpretation: { type: "string", nullable: true },
        llmProvider: { type: "string", nullable: true },
        metadata: { type: "object", nullable: true },
        signals: { type: "array", items: { $ref: "#/components/schemas/Signal" } },
        detectorRuns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              detectorId: { type: "string" },
              detectorName: { type: "string" },
              version: { type: "string" },
              source: { type: "string", enum: ["builtin", "plugin"] },
              status: { type: "string", enum: ["ok", "skipped", "error"] },
              durationMs: { type: "integer", nullable: true },
              summary: { type: "string", nullable: true },
              error: { type: "string", nullable: true },
            },
          },
        },
      },
    },
  ],
};

const okResponse = (schema: object, description = "Success") => ({
  description,
  content: { "application/json": { schema: envelope(schema) } },
});

const errorResponse = {
  description: "Structured error",
  content: { "application/json": { schema: errorEnvelope } },
};

function buildSpec(origin: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: `${APP_NAME} REST API`,
      version: APP_VERSION,
      description:
        "Multimodal AI-content detection API (text, image, audio, documents). " +
        "All detections are PROBABILISTIC: results include likelihood scores, confidence, signals and evidence — never proof. " +
        "'uncertain' and 'inconclusive' are valid outcomes. The optional LLM layer only explains results; it never decides them.",
      license: { name: "MIT" },
    },
    servers: [{ url: origin, description: "Current server" }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "Or use 'Authorization: Bearer <key>'. Required when the server runs with API-key enforcement enabled.",
        },
      },
      schemas: {
        AnalysisSummary: analysisSummary,
        AnalysisDetail: analysisDetail,
        Signal: signal,
      },
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      "/api/v1/analyze": {
        post: {
          summary: "Analyze raw text (inline)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["content"],
                  properties: {
                    content: { type: "string" },
                    options: {
                      type: "object",
                      properties: {
                        detectors: { type: "array", items: { type: "string" }, description: "restrict to specific detector ids" },
                        useLlm: { type: "boolean", description: "request optional LLM interpretation" },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: { "200": okResponse({ $ref: "#/components/schemas/AnalysisDetail" }), "400": errorResponse },
        },
      },
      "/api/v1/analyze/file": {
        post: {
          summary: "Analyze an uploaded file (queued)",
          description: "multipart/form-data with `file` and optional `options` (JSON string). Returns 202 with a queued analysis; poll GET /api/v1/analyses/{id}.",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: { type: "string", format: "binary" },
                    options: { type: "string", description: 'JSON string, e.g. {"useLlm":true}' },
                  },
                },
              },
            },
          },
          responses: { "202": okResponse({ $ref: "#/components/schemas/AnalysisDetail" }, "Analysis queued"), "400": errorResponse, "413": errorResponse, "415": errorResponse },
        },
      },
      "/api/v1/analyses": {
        get: {
          summary: "List / search analyses",
          parameters: [
            { name: "query", in: "query", schema: { type: "string" } },
            { name: "modality", in: "query", schema: { type: "string", enum: ["text", "image", "audio", "document"] } },
            { name: "classification", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["queued", "processing", "completed", "failed"] } },
            { name: "from", in: "query", schema: { type: "string", format: "date" } },
            { name: "to", in: "query", schema: { type: "string", format: "date" } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["createdAt", "likelihoodScore", "confidence", "processingTime"] } },
            { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "pageSize", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
          ],
          responses: { "200": okResponse({ type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/AnalysisSummary" } }, page: { type: "integer" }, pageSize: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } }) },
        },
      },
      "/api/v1/analyses/{id}": {
        get: {
          summary: "Get a full analysis (signals, evidence, detector runs)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": okResponse({ $ref: "#/components/schemas/AnalysisDetail" }), "404": errorResponse },
        },
        delete: {
          summary: "Delete an analysis and its stored upload",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": okResponse({ type: "object", properties: { deleted: { type: "boolean" }, id: { type: "string" } } }), "404": errorResponse },
        },
      },
      "/api/v1/reports/{id}": {
        get: {
          summary: "Structured report for an analysis",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "format", in: "query", schema: { type: "string", enum: ["json", "html"], default: "json" } },
          ],
          responses: {
            "200": {
              description: "Report content (application/json or text/html)",
              content: {
                "application/json": { schema: { type: "object" } },
                "text/html": { schema: { type: "string" } },
              },
            },
            "404": errorResponse,
            "409": errorResponse,
          },
        },
      },
      "/api/v1/system/status": {
        get: { summary: "System health, resources, services", responses: { "200": okResponse({ type: "object" }) } },
      },
      "/api/v1/stats": {
        get: { summary: "Dashboard aggregate counters", responses: { "200": okResponse({ type: "object" }) } },
      },
      "/api/v1/detectors": {
        get: { summary: "Detector registry (incl. honest limitations)", responses: { "200": okResponse({ type: "object" }) } },
      },
      "/api/v1/models": {
        get: { summary: "Model registry", responses: { "200": okResponse({ type: "object" }) } },
        post: { summary: "Register a custom model entry", responses: { "201": okResponse({ type: "object" }), "400": errorResponse } },
      },
      "/api/v1/models/{id}": {
        delete: { summary: "Remove a model registry entry", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okResponse({ type: "object" }) } },
        patch: { summary: "Update model status/configuration", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okResponse({ type: "object" }) } },
      },
      "/api/v1/plugins": {
        get: { summary: "Loaded plugins + plugin contract", responses: { "200": okResponse({ type: "object" }) } },
      },
      "/api/v1/datasets": {
        get: { summary: "List datasets", responses: { "200": okResponse({ type: "object" }) } },
        post: { summary: "Create a dataset", responses: { "201": okResponse({ type: "object" }), "400": errorResponse } },
      },
      "/api/v1/datasets/{id}": {
        get: { summary: "Dataset detail", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okResponse({ type: "object" }) } },
        delete: { summary: "Delete a dataset", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okResponse({ type: "object" }) } },
      },
      "/api/v1/datasets/{id}/samples": {
        post: { summary: "Import text samples into a dataset", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "202": okResponse({ type: "object" }) } },
      },
      "/api/v1/llm/test": {
        post: { summary: "Test the configured LLM provider", responses: { "200": okResponse({ type: "object" }) } },
      },
      "/api/v1/settings": {
        get: { summary: "Runtime settings (LLM, scoring, security)", responses: { "200": okResponse({ type: "object" }) } },
        put: { summary: "Update runtime settings", responses: { "200": okResponse({ type: "object" }) } },
      },
      "/api/v1/api-keys": {
        get: { summary: "List API keys (no secrets)", responses: { "200": okResponse({ type: "object" }) } },
        post: {
          summary: "Create an API key (plaintext shown once)",
          responses: { "201": okResponse({ type: "object", properties: { key: { type: "string" } } }), "400": errorResponse },
        },
      },
      "/api/v1/api-keys/{id}": {
        delete: { summary: "Revoke an API key", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okResponse({ type: "object" }) } },
      },
    },
  };
}

export const GET = apiHandler(async ({ req }) => {
  const origin = new URL(req.url).origin;
  return NextResponse.json(buildSpec(origin), {
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
});

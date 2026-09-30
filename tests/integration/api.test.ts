/**
 * Integration tests — the REAL running AIDetective server (Next.js dev on
 * port 3000). These tests exercise the public REST API end-to-end:
 * endpoints, validation, auth lifecycle, rate limiting, queue flow
 * (upload → analysis → database → report), and LLM test connectivity.
 *
 * No mocking: HTTP against the live app + real SQLite DB + real engines.
 * The suite SKIPS (with a clear message) when the server is not running.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  buildPng,
  buildWav,
  buildDocx,
  buildPdf,
  buildMp3,
  AI_TEXT,
  HUMAN_TEXT,
} from "../helpers/fixtures";

const BASE = process.env.AIDETECTIVE_TEST_URL ?? "http://127.0.0.1:3000";
const SERVER_UP = await (async () => {
  try {
    const res = await fetch(`${BASE}/api/v1/system/status`, { signal: AbortSignal.timeout(15_000) });
    return res.ok;
  } catch {
    return false;
  }
})();

const withServer = SERVER_UP ? describe : describe.skip;
const LONG = 60_000;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  meta?: Record<string, unknown>;
}

async function api<T = unknown>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ status: number; body: Envelope<T>; res: Response }> {
  const { timeoutMs = 30_000, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  let body: Envelope<T> = {};
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    /* non-JSON (HTML reports) */
  }
  return { status: res.status, body, res };
}

function get<T>(path: string, headers?: Record<string, string>) {
  return api<T>(path, { headers });
}
function post<T>(path: string, json?: unknown, headers?: Record<string, string>) {
  return api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
}

async function waitForCompletion(id: string, timeoutMs = 45_000): Promise<{ status: number; body: Envelope<AnalysisDetailLike> }> {
  const deadline = Date.now() + timeoutMs;
  let last = await get<AnalysisDetailLike>(`/api/v1/analyses/${id}`);
  while (Date.now() < deadline) {
    const status = last.body.data?.status;
    if (status === "completed" || status === "failed") return last;
    await new Promise((r) => setTimeout(r, 400));
    last = await get<AnalysisDetailLike>(`/api/v1/analyses/${id}`);
  }
  return last;
}

interface AnalysisDetailLike {
  id: string;
  inputType: string;
  modality: string;
  status: "queued" | "processing" | "completed" | "failed";
  fileName: string | null;
  classification: string | null;
  likelihoodScore: number | null;
  confidence: number | null;
  processingTime: number | null;
  warnings: string[];
  errors: string[];
  llmInterpretation: string | null;
  llmProvider: string | null;
  llmModel: string | null;
  metadata: Record<string, unknown> | null;
  signals: Array<{ id: string; detectorId: string; signalKey: string; aiScore: number | null; direction: string; value: string | null }>;
  detectorRuns: Array<{ detectorId: string; status: string; source: string }>;
}

const createdAnalyses: string[] = [];
const createdDatasets: string[] = [];
const createdModels: string[] = [];

async function cleanup() {
  for (const id of createdAnalyses) await api(`/api/v1/analyses/${id}`, { method: "DELETE" }).catch(() => undefined);
  for (const id of createdDatasets) await api(`/api/v1/datasets/${id}`, { method: "DELETE" }).catch(() => undefined);
  for (const id of createdModels) await api(`/api/v1/models/${id}`, { method: "DELETE" }).catch(() => undefined);
}

withServer("AIDetective REST API v1 (live server)", () => {
  beforeAll(async () => {
    // warm compile of all routes we will hit
    await get("/api/v1/system/status").catch(() => undefined);
  });

  // ── system & meta endpoints ────────────────────────────────────────────────
  test("GET /system/status — health, DB, queue, detectors", async () => {
    const { status, body } = await get("/api/v1/system/status");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const d = body.data!;
    expect(d.app.name).toBe("AIDetective");
    expect(d.services.database.status).toBe("ok");
    expect(d.services.queue.implementation).toBe("in_memory");
    expect(d.services.detectors.total).toBeGreaterThanOrEqual(15);
    expect(d.services.security).toHaveProperty("requireApiKey");
  });

  test("GET /stats — aggregate counters shape", async () => {
    const { status, body } = await get("/api/v1/stats");
    expect(status).toBe(200);
    const d = body.data!;
    expect(d.totals).toHaveProperty("all");
    expect(d.totals).toHaveProperty("completed");
    expect(Array.isArray(d.recentIssues)).toBe(true);
  });

  test("GET /detectors — 15 builtins with weights and limitations", async () => {
    const { status, body } = await get<{ total: number; detectors: Array<{ id: string; defaultWeight: number; limitations: string[]; source: string; modalities: string[] }> }>("/api/v1/detectors");
    expect(status).toBe(200);
    expect(body.data!.total).toBeGreaterThanOrEqual(15);
    for (const d of body.data!.detectors) {
      expect(d.limitations.length).toBeGreaterThan(0);
      expect(d.defaultWeight).toBeGreaterThan(0);
    }
    const ids = body.data!.detectors.map((d) => d.id);
    for (const required of ["text.burstiness", "text.phrases", "image.metadata", "audio.metadata"]) {
      expect(ids).toContain(required);
    }
  });

  test("GET /plugins — example plugin loaded from disk", async () => {
    const { status, body } = await get<{
      total: number;
      plugins: Array<{ id: string; status: string }>;
      loadedFromPlugins: { detectors: string[] };
      api: { manifest: string };
    }>("/api/v1/plugins");
    expect(status).toBe(200);
    const example = body.data!.plugins.find((p) => p.id === "plugin.example-text-detector");
    expect(example?.status).toBe("loaded");
    expect(body.data!.loadedFromPlugins.detectors.length).toBeGreaterThan(0);
    expect(body.data!.api.manifest).toContain("plugin.json");
  });

  test("GET /openapi — valid OpenAPI 3 document (bare JSON, not envelope-wrapped, for tool interop)", async () => {
    const res = await fetch(`${BASE}/api/v1/openapi`, { signal: AbortSignal.timeout(30_000) });
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { openapi: string; paths: Record<string, unknown>; info: { title: string } };
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toContain("AIDetective");
    expect(Object.keys(spec.paths)).toContain("/api/v1/analyze");
    expect(Object.keys(spec.paths)).toContain("/api/v1/llm/test");
  });

  test("OPTIONS preflight — 204 + CORS headers", async () => {
    const res = await fetch(`${BASE}/api/v1/analyze`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  // ── text analysis ──────────────────────────────────────────────────────────
  withServer("text analysis", () => {
    test("POST /analyze — AI-style text completes with full detail", async () => {
      const { status, body } = await post<AnalysisDetailLike>("/api/v1/analyze", { content: AI_TEXT });
      expect(status).toBe(200);
      const d = body.data!;
      createdAnalyses.push(d.id);
      expect(d.status).toBe("completed");
      expect(d.classification).toBe("likely_ai_generated");
      expect(d.likelihoodScore).toBeGreaterThan(0.62);
      expect(d.confidence).toBeGreaterThan(0);
      expect(d.confidence).toBeLessThan(1);
      expect(d.detectorRuns.length).toBeGreaterThanOrEqual(9);
      expect(d.signals.length).toBeGreaterThanOrEqual(5);
      expect(d.summary).toContain("not proof");
      expect(d.warnings).not.toBeNull();
    });

    test("POST /analyze — informal human text does not get an AI verdict", async () => {
      const { status, body } = await post<AnalysisDetailLike>("/api/v1/analyze", { content: HUMAN_TEXT });
      expect(status).toBe(200);
      const d = body.data!;
      createdAnalyses.push(d.id);
      expect(d.classification).not.toBe("likely_ai_generated");
    });

    test("POST /analyze — deterministic: same input twice → identical verdict, score and signals", async () => {
      const a = (await post<AnalysisDetailLike>("/api/v1/analyze", { content: AI_TEXT })).body.data!;
      const b = (await post<AnalysisDetailLike>("/api/v1/analyze", { content: AI_TEXT })).body.data!;
      createdAnalyses.push(a.id, b.id);
      expect(a.classification).toBe(b.classification);
      expect(a.likelihoodScore).toBe(b.likelihoodScore);
      expect(a.confidence).toBe(b.confidence);
      expect(a.signals.map((s) => s.signalKey).sort()).toEqual(b.signals.map((s) => s.signalKey).sort());
      expect(a.signals.map((s) => s.aiScore)).toEqual(b.signals.map((s) => s.aiScore));
    });

    test("POST /analyze — detector selection via options.detectors", async () => {
      const { body } = await post<AnalysisDetailLike>("/api/v1/analyze", {
        content: AI_TEXT,
        options: { detectors: ["text.phrases"] },
      });
      const d = body.data!;
      createdAnalyses.push(d.id);
      expect(d.detectorRuns.map((r) => r.detectorId)).toEqual(["text.phrases"]);
    });

    test("POST /analyze — useLlm:true never changes the engine verdict", async () => {
      const plain = (await post<AnalysisDetailLike>("/api/v1/analyze", { content: AI_TEXT })).body.data!;
      const withLlm = (await post<AnalysisDetailLike>("/api/v1/analyze", { content: AI_TEXT, options: { useLlm: true } }, undefined)).body.data!;
      createdAnalyses.push(plain.id, withLlm.id);
      expect(withLlm.classification).toBe(plain.classification);
      expect(withLlm.likelihoodScore).toBe(plain.likelihoodScore);
      expect(withLlm.confidence).toBe(plain.confidence);
      if (withLlm.llmInterpretation !== null) {
        expect(withLlm.llmProvider).toBeTruthy();
        expect(withLlm.llmModel).toBeTruthy();
        expect(withLlm.llmInterpretation.length).toBeGreaterThan(10);
      }
    }, LONG);

    test("POST /analyze — validation errors are structured", async () => {
      const empty = await post("/api/v1/analyze", { content: "" });
      expect(empty.status).toBe(400);
      expect(empty.body.error?.code).toBe("VALIDATION_ERROR");

      const noBody = await post("/api/v1/analyze", undefined);
      expect(noBody.status).toBe(400);

      const malformed = await api("/api/v1/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      expect(malformed.status).toBe(400);
      expect(malformed.body.error?.code).toBe("VALIDATION_ERROR");
    });

    test("POST /analyze — text beyond the character limit → 413", async () => {
      const { status, body } = await post("/api/v1/analyze", { content: "x".repeat(200_001) });
      expect(status).toBe(413);
      expect(body.error?.code).toBe("PAYLOAD_TOO_LARGE");
    }, LONG);
  });

  // ── LLM endpoints ──────────────────────────────────────────────────────────
  test("POST /llm/test — connectivity check with honest result", async () => {
    const { status, body } = await post<{ ok: boolean; provider: string; model: string | null; latencyMs: number | null; error: string | null }>("/api/v1/llm/test", undefined, {});
    expect(status).toBe(200);
    const d = body.data!;
    expect(typeof d.ok).toBe("boolean");
    expect(d.provider.length).toBeGreaterThan(0);
    if (d.ok) {
      expect(d.latencyMs).toBeGreaterThan(0);
      expect(d.model).toBeTruthy();
      expect(d.error).toBeNull();
    } else {
      expect(d.error).toBeTruthy();
    }
  }, LONG);

  // ── file upload → queue → DB → report (full flow per format) ──────────────
  withServer("file upload pipeline", () => {
    async function upload(buf: Buffer, name: string, mime: string): Promise<Response> {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(buf)]), name);
      return fetch(`${BASE}/api/v1/analyze/file`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
    }

    test("PNG upload → 202 queued → completed with image detectors + report + delete", async () => {
      const png = buildPng({ width: 1024, height: 1024, pixel: (x, y) => [Math.round((x / 1023) * 255), Math.round((y / 1023) * 255), 100] });
      const res = await upload(png, "generated.png", "image/png");
      expect(res.status).toBe(202);
      const queued = (await res.json()) as Envelope<AnalysisDetailLike>;
      expect(queued.ok).toBe(true);
      const id = queued.data!.id;
      createdAnalyses.push(id);
      // worker may pick the job up between enqueue and our response read
      expect(["queued", "processing"]).toContain(queued.data!.status);
      expect(queued.data!.modality).toBe("image");

      const done = await waitForCompletion(id);
      expect(done.body.data!.status).toBe("completed");
      const d = done.body.data!;
      expect(d.classification).toBe("likely_synthetic");
      expect(d.metadata?.width).toBe(1024);
      expect(d.metadata?.height).toBe(1024);
      const runIds = d.detectorRuns.map((r) => r.detectorId);
      expect(runIds).toContain("image.metadata");
      expect(runIds).toContain("image.dimensions");
      expect(runIds).toContain("image.pixel_stats");
      const dims = d.signals.find((s) => s.detectorId === "image.dimensions");
      expect(dims).toBeDefined();

      // report JSON (bare JSON document — use raw fetch, not the envelope helper)
      const repRaw = await fetch(`${BASE}/api/v1/reports/${id}?format=json`, { signal: AbortSignal.timeout(30_000) });
      expect(repRaw.status).toBe(200);
      const report = (await repRaw.json()) as { summary: { analysisId: string }; report: { disclaimer: string } };
      expect(report.summary.analysisId).toBe(id);
      expect(report.report.disclaimer).toContain("NOT proof");

      // report HTML (text/html — raw fetch)
      const htmlRes = await fetch(`${BASE}/api/v1/reports/${id}?format=html`, { signal: AbortSignal.timeout(30_000) });
      expect(htmlRes.status).toBe(200);
      expect(htmlRes.headers.get("content-type")).toContain("text/html");
      const htmlText = await htmlRes.text();
      expect(htmlText).toContain("<!doctype html>");
      expect(htmlText).toContain("likely synthetic");

      // cleanup
      const del = await api(`/api/v1/analyses/${id}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect((del.body.data as { deleted: boolean }).deleted).toBe(true);
      const gone = await get(`/api/v1/analyses/${id}`);
      expect(gone.status).toBe(404);
    }, 90_000);

    test("TXT upload → document analysis via queue", async () => {
      const res = await upload(Buffer.from(AI_TEXT, "utf8"), "sample.txt", "text/plain");
      expect(res.status).toBe(202);
      const { data } = (await res.json()) as Envelope<AnalysisDetailLike>;
      createdAnalyses.push(data!.id);
      const done = await waitForCompletion(data!.id);
      expect(done.body.data!.status).toBe("completed");
      expect(done.body.data!.modality).toBe("document");
      expect(done.body.data!.classification).toBe("likely_ai_generated");
    }, 60_000);

    test("DOCX upload → real text extraction → completed", async () => {
      const docx = buildDocx([
        "In today's fast-paced world, artificial intelligence plays a crucial role in the ever-evolving landscape of technology and automation across industries worldwide.",
        "It is important to note that these systems delve into vast repositories of information and unlock the potential of seamless integration for organisations navigating complexities.",
        "Moreover, the robust frameworks serve as a testament to human ingenuity, harnessing the power of data to embark on a journey of continuous improvement and efficiency.",
      ]);
      const res = await upload(docx, "report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      expect(res.status).toBe(202);
      const { data } = (await res.json()) as Envelope<AnalysisDetailLike>;
      createdAnalyses.push(data!.id);
      const done = await waitForCompletion(data!.id);
      expect(done.body.data!.status).toBe("completed");
      expect(done.body.data!.modality).toBe("document");
      expect(done.body.data!.classification).toBe("likely_ai_generated");
    }, 60_000);

    test("PDF upload → embedded text extracted → completed", async () => {
      const pdf = buildPdf("The quick brown fox jumps over the lazy dog near the riverbank while the sun sets slowly behind the old oak trees.");
      const res = await upload(pdf, "doc.pdf", "application/pdf");
      expect(res.status).toBe(202);
      const { data } = (await res.json()) as Envelope<AnalysisDetailLike>;
      createdAnalyses.push(data!.id);
      const done = await waitForCompletion(data!.id);
      expect(done.body.data!.status).toBe("completed");
      expect(done.body.data!.modality).toBe("document");
      expect(done.body.data!.warnings.some((w) => w.includes("little or no extractable text"))).toBe(false);
    }, 60_000);

    test("WAV upload → audio pipeline with waveform analysis (regression: parser crash)", async () => {
      const wav = buildWav({ sampleRate: 8000, durationSec: 1 });
      const res = await upload(wav, "speech.wav", "audio/wav");
      expect(res.status).toBe(202);
      const { data } = (await res.json()) as Envelope<AnalysisDetailLike>;
      createdAnalyses.push(data!.id);
      const done = await waitForCompletion(data!.id);
      const d = done.body.data!;
      expect(d.status).toBe("completed");
      expect(d.modality).toBe("audio");
      const runIds = d.detectorRuns.map((r) => r.detectorId);
      expect(runIds).toContain("audio.metadata");
      expect(runIds).toContain("audio.waveform");
      const metaRun = d.detectorRuns.find((r) => r.detectorId === "audio.metadata");
      expect(metaRun?.status).toBe("ok");
    }, 60_000);

    test("MP3 upload → metadata-only analysis (honest waveform skip)", async () => {
      const mp3 = buildMp3({ title: "sample", encoder: "LAME3.100" });
      const res = await upload(mp3, "song.mp3", "audio/mpeg");
      expect(res.status).toBe(202);
      const { data } = (await res.json()) as Envelope<AnalysisDetailLike>;
      createdAnalyses.push(data!.id);
      const done = await waitForCompletion(data!.id);
      const d = done.body.data!;
      expect(d.status).toBe("completed");
      expect(d.modality).toBe("audio");
      expect(d.warnings.some((w) => w.includes("Waveform analysis was skipped"))).toBe(true);
    }, 60_000);

    test("corrupt PDF → analysis fails honestly with error recorded", async () => {
      const bad = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("this is not a real pdf body")]);
      const res = await upload(bad, "broken.pdf", "application/pdf");
      expect(res.status).toBe(202);
      const { data } = (await res.json()) as Envelope<AnalysisDetailLike>;
      createdAnalyses.push(data!.id);
      const done = await waitForCompletion(data!.id);
      const d = done.body.data!;
      expect(d.status).toBe("failed");
      expect(d.errors.length).toBeGreaterThan(0);

      // report for a failed analysis → 409 CONFLICT
      const rep = await get(`/api/v1/reports/${d.id}?format=json`);
      expect(rep.status).toBe(409);
      expect(rep.body.error?.code).toBe("CONFLICT");
    }, 60_000);

    test("upload validation: binary garbage → 415, missing file → 400, empty → 400", async () => {
      const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
      const form1 = new FormData();
      form1.append("file", new Blob([new Uint8Array(exe)]), "payload.exe");
      const r1 = await fetch(`${BASE}/api/v1/analyze/file`, { method: "POST", body: form1 });
      expect(r1.status).toBe(415);
      expect(((await r1.json()) as Envelope<unknown>).error?.code).toBe("UNSUPPORTED_MEDIA_TYPE");

      const r2 = await fetch(`${BASE}/api/v1/analyze/file`, { method: "POST", body: new FormData() });
      expect(r2.status).toBe(400);
      expect(((await r2.json()) as Envelope<unknown>).error?.code).toBe("VALIDATION_ERROR");

      const emptyForm = new FormData();
      emptyForm.append("file", new Blob([]), "empty.png");
      const r3 = await fetch(`${BASE}/api/v1/analyze/file`, { method: "POST", body: emptyForm });
      expect(r3.status).toBe(400);
      expect(((await r3.json()) as Envelope<unknown>).error?.code).toBe("VALIDATION_ERROR");
    }, 60_000);

    test("oversized upload → 413 PAYLOAD_TOO_LARGE", async () => {
      const big = Buffer.alloc(26 * 1024 * 1024, 0x41);
      const res = await upload(big, "big.txt", "text/plain");
      expect(res.status).toBe(413);
      expect(((await res.json()) as Envelope<unknown>).error?.code).toBe("PAYLOAD_TOO_LARGE");
    }, 90_000);
  });

  // ── history listing, search, filters, pagination ───────────────────────────
  withServer("history & listing", () => {
    test("GET /analyses — paginated, envelope-consistent", async () => {
      const { status, body } = await get<{ items: AnalysisDetailLike[]; page: number; pageSize: number; total: number; totalPages: number }>("/api/v1/analyses?page=1&pageSize=5");
      expect(status).toBe(200);
      const d = body.data!;
      expect(d.items.length).toBeLessThanOrEqual(5);
      expect(d.page).toBe(1);
      expect(d.totalPages).toBeGreaterThanOrEqual(1);
      for (const item of d.items) {
        expect(item.id).toBeTruthy();
        expect(["queued", "processing", "completed", "failed"]).toContain(item.status);
      }
    });

    test("GET /analyses — filters (modality, classification, search)", async () => {
      const textOnly = await get<{ items: AnalysisDetailLike[] }>("/api/v1/analyses?modality=text&pageSize=50");
      expect(textOnly.status).toBe(200);
      for (const item of textOnly.body.data!.items) expect(item.modality).toBe("text");

      const search = await get<{ items: AnalysisDetailLike[] }>("/api/v1/analyses?query=sample.txt");
      expect(search.status).toBe(200);

      const badDate = await get("/api/v1/analyses?from=not-a-date");
      expect(badDate.status).toBe(400);
      expect(badDate.body.error?.code).toBe("VALIDATION_ERROR");
    });

    test("GET /analyses — sorting by likelihoodScore", async () => {
      const { body } = await get<{ items: AnalysisDetailLike[] }>("/api/v1/analyses?sort=likelihoodScore&order=desc&pageSize=10");
      const scores = body.data!.items.map((i) => i.likelihoodScore ?? -1);
      const sorted = [...scores].sort((a, b) => b - a);
      expect(scores).toEqual(sorted);
    });

    test("404s are structured for every detail route (using each route's supported method)", async () => {
      const cases: Array<[string, string]> = [
        ["/api/v1/analyses/does-not-exist", "GET"],
        ["/api/v1/reports/does-not-exist", "GET"],
        ["/api/v1/datasets/does-not-exist", "GET"],
        ["/api/v1/models/does-not-exist", "DELETE"],
        ["/api/v1/api-keys/does-not-exist", "DELETE"],
      ];
      for (const [path, method] of cases) {
        const res = await api(path, { method, headers: method === "DELETE" ? { "Content-Type": "application/json" } : undefined });
        expect(res.status).toBe(404);
        expect(res.body.ok).toBe(false);
        expect(res.body.error?.code).toBe("NOT_FOUND");
      }
    });
  });

  // ── datasets CRUD + samples ────────────────────────────────────────────────
  withServer("datasets", () => {
    test("create → get → import samples → list → delete", async () => {
      const create = await post<{ id: string; name: string }>("/api/v1/datasets", {
        name: `test-dataset-${Date.now()}`,
        modality: "text",
        description: "integration test dataset",
        labels: ["ai", "human"],
      });
      expect(create.status).toBe(201);
      const id = create.body.data!.id;
      createdDatasets.push(id);

      const detail = await get<{ id: string; sampleCount: number; labels: string[] }>(`/api/v1/datasets/${id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data!.labels).toEqual(["ai", "human"]);
      expect(detail.body.data!.sampleCount).toBe(0);

      const imp = await post<{ imported: number }>(`/api/v1/datasets/${id}/samples`, {
        samples: [
          { content: AI_TEXT, label: "ai" },
          { content: HUMAN_TEXT, label: "human" },
        ],
      });
      expect(imp.status).toBe(202);
      expect(imp.body.data!.imported).toBe(2);

      const after = await get<{ sampleCount: number }>(`/api/v1/datasets/${id}`);
      expect(after.body.data!.sampleCount).toBe(2);

      const list = await get<{ datasets: Array<{ id: string }> }>("/api/v1/datasets");
      expect(list.body.data!.datasets.some((d) => d.id === id)).toBe(true);

      const del = await api(`/api/v1/datasets/${id}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      const gone = await get(`/api/v1/datasets/${id}`);
      expect(gone.status).toBe(404);
    });

    test("image-modality dataset rejects text sample import with explicit message", async () => {
      const create = await post<{ id: string }>("/api/v1/datasets", { name: `img-ds-${Date.now()}`, modality: "image" });
      const id = create.body.data!.id;
      createdDatasets.push(id);
      const imp = await post(`/api/v1/datasets/${id}/samples`, { samples: [{ content: "text" }] });
      expect(imp.status).toBe(400);
      expect(imp.body.error?.message).toContain("text/document/mixed");
    });

    test("invalid dataset payload → 400", async () => {
      const bad = await post("/api/v1/datasets", { name: "", modality: "hologram" });
      expect(bad.status).toBe(400);
    });
  });

  // ── models CRUD ────────────────────────────────────────────────────────────
  withServer("models registry", () => {
    test("create → patch status → delete", async () => {
      const create = await post<{ id: string }>("/api/v1/models", {
        name: "test/external-model",
        version: "1.0.0",
        modality: "text",
        provider: "custom",
        location: "remote",
        status: "experimental",
        capabilities: ["test-capability"],
      });
      expect(create.status).toBe(201);
      const id = create.body.data!.id;
      createdModels.push(id);

      const patch = await api(`/api/v1/models/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "disabled" }),
      });
      expect(patch.status).toBe(200);
      expect((patch.body.data as { status: string }).status).toBe("disabled");

      const list = await get<{ models: Array<{ id: string; name: string }> }>("/api/v1/models");
      expect(list.body.data!.models.some((m) => m.id === id)).toBe(true);
      // seeded builtin detector models exist
      expect(list.body.data!.models.some((m) => m.name.startsWith("detector/"))).toBe(true);

      const del = await api(`/api/v1/models/${id}`, { method: "DELETE" });
      expect(del.status).toBe(200);
    });

    test("PATCH with invalid status keeps existing (no corruption)", async () => {
      const create = await post<{ id: string }>("/api/v1/models", {
        name: "test/status-keep",
        version: "1.0.0",
        modality: "text",
        provider: "custom",
        location: "remote",
      });
      const id = create.body.data!.id;
      createdModels.push(id);
      const patch = await api(`/api/v1/models/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "hack-the-planet" }),
      });
      expect(patch.status).toBe(200);
      expect((patch.body.data as { status: string }).status).toBe("experimental");
    });
  });

  // ── API key lifecycle + rate limiting + auth enforcement ───────────────────
  withServer("API key lifecycle", () => {
    test("create → use (Bearer & X-API-Key) → list (no secrets) → revoke → 401", async () => {
      const create = await post<{ id: string; key: string; notice: string; prefix: string }>("/api/v1/api-keys", { name: "integration-test-key" });
      expect(create.status).toBe(201);
      const { id, key, notice } = create.body.data!;
      expect(key).toMatch(/^adk_[a-f0-9]{48}$/);
      expect(notice).toContain("never shown again");

      // use as Bearer
      const bearer = await get("/api/v1/detectors", { Authorization: `Bearer ${key}` });
      expect(bearer.status).toBe(200);
      // use as X-API-Key
      const xKey = await get("/api/v1/detectors", { "X-API-Key": key });
      expect(xKey.status).toBe(200);

      // list must not contain any plaintext
      const list = await get<{ keys: Array<{ id: string; prefix: string; revoked: boolean }> }>("/api/v1/api-keys");
      const rawList = JSON.stringify(list.body);
      expect(rawList).not.toContain(key.slice(12)); // secret suffix never persisted
      const listed = list.body.data!.keys.find((k) => k.id === id);
      expect(listed?.revoked).toBe(false);

      // revoke
      const revoke = await api(`/api/v1/api-keys/${id}`, { method: "DELETE" });
      expect(revoke.status).toBe(200);
      expect((revoke.body.data as { revoked: boolean }).revoked).toBe(true);

      // reuse after revoke → 401 (even in local mode: provided keys are validated)
      const after = await get("/api/v1/detectors", { Authorization: `Bearer ${key}` });
      expect(after.status).toBe(401);
      expect(after.body.error?.code).toBe("UNAUTHORIZED");

      // revoke again → idempotent
      const again = await api(`/api/v1/api-keys/${id}`, { method: "DELETE" });
      expect(again.status).toBe(200);
      expect((again.body.data as { alreadyRevoked: boolean }).alreadyRevoked).toBe(true);
    });

    test("invalid key → 401; key create validation → 400", async () => {
      const bad = await get("/api/v1/detectors", { Authorization: "Bearer adk_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" });
      expect(bad.status).toBe(401);

      const noName = await post("/api/v1/api-keys", {});
      expect(noName.status).toBe(400);
      expect(noName.body.error?.code).toBe("VALIDATION_ERROR");
    });

    test("per-key rate limit → 429 RATE_LIMITED", async () => {
      const create = await post<{ id: string; key: string }>("/api/v1/api-keys", { name: "rate-limited-key", rateLimit: 1 });
      const { id, key } = create.body.data!;
      const first = await get("/api/v1/detectors", { Authorization: `Bearer ${key}` });
      expect(first.status).toBe(200);
      const second = await get("/api/v1/stats", { Authorization: `Bearer ${key}` });
      expect(second.status).toBe(429);
      expect(second.body.error?.code).toBe("RATE_LIMITED");
      await api(`/api/v1/api-keys/${id}`, { method: "DELETE" });
    });
  });

  // ── settings ───────────────────────────────────────────────────────────────
  withServer("settings", () => {
    test("GET returns masked llm config + providers; PUT roundtrip preserves state", async () => {
      const before = await get<{ llm: { enabled: boolean; provider: string; apiKey: string | null; hasApiKey: boolean; temperature: number }; scoring: { aiThreshold: number }; providers: Array<{ id: string }> }>("/api/v1/settings");
      expect(before.status).toBe(200);
      const d = before.body.data!;
      expect(d.llm.apiKey === null || d.llm.apiKey.includes("stored")).toBe(true);
      expect(d.providers.map((p) => p.id)).toContain("ollama");

      // PUT the same scoring value back (idempotent, no state change)
      const put = await api("/api/v1/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoring: { aiThreshold: d.scoring.aiThreshold } }),
      });
      expect(put.status).toBe(200);
      const after = await get<{ scoring: { aiThreshold: number } }>("/api/v1/settings");
      expect(after.body.data!.scoring.aiThreshold).toBe(d.scoring.aiThreshold);

      // out-of-range scoring value → 400 (zod bounds)
      const bad = await api("/api/v1/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoring: { aiThreshold: 0.1 } }),
      });
      expect(bad.status).toBe(400);
    });
  });
});

// Cleanup runs after this file's tests regardless of pass/fail
afterAll(() => {
  void cleanup();
});

process.on("exit", () => void 0);

# AIDetective — Architecture

> This document describes the system **as implemented** (v0.1.0). Source of truth is the code:
> `src/lib/aidetective/**` and `src/app/api/v1/**`. Companion docs: [plugins.md](plugins.md) · [limitations.md](limitations.md).

**The one-sentence design rule:** raw detector output is stored untouched; all judgment happens in one deterministic, explainable scoring step; and the optional LLM can only describe that step's output — never change it. Detection remains probabilistic: the engine treats `uncertain` and `inconclusive` as first-class outcomes and caps confidence below 1.0 by design.

---

## 1. Bird's-eye view

```
HTTP ──► /api/v1 route handlers (auth, CORS, envelope)
              │
              ▼
        Orchestrator ─────────────────────────────────────────────┐
              │                                                   │
     text path│ file path                                         │
   (inline,   │ (validate → store → enqueue → 202)                │
    sync)     │        │                                          │
              ▼        ▼                                          │
        Parser registry (txt/md, pdf, docx, image, audio pass)     │
              │                                                   │
              ▼                                                   │
        Analyzer per modality (text|document|image|audio)          │
              │  feature extractors (features.text/image/audio)    │
              ▼                                                   │
        Detectors (15 builtin + plugins) ── errors contained ──►   │
              │  raw Signals (aiScore, weight, evidence)           │
              ▼                                                   │
        Scoring Engine (deterministic) ── score, confidence,       │
              │                               classification       │
              ▼                                                   │
        Optional LLM interpreter (explanation only) ── failure ⇒   │
              │                               warning only         │
              ▼                                                   ▼
        Report Engine (JSON / HTML exporters)          Prisma + SQLite
                                                       (analyses, signals, runs,
                                                        reports, keys, events, …)
```

## 2. Bootstrap (`src/lib/aidetective/bootstrap.ts`)

`ensureBootstrap()` is awaited by every API route and runs **once per process** (memoized on `globalThis`, with retry on transient DB failure):

1. **Register builtins** — 15 detectors, 5 parsers, 2 report exporters, 3 LLM providers into the in-memory registry (`core/registry.ts`).
2. **Start the queue worker** and attach it to the in-memory job queue.
3. **Load plugins** — scan `plugins/`, validate manifests, dynamic-import entries, call `register(api)`. A failing plugin is recorded with status `error`; it cannot abort boot.
4. **Seed the Model registry** — every detector appears as a local "model" row (`detector/<id>`), every LLM provider as `llm/<id>` with capability `interpretation-only`. This is a *registry* of analysis components, not a claim of trained models — capabilities say `heuristic-detection`.

## 3. Orchestrator flow (`orchestrator.ts`)

Two entry points share one pipeline (`executePipeline`):

- **`analyzeText`** — synchronous. Validates non-empty text and the `AIDETECTIVE_MAX_TEXT_CHARS` limit (else `PAYLOAD_TOO_LARGE`), creates the `Analysis` row (`processing`), runs the pipeline inline, returns the full `AnalysisDetail`.
- **`analyzeFileUpload`** — asynchronous. Validates the upload (see §7), creates the row (`queued`), stores the file at `uploads/<analysisId>.<ext>` with mode `0600`, enqueues the analysis id, and immediately returns `202` with the queued detail. The worker (`processQueuedAnalysis`) is idempotent: it only processes rows still in `queued`.

Pipeline stages, in order:

1. **Parse** (buffered inputs only): magic-byte detection (`security/files.ts`) chooses a parser; the parser returns a normalized `ParseOutput` (`kind`, `text`/`buffer`, `meta`, `warnings`). Unsupported content → `UNSUPPORTED_MEDIA_TYPE`. Document outputs (`pdf`, `docx`, txt/md) are converted to text and the effective modality becomes `document`; images/audio pass through with validated metadata.
2. **Feature extraction** — each analyzer owns its extractors (`features.text`, `features.image`, `features.audio`). Extractor failures are recorded as analysis errors and analysis continues.
3. **Detectors** — the analyzer resolves registered detectors matching its modality (optionally restricted by `options.detectors`). Each detector runs in isolation:
   - thrown errors are caught, logged, persisted as a `DetectorRun` with `status: "error"`, pushed into analysis `errors`, and a `SystemEvent` is written;
   - `skipped` is a normal outcome (e.g. fewer than ~8 sentences for burstiness).
4. **Scoring** — `scoreAnalysis(signals, modality, scoringConfig)` (§4). Analyzer-level warnings are appended (e.g. "very short text", "Persian phrase list is experimental", "no trained CV model bundled").
5. **Optional LLM interpretation** — only when `options.useLlm === true` **and** LLM is enabled in settings. The interpreter receives the structured verdict (classification, score, confidence, ≤20 compacted signals with up to 2 evidence quotes each) and a system prompt with hard rules (never change the verdict, never claim certainty, ≤300 words, answer in the content's language). Any failure → warning, analysis continues.
6. **Persist** — signals (raw, untouched), detector runs, outcome, summary, warnings, errors, LLM fields, modality metadata; a `SystemEvent` records completion. A human-readable `summary` is generated that itself includes the phrase "probabilistic estimate, not proof".

Guarantees: raw signals are never overwritten by interpretation; `uncertain` / `inconclusive` / `failed` are valid outcomes; detector errors never abort the analysis; the LLM never decides the verdict (enforced by prompt **and** by data flow — it is only ever given the final outcome).

## 4. Scoring Engine math (`core/scoring.ts`)

Configurable via `ScoringConfig` (env `AIDETECTIVE_SCORING_*`, overridable at runtime through `GET/PUT /api/v1/settings`). Defaults: `aiThreshold = 0.62`, `humanThreshold = 0.42`, `minSignals = 2`, `maxConfidence = 0.92`.

**Step 1 — usable signals.** Signals with `aiScore ≠ null` and effective weight > 0 (per-detector weight overrides are clamped to `[0, 1]`). Zero usable signals → immediately `inconclusive` with `score: null`.

**Step 2 — weighted vote.** Each signal votes: `vote = aiScore·2 − 1 ∈ [−1, +1]` (−1 human, +1 AI). Contribution: `contribution = vote · weight`. Then

```
polarity = Σ(vote·w) / Σw            ∈ [−1, +1]
score    = (polarity + 1) / 2        ∈ [0, 1]   ← likelihood of AI involvement (probability estimate, NOT proof)
```

**Step 3 — consistency & strength** over *active* signals only (|vote| > 0.1; neutral signals do not dilute either measure):

```
consistency = |Σ active contributions| / Σ active (|vote|·w)     — how one-directional the expressed evidence is
strength    = Σ active (|vote|·w) / Σ active w                   — how far from neutral the active signals are
```

**Step 4 — confidence** (hard-capped; must never reach 1.0):

```
confidence = 0.25 + 0.35·consistency + 0.2·strength
                 + 0.1·min(usable/4, 1) + 0.1·min(Σw/5, 1)
confidence = min(confidence, min(maxConfidence, 0.99))       — default ceiling 0.92
```

**Step 5 — classification.**

| Condition | Result |
| --- | --- |
| usable < `minSignals` (2) **or** `consistency < 0.35` (conflicting) **or** `confidence < 0.3` (too weak) | `uncertain` |
| `score ≥ aiThreshold` (0.62) | `likely_ai_generated` for text/document · `likely_synthetic` for image/audio |
| `score ≤ humanThreshold` (0.42) | `likely_human` |
| otherwise (0.42 < score < 0.62) | `uncertain` |
| no usable signals at all | `inconclusive` |

Every contribution is recorded in `breakdown` (signal id, detector id, weight, aiScore, contribution), sorted by |contribution| — the API, HTML report and UI can therefore always show *why* a score is what it is. Confidence labels: `very low < 0.35`, `low < 0.55`, `moderate < 0.75`, `high (never absolute)`.

## 5. Data model (Prisma / SQLite)

`Analysis` (status machine: `queued → processing → completed | failed`; classification, score, confidence, timings, LLM fields, warnings/errors, metadata JSON) → `AnalysisSignal` (one row per raw signal: `aiScore`, `weight`, `direction`, `evidence` JSON) · `AnalysisDetectorRun` (per-detector version, source `builtin|plugin`, status, duration, error) · `Report` (json|html content) · `ApiKey` (prefix, `keyHash` sha256, `rateLimit`, `revokedAt`) · `Dataset` · `Model` · `Plugin` (status `loaded|error`) · `SystemEvent` (audit trail, secrets excluded) · `Setting` (key/value JSON for runtime config).

Deleting an analysis cascades to its signals, runs and reports. The schema deliberately avoids SQLite-specific features so PostgreSQL is a later swap, not a rewrite.

## 6. Queue design (`queue/job-queue.ts`)

- **Implementation:** in-process FIFO of analysis ids; N workers (`AIDETECTIVE_QUEUE_CONCURRENCY`, default 1) pulling sequentially.
- **Durability:** rows are persisted **before** enqueue — a crash loses at most in-flight work, never history. A `queued` row left behind by a crash is re-processed on the next enqueue tick of the same process (worker is idempotent by status check). Persistence across restarts is *not* provided — that's Redis territory (roadmap).
- **HMR safety:** singleton stored on `globalThis` so Next.js dev-mode reloads don't duplicate queues.
- **Contract narrowness:** `enqueue(id)` + `stats()` — deliberately shaped so a Redis + distributed worker pool can replace the class without touching the analysis engine.
- Failure policy: the orchestrator marks failed analyses; the queue's own catch is a last-resort net.

## 7. File-type detection & security model (`security/files.ts`, `security/auth.ts`)

Uploads are **untrusted input**. The layered model:

1. **Content is the only truth.** `detectFileType(buffer)` sniffs magic bytes (PNG, JPEG, WEBP, WAV, FLAC, MP3 via ID3/frame-sync, M4A via `ftyp`, PDF, DOCX via ZIP + `word/` marker, UTF-8 text heuristic). Client-declared extension/MIME are hints only; mismatches produce explicit warnings.
2. **Allow-list.** `binary`/`archive` families are rejected (`415`). Allowed: txt, md, pdf, docx, png, jpg, webp, wav, mp3, flac, m4a.
3. **Limits.** `AIDETECTIVE_MAX_UPLOAD_MB` (default 25) plus a 60 MB HTTP-level cap; empty buffers rejected.
4. **Filenames.** `sanitizeFilename` strips paths/control chars, whitelists `[a-zA-Z0-9._\- ]` plus Persian letters, collapses `..`, caps length at 120. Stored files are renamed to `<analysisId>.<ext>` with extension whitelisting and written with mode `0600`.
5. **Path containment.** On processing, the stored path must pass `isInsideUploads()` — anything outside `uploads/` fails the analysis rather than being read.
6. **API keys.** Keys are `adk_` + 24 random bytes; only sha256 hashes are stored; plaintext is returned once at creation and never logged (the structured logger redacts secrets). Two headers accepted: `Authorization: Bearer …` / `X-API-Key: …`. Optional per-key sliding-window rate limit (requests/minute, in-memory). Local mode (`AIDETECTIVE_REQUIRE_API_KEY=false`, default) accepts keyless requests but still validates keys that are presented; key management endpoints always require a valid key.
7. **Logging discipline.** Structured logs never include request bodies or secrets; raw content is logged only with `AIDETECTIVE_DEBUG_CONTENT=true` (debug only).

## 8. REST API surface (`src/app/api/v1/**`)

- **Envelope** (`lib/api/respond.ts`): `{ok: true, data, meta?}` / `{ok: false, error: {code, message, details?}}`; CORS `*` with preflight; `Cache-Control: no-store`.
- **Error codes** map to HTTP: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500, `SERVICE_UNAVAILABLE` 503.
- **18 paths** (OpenAPI 3.0.3 at `/api/v1/openapi`): `analyze`, `analyze/file`, `analyses`, `analyses/{id}` (GET/DELETE), `reports/{id}?format=json|html`, `system/status`, `stats`, `detectors`, `models` (+`{id}` PATCH/DELETE), `plugins`, `datasets` (+`{id}`, `{id}/samples` — text import only), `llm/test`, `settings` (GET/PUT), `api-keys` (GET/POST), `api-keys/{id}` (DELETE/revoke), `openapi`.
- File analysis returns `202` immediately; poll `GET /analyses/{id}` until `completed`/`failed`.

## 9. Plugin loading (`plugins/loader.ts`)

Discovery is a fixed-root fs scan of `plugins/` (no traversal — directory names only, entries starting with `.`/`_` skipped). Manifests require `id`, `name`, `version`, `type ∈ {detector, parser, llm_provider, exporter}`, and `entry` — a **relative `.js` file** inside the plugin folder (`..` rejected). Entries are loaded at runtime via dynamic `import()` marked `webpackIgnore`/`turbopackIgnore` so bundlers never touch plugin code; nothing is `eval`ed. The loader builds a validating `PluginApi`; a throwing `register()` (or entry) results in `status: "error"` persisted to the `Plugin` table plus a `SystemEvent`, while the app continues with builtin detectors only. Plugin LLM providers are registered **for visibility only** — the active provider always resolves through settings, so a plugin cannot silently hijack LLM traffic. Full author guide: [plugins.md](plugins.md).

## 10. Honest-engine invariants (summary)

1. Signals are stored raw; interpretation is separate and optional.
2. Confidence is capped (`maxConfidence < 1.0`); "high" is labeled *"high (never absolute)"*.
3. `uncertain` and `inconclusive` are normal outcomes, not failures.
4. Detector limitations are first-class metadata (`limitations` on every detector, served by `/api/v1/detectors`).
5. The LLM layer is explanation-only by construction — it receives the verdict, never produces it.
6. Reports carry the disclaimer: *"This report is the output of a probabilistic heuristic analysis. It is NOT proof of authorship and must not be used as sole evidence."*

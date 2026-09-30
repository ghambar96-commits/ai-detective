# AIDetective — Agent Worklog

Shared work journal. Every agent MUST read this file before starting and
append its section after finishing its Task ID.

---

Task ID: 1 + 2-a + 2-b + 2-c + 2-d
Agent: Z.ai Code (orchestrator)
Task: Project foundation, core engine, pipelines, LLM/reports/plugins, REST API /api/v1

Work Log:
- Installed exifreader, mammoth, unpdf (sharp was already present).
- Prisma schema: Analysis, AnalysisSignal, AnalysisDetectorRun, Report, ApiKey, Dataset, Model, Plugin, SystemEvent, Setting. Pushed with `bun run db:push`.
- Core engine in src/lib/aidetective/: core/types.ts (all interfaces: Detector, Analyzer, FeatureExtractor, FileParser, LLMProvider, ReportExporter, PluginApi), core/scoring.ts (weighted, explainable scoring; caps confidence < 1.0; uncertain/inconclusive are valid outcomes), core/registry.ts, core/config.ts (env), core/logger.ts (structured + redacting), core/errors.ts.
- Security: security/files.ts (magic-byte type detection, filename sanitization, size limits, safe storage under uploads/), security/auth.ts (API keys: sha256-at-rest, plaintext shown once, per-key rate limit, local-mode default).
- Features: features/text-features.ts (sentence stats, TTR/entropy, punctuation profile, EN+FA AI-phrase lists, n-gram repetition, informality markers), features/image-features.ts (EXIF via exifreader, PNG tEXt/iTXt chunks, JPEG DQT quality estimate via IJG inversion + SOF dims/subsampling, sharp pixel stats), features/audio-features.ts (WAV PCM decode + waveform stats, ID3v2/FLAC/M4A container parsers, TTS encoder hints).
- Parsers: txt/md, pdf (unpdf), docx (mammoth), image/audio passthrough — in parsers/index.ts.
- 15 builtin detectors: 9 text (burstiness, vocabulary, phrases, punctuation, structure, repetition, informality, entropy, connectives), 4 image (metadata, dimensions, compression, pixel-stats-experimental), 2 audio (metadata, waveform-experimental WAV-only). All expose honest `limitations`.
- Analyzers per modality (text/document/image/audio) in analyzers/index.ts.
- Orchestrator: inline text analysis + queued file analysis (in-memory FIFO queue, globalThis singleton, HMR-safe). Detector errors isolated per detector. LLM interpretation optional, explanation-only (never influences verdict).
- LLM providers: Ollama, OpenAI-compatible (OpenAI/OpenRouter/custom), ZAI managed runtime (works in this sandbox). Reports: JSON + self-contained HTML (printable → future PDF is drop-in via ReportExporter).
- Plugin system: plugins/<name>/plugin.json + index.js exporting register(api); fs-scan + runtime dynamic import (webpackIgnore/turbopackIgnore); broken plugins can't crash the app; example plugin plugins/example-text-detector (loads OK, registers text.example.hedging detector).
- API /api/v1: analyze, analyze/file (multipart, 202+poll), analyses (search/filter/paginate), analyses/[id] (GET/DELETE), reports/[id]?format=json|html, system/status, stats, detectors, models (+[id] POST/PATCH/DELETE), plugins, datasets (+[id], +[id]/samples), llm/test, settings (GET/PUT), api-keys (+[id] revoke), openapi (OpenAPI 3.0.3, 18 paths). CORS + unified envelope {ok,data|error}. apiHandler wrapper does auth + structured logging (no bodies/secrets).

Stage Summary:
- Verified by curl: text AI-text → likely_ai_generated; informal human text → honest uncertain; 1024x1024 no-EXIF JPEG → likely_synthetic; plugin listed as loaded; API key lifecycle (create→use→revoke→401) works; LLM (zai) test-connection + interpretation work and do NOT change the verdict; OpenAPI served at /api/v1/openapi.
- Known limitations (documented, surfaced in UI/API as warnings): no trained ML models (heuristic baselines only), waveform analysis WAV-only, no ASR/transcript analysis, no Persian ASR, WEBP metadata limited, no GPU detection, datasets import/export partial (text only), no PDF report exporter yet, no distributed queue (in-memory only), no automated test suite in this environment (test plan documented in README roadmap instead).
- DB settings: llm enabled=true with provider=zai in the RUNNING sandbox DB (works without any user keys). Fresh local installs default to LLM disabled via env.

---

Task ID: 3-b
Agent: general-purpose
Task: Documentation & packaging for AIDetective — README (EN+FA), docs, Docker, env template, license, Python client

Work Log:
- Read worklog.md, prisma/schema.prisma, core/types.ts, core/config.ts, core/scoring.ts, orchestrator.ts, plugins/loader.ts, security/{files,auth}.ts, queue/job-queue.ts, llm/{providers,interpret}.ts, analyzers, parsers, reports, openapi route, plugin example, .env, package.json, next.config.ts. Verified all endpoint paths (18 in OpenAPI), env var names, detector ids/weights, scoring math and format support against the actual code before writing.
- Created README.md (EN): overview + screenshot placeholders (marked TODO — dashboard UI is under development; release is API-first, honestly stated), what-this-is/what-this-is-NOT table, features, modality/format table with per-format analysis level (WAV = full audio level; MP3/FLAC/M4A = metadata-only; PDF/DOCX = text-level; WEBP = limited metadata), architecture ASCII diagram (User → Web Dashboard → REST /api/v1 → Orchestrator → modality pipelines → Detectors → Evidence → Scoring Engine → optional LLM (explanation only) → Report Engine → DB), 15-detector table (id/modality/measure/weight) + example plugin, tech stack + honest FastAPI→Next.js 16 adaptation note, install (bun install → cp .env.example .env → db:push → dev), production build + Docker sections (documents the standalone-output quirk), curl examples (analyze text, multipart file + 202/poll, list, reports json/html, create/revoke API key, Bearer auth), OpenAPI import note, Python client reference, LLM setup (zai managed / Ollama / OpenAI-compatible incl. OpenRouter + explanation-only guarantee), plugin + detector dev guides, real project-structure tree, honest testing section (no automated suite in this release; intended test matrix + vitest/bun-test tooling), limitations, roadmap (phase 2/3), env var table, contributing, MIT.
- Created README.fa.md: full Persian equivalent with identical sections and depth; fluent developer Persian, technical terms (detector, pipeline, endpoint, score) kept in English per community convention; honesty disclaimers included (e.g. «این ابزار تحلیل احتمالاتی ارائه می‌دهد و خروجی آن مدرک قطعی نیست»).
- Created .env.example: all env vars from core/config.ts (incl. optional AIDETECTIVE_SCORING_* overrides) with safe defaults — LLM disabled, provider=zai, REQUIRE_API_KEY=false — each with explanatory comments; DATABASE_URL=file:./db/custom.db with a note that relative SQLite paths resolve against prisma/schema.prisma (and the Docker path file:/app/db/custom.db).
- Created LICENSE (MIT, "AIDetective contributors"), .dockerignore (node_modules, .next, db, uploads, logs, .git, docs/screenshots, .env* to keep secrets out of the image), Dockerfile (3-stage oven/bun:1: deps → prisma generate + next build → runtime; runs `bun run db:push` then `bunx next start -p 3000`; documented why: next.config.ts has no output:"standalone" and the repo start script expects one, so the image serves the regular build; devDeps needed for build), docker-compose.yml (build ., 3000:3000, volumes ./db:/app/db + ./uploads:/app/uploads, env_file .env, restart unless-stopped, DATABASE_URL guidance).
- Created docs/architecture.md (bootstrap order, orchestrator flow stage-by-stage, full scoring math: vote→polarity→score, consistency/strength→capped confidence, classification/uncertain/inconclusive rules table, data model, queue design, magic-byte + API-key security model, API envelope/error codes, plugin loading, honest-engine invariants), docs/plugins.md (manifest schema table, lifecycle, PluginApi, error containment, complete detector/parser/exporter plugin examples, verification curls, submission checklist), docs/limitations.md (core probabilistic caveat + why 100% is impossible + responsible-use rules; all 12 worklog limitations in a table incl. no trained models, WAV-only waveform, no ASR/Persian ASR, WEBP limits, no GPU, text-only datasets, JSON/HTML reports, in-memory queue, explanation-only LLM, optional auth, no test suite, dashboard WIP; misclassification reporting guide).
- Created examples/aidetective_client.py (~142 lines, Python 3.9+, requests-only, typed, docstrings): AIDETECTIVE_URL/AIDETECTIVE_API_KEY env support, analyze_text → POST /api/v1/analyze with Bearer, analyze_file → multipart POST /api/v1/analyze/file + polling GET /api/v1/analyses/{id} with timeout, envelope validation with structured-error raising, prints verdict/score/confidence/top-3 signals by |contribution| with directions + disclaimer; argparse CLI (text|file) verified via --help, syntax checked.
- Appended AIDetective section to .gitignore (uploads/, db/*.db*, dev.log, server.log, *.tsbuildinfo) keeping existing content.

Stage Summary:
- 11 files created (README.md, README.fa.md, .env.example, LICENSE, Dockerfile, docker-compose.yml, .dockerignore, docs/architecture.md, docs/plugins.md, docs/limitations.md, examples/aidetective_client.py) + .gitignore append + this worklog entry. No changes under src/**, prisma/**, plugins/**; no tests added; no servers started.
- Accuracy measures: every claim traced to code (openapi route = 18 paths; 9+4+2 detectors with exact ids/weights; scoring defaults 0.62/0.42/2/0.92; LLM provider defaults llama3.1/gpt-4o-mini/glm-4.5-flash; adk_ keys sha256-at-rest; magic-byte allow-list txt·md·pdf·docx·png·jpg·webp·wav·mp3·flac·m4a).
- Honesty measures: probabilistic-not-proof warnings lead both READMEs, limitations.md, architecture.md and the Python client output; dashboard stated as under development (screenshots = TODO placeholders); no-automated-test-suite stated openly with intended matrix; FastAPI→Next.js adaptation documented as-is; detector weights/limitations surfaced as configurable metadata.
- Known packaging caveats (documented in-place): repo build/start scripts assume standalone output that next.config.ts does not enable — Dockerfile works around this by running `bunx next build` + `bunx next start` directly; docker-compose users must set DATABASE_URL=file:/app/db/custom.db so SQLite lands in the mounted ./db volume (relative paths resolve against prisma/).
- Next actions: add real dashboard screenshots when the UI lands; implement the phase-2 test matrix; consider output:"standalone" + pruning for smaller images; dataset evaluation harness before any accuracy claims.

---
Task ID: 3-a
Agent: full-stack-developer (completed; final verification by orchestrator after context deadline)
Task: Frontend dashboard — single-route dark analyst workspace

Work Log:
- Built src/app/page.tsx ("use client" workspace root, hash-based view switching), src/lib/api/client.ts (typed envelope-unwrapping fetch), src/types/api.ts, src/stores/ui-store.ts (zustand), src/components/aidetective/{shell,sidebar-nav,shared,analysis-result}.tsx and 12 views under src/components/aidetective/views/ (dashboard, analyzer x4 tabs, history, reports, datasets, models, llm, api, plugins, system, settings, analysis-detail).
- Agent hit a context deadline during final browser pass; orchestrator completed verification (see Task 4).

Stage Summary:
- All views render against the real API; honest score captions ("Likelihood estimate — not proof", "Always below 100% — never proof"); detector runs table shows ok/skipped reasons and plugin source; footer sticky (gap 0), sidebar collapses to Sheet on mobile.

---
Task ID: 4
Agent: Z.ai Code (orchestrator)
Task: End-to-end verification & fixes

Work Log:
- Fixed registry bug: object-spread on class instances dropped prototype methods (p.canParse) → registry now preserves instances.
- Fixed scoring engine: consistency now measured over active signals only, split into consistency (direction agreement) × strength (distance from neutral); confidence = 0.25 + 0.35c + 0.2s + 0.1count + 0.1weight, capped < 1.0.
- Added JPEG SOF width/height parsing (EXIF-less images now get dimensions); fixed imageMetadata feature key; fixed `ext` reference in ImageParser; fixed ??/|| precedence in image-features.
- Agent-browser E2E: dashboard renders live stats; Analyzer text flow (sample → analyze → verdict "Likely AI-generated", 73.2% likelihood, 85.8% confidence, honest captions, 10 detector runs incl. plugin detector); History rows open/delete; System shows CPU/RAM/uptime/queue/DB/LLM; API/LLM/Plugins/Settings/Models/Datasets views render; zero console/page errors; footer sticks with 0 gap at viewport bottom; sidebar hidden on mobile (Sheet).
- API verified by curl: dataset create/import/delete; API-key create→use→revoke→401; LLM test (zai, 324 ms) and interpretation (does not alter verdict); OpenAPI 18 paths; report JSON+HTML.
- Captured real screenshots to docs/screenshots/{dashboard,analyzer,history,system}.png and updated README.md/README.fa.md (removed "under development" claims).
- Final lint clean; 0 server 500s; cleaned debug-failed analyses (13 completed / 0 failed).

Stage Summary:
- MVP COMPLETE and browser-verified: dashboard, text analyzer, file upload (image verified; audio/document pipelines share the queue path), REST API v1, OpenAPI, DB + history, structured reports, optional LLM abstraction, README EN/FA, plugin system with working example plugin.

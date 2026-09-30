# AIDetective — Limitations & Responsible Use

> Version 0.1.0. This document is the maintained, honest list of what AIDetective **cannot** do.
> It is linked prominently from the [README](../README.md#limitations) and from [architecture.md](architecture.md).

---

## 0. The core caveat — read this even if you read nothing else

> **AIDetective provides a probabilistic analysis. Its output is NOT proof of authorship or origin.**
>
> Every classification — `likely_human`, `likely_ai_generated`, `likely_synthetic` — is a weighted estimate over heuristic signals. AI-content detection **cannot be 100% accurate** and this release does not pretend otherwise. Both error modes are expected and real:
>
> - **False positives** — human-written work flagged as AI. This happens routinely to formal, structured or non-native writing, and the personal cost of a false accusation can be severe.
> - **False negatives** — AI-generated or AI-assisted work flagged as human. Light paraphrasing, style transfer, or a different model can defeat every heuristic here.
>
> Additional structural reasons a 100% detector is impossible, in principle and not just in practice:
>
> 1. **The boundary is blurry.** "AI-assisted" is a spectrum: outline-then-edit, AI-draft-then-human-rewrite, human-draft-then-AI-polish. A single label cannot represent a mixture.
> 2. **Style is not identity.** Many human authors naturally write in the "flat, uniform, formal" style the heuristics associate with models; many models can be prompted to write bursty, informal, error-rich prose.
> 3. **Statistics ≠ provenance.** Heuristics measure the *artifact*, not its *history*. Only cryptographic provenance (e.g. C2PA — on our roadmap) or attested generation logs can speak to history.
> 4. **Distributions shift.** Each new model generation changes the statistics these detectors rely on; yesterday's "AI tell" can vanish tomorrow.
>
> The design reflects this honesty: confidence is **hard-capped below 1.0** (default 0.92), `uncertain` and `inconclusive` are first-class outcomes, every detector ships user-visible `limitations`, and reports embed the disclaimer *"This report is the output of a probabilistic heuristic analysis. It is NOT proof of authorship and must not be used as sole evidence."*

### Responsible use

- **Never** use AIDetective as sole evidence for accusations, disciplinary action, legal proceedings, defamation, grading penalties, or harassment.
- **Always** pair results with human review, context, and — where it matters — provenance or process evidence (draft history, version logs, interviews).
- Short inputs are inherently unreliable; the engine flags texts under ~120 words as weak. Do not report such results as findings.
- If you publish analyses, publish the *full* report (signals, evidence, confidence) — not just the label — so readers can judge the weakness for themselves.

---

## 1. Engine-level limitations (v0.1.0)

| # | Limitation | Detail & user-facing behavior |
| --- | --- | --- |
| 1 | **No trained ML models — heuristic baselines only** | All 15 builtin detectors are transparent statistical/lexical heuristics. No model was trained or benchmarked in this release; there are no accuracy/AUC figures to cite, and none should be assumed. The engine labels image and audio results as heuristic baselines via explicit warnings ("must not be treated as proof"). Trained CV/audio models are planned **as detector plugins** (phase 2). |
| 2 | **Waveform analysis is WAV-only** | `audio.waveform` decodes PCM WAV. MP3/FLAC/M4A run **metadata-only** (ID3v2 / VORBIS / M4A `ilst` tags); no waveform statistics for them. |
| 3 | **No ASR / transcript analysis** | No speech-to-text at all — the text detectors never see spoken content. Consequently no "does it sound scripted" analysis and **no Persian ASR** either. Audio semantics are out of scope for now (roadmap). |
| 4 | **WEBP metadata is limited** | WEBP metadata parsing is minimal compared to PNG/JPEG; the parser attaches an explicit warning and pixel analysis still runs on the decoded frame. |
| 5 | **No GPU detection** | `GET /api/v1/system/status` reports system/queue/DB status but not GPU hardware. Irrelevant to the current heuristic engine; planned with model support. |
| 6 | **Datasets: text import only** | `POST /api/v1/datasets/{id}/samples` imports **text samples**; image/audio dataset import and any training/eval harness do not exist yet. |
| 7 | **Reports: JSON/HTML only** | The Report Engine ships two exporters (`report.json`, self-contained printable `report.html`). No PDF exporter yet (drop-in via `ReportExporter` — roadmap). |
| 8 | **In-memory queue** | The FIFO job queue holds analysis ids in process memory: no persistence across restarts (queued rows from a crashed process remain `queued`), no distributed workers, single-node only. Redis is planned; the queue interface was designed to make that a swap. |
| 9 | **LLM is optional and explanation-only** | Off by default. When enabled it only explains the engine's structured output (system-prompt-forbidden from changing it, and data-flow-forbidden: it only ever *receives* the final verdict). It adds no detection capability. |
| 10 | **API-key auth is optional (local-mode default)** | `AIDETECTIVE_REQUIRE_API_KEY=false` (default) accepts keyless requests — right for `localhost`, wrong for any shared deployment. Rate limiting is per-key and in-memory (resets on restart, not shared across workers). |
| 11 | **Heuristic baseline quality (no benchmark evals)** | 186 automated tests (`bun test`) verify determinism, security, parsing, scoring and every API endpoint — but tests verify **correct behavior, not detection accuracy**. Accuracy-vs-benchmark evaluation still requires a labeled dataset harness (roadmap). |
| 12 | **Web dashboard is complete but API-first** | All 12 dashboard views (analyzer ×4, history, reports, datasets, models, LLM, plugins, system, API keys, settings) are functional and browser-verified; the REST API remains the primary, fully-featured interface. |

## 2. Modality-specific caveats

**Text / documents**
- Reliability degrades sharply below ~120 words (the analyzer attaches warnings at <120 and <40 words).
- Phrase lists cover **English fully; Persian is experimental** (smaller coverage, explicitly warned). Mixed-language content is flagged.
- Formal human prose (legal, academic) naturally scores toward "AI" on burstiness/connectives; the detectors' `limitations` say so and the scoring engine can still output `uncertain`.
- PDF: text extraction only — **no OCR**. Scanned/image-only PDFs yield an explicit warning and weak results. DOCX: body text only (formatting, comments and track-changes are not analyzed).

**Images**
- No trained computer-vision model — metadata + dimensions + compression + first-order pixel statistics only. Clean EXIF-free images (the norm for AI output *and* common for social-media re-uploads) lean the metadata detector toward "no camera provenance", which is weak evidence on its own.
- `image.pixel_stats` (Laplacian variance, LSB uniformity, channel balance) is **experimental** with deliberately low weight.

**Audio**
- Only WAV gets waveform statistics; only container/tag metadata is read for MP3/FLAC/M4A.
- TTS detection relies on encoder/tag strings ("elevenlabs", "bark", "coqui", …) — trivially strippable, so absence proves nothing.

## 3. Security-posture limitations

- Single-tenant, single-user design: API keys authenticate clients, but there are no per-user workspaces or SSO (roadmap, phase 3).
- Uploads are stored unencrypted under `uploads/` (mode `0600`, sanitized names, path containment enforced); disk-level protection is your deployment's responsibility.
- The in-memory rate limiter and queue are per-process; run one node or wait for Redis.

## 4. How to report misclassifications

Open an issue with the **full report JSON** (`GET /api/v1/reports/{id}?format=json`), the content (or a representative sample), the true origin, and what you expected. Detector-level false-positive/negative reports are the single most useful contribution right now and directly feed the phase-2 evaluation harness.

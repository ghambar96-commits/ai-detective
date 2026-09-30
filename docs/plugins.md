# AIDetective — Plugin Author Guide

> Companion docs: [architecture.md](architecture.md) · [limitations.md](limitations.md).
> Reference implementation: [`plugins/example-text-detector/`](../plugins/example-text-detector/).

Plugins extend AIDetective **without touching its source**. Four extension points exist, all registered through one contract:

| Type (`plugin.json`) | Registers via | What you can add |
| --- | --- | --- |
| `detector` | `api.registerDetector(detector)` | New analysis signals for any modality |
| `parser` | `api.registerParser(parser)` | New input file formats |
| `llm_provider` | `api.registerLLMProvider(provider)` | New explanation back-ends (registered for visibility; the active provider always resolves through settings) |
| `exporter` | `api.registerExporter(exporter)` | New report formats (e.g. a future PDF exporter) |

> ⚠️ House rule: a plugin that hides uncertainty is a bug. If your detector can't quantify something, return `aiScore: null`. Always ship honest `limitations`.

---

## 1. Layout & manifest

```
plugins/<my-plugin>/
├── plugin.json     # manifest (validated at boot)
└── index.js        # ESM entry — must export register(api)
```

**Manifest schema** (`plugin.json`):

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `id` | string | ✅ | Unique plugin id, e.g. `"plugin.my-detector"` (persisted as the `Plugin` row id) |
| `name` | string | ✅ | Human-readable name |
| `version` | string | ✅ | Semver; shown in the plugin registry |
| `type` | string | ✅ | One of `detector` \| `parser` \| `llm_provider` \| `exporter` |
| `modality` | string | — | `text` \| `image` \| `audio` \| `document` (informational) |
| `entry` | string | ✅ | **Relative `.js` path inside the plugin folder.** `..`, absolute paths and non-`.js` entries are rejected |
| `description` | string | — | Shown in `GET /api/v1/plugins` and the dashboard |

Example (from the reference plugin):

```json
{
  "id": "plugin.example-text-detector",
  "name": "Example hedging-phrase detector",
  "version": "1.0.0",
  "type": "detector",
  "modality": "text",
  "entry": "index.js",
  "description": "Reference plugin: counts hedging/cliché openings that often appear in AI-assisted listicles and SEO copy."
}
```

## 2. Registration lifecycle

1. On the first API request after process start, `bootstrap.ts` runs (once per process): builtins → queue worker → **plugins** → model-registry seeding.
2. The loader scans the fixed root `plugins/` (server-side fs only; directories starting with `.` or `_` are skipped — no path traversal).
3. Each `plugin.json` is validated (missing fields / bad type / bad entry ⇒ skipped with a warning log).
4. The entry is loaded with a **runtime dynamic `import()`** of a `file://` URL, annotated `webpackIgnore`/`turbopackIgnore`, so bundlers never touch plugin code and nothing is `eval`ed.
5. The module must export `register(api)`; the loader calls it once. Each `api.*` call is validated (e.g. a detector needs `id` and an `analyze` function).
6. The outcome is persisted to the `Plugin` table (`loaded` / `error` + error message) and a `SystemEvent` is written. `GET /api/v1/plugins` shows every plugin, its status and what it registered.

**Error containment:** any exception inside `register()` or the entry module is caught and recorded — the app starts normally with builtin detectors. Likewise, a detector that throws *during analysis* only fails that detector for that analysis (surfaced as `status: "error"` on its detector run plus an analysis warning).

**Lifecycle limits to know:** plugins load at boot — restart to pick up changes; the entry must be plain ESM `.js` (TypeScript is not compiled for you); a plugin detector/parser whose id collides with a builtin is **skipped with a warning** (builtins always win), so namespace your ids (`text.yourname.…`, `parser.yourname.…`).

## 3. The `PluginApi` object

```ts
interface PluginApi {
  registerDetector(detector: Detector): void;
  registerParser(parser: FileParser): void;
  registerLLMProvider(provider: LLMProvider): void;
  registerExporter(exporter: ReportExporter): void;
}
```

Interfaces live in [`src/lib/aidetective/core/types.ts`](../src/lib/aidetective/core/types.ts) (that file is the normative contract).

---

## 4. Complete example — a detector plugin

The following is a full, working plugin (simplified from the bundled reference plugin):

**`plugins/my-hedging-detector/plugin.json`**

```json
{
  "id": "plugin.my-hedging-detector",
  "name": "My hedging-phrase detector",
  "version": "1.0.0",
  "type": "detector",
  "modality": "text",
  "entry": "index.js",
  "description": "Counts hedging/cliché openings common in AI-assisted SEO copy; quotes each match as evidence."
}
```

**`plugins/my-hedging-detector/index.js`**

```js
const PHRASES = [
  "in this article, we will", "let's dive in", "without further ado",
  "look no further", "the world of", "game-changer",
];

const detector = {
  id: "text.my.hedging",           // namespace it — builtin ids use text.*
  name: "Hedging & SEO openings (my plugin)",
  version: "1.0.0",
  description: "Counts hedging/cliché openings and quotes each occurrence as evidence.",
  modalities: ["text", "document"],
  defaultWeight: 0.35,             // low: demonstration-grade, not high-precision
  limitations: [
    "Demonstration detector — deliberately low weight.",
    "Human copywriters use these openings too.",
  ],

  async analyze(ctx) {
    const text = (ctx.input.text ?? "").toLowerCase();
    if (!text) return { status: "skipped", signals: [], summary: "no text input" };

    const hits = [];
    for (const phrase of PHRASES) {
      let idx = text.indexOf(phrase);
      while (idx !== -1) {
        const start = Math.max(0, idx - 30);
        const example = text.slice(start, idx + phrase.length + 60).replace(/\s+/g, " ").trim();
        hits.push({ phrase, example });
        idx = text.indexOf(phrase, idx + phrase.length);
      }
    }

    if (hits.length === 0) {
      return {
        status: "ok",
        signals: [{
          id: `${detector.id}.none`,
          detectorId: detector.id,
          name: "No hedging/SEO openings found",
          value: 0,
          aiScore: 0.5,              // neutral — absence of the pattern means nothing
          weight: detector.defaultWeight,
          evidence: [],
        }],
        summary: "0 phrase matches",
      };
    }

    const per10k = (hits.length / Math.max(text.split(/\s+/).length, 1)) * 10000;
    return {
      status: "ok",
      signals: [{
        id: `${detector.id}.found`,
        detectorId: detector.id,
        name: "Hedging/SEO openings present",
        value: hits.length,
        unit: "matches",
        aiScore: per10k > 2 ? 0.66 : 0.58,
        weight: detector.defaultWeight,
        evidence: hits.slice(0, 6).map((h) => ({
          kind: "quote",
          label: `Matched: "${h.phrase}"`,
          content: `…${h.example}…`,
        })),
      }],
      summary: `${hits.length} hedging phrase match(es)`,
    };
  },
};

export function register(api) {
  api.registerDetector(detector);
}
```

Signal checklist (all enforced in review):

- `aiScore ∈ [0,1]` with **0.5 = neutral**; `null` when not quantifiable.
- `evidence[]` items are `{kind: "quote"|"statistic"|"metadata"|"observation", label, content}` — quote sparingly (the orchestrator trims evidence when compacting for the LLM).
- `weight` should reflect *relative importance inside the modality*; the scoring engine clamps it to `[0,1]` and users can override per detector id.
- Return `status: "skipped"` (with a `summary`) when the input cannot support the measurement.

## 5. Example — a parser plugin

Add a new input format (here: a fictional `.mydoc` plain-text container):

```js
/** plugins/my-doc-parser/plugin.json → {"type":"parser","entry":"index.js", …} */
const parser = {
  id: "parser.mydoc",
  name: "MyDoc text extractor",
  description: "Extracts UTF-8 text from .mydoc containers (toy format: 'mydoc1' header + payload).",
  extensions: ["mydoc"],
  mimeTypes: ["application/x-mydoc"],
  outputKinds: ["text"],

  canParse({ ext, detected }) {
    return ext === "mydoc" || detected.mime === "application/x-mydoc";
  },

  async parse(buffer, info) {
    const text = buffer.toString("utf8").replace(/^mydoc1\n/, "");
    if (text.replace(/\s/g, "").length < 20) {
      return {
        kind: "text", text,
        meta: { parser: "parser.mydoc" },
        warnings: ["MYDOC contained almost no extractable text."],
      };
    }
    return { kind: "text", text, meta: { parser: "parser.mydoc", declaredFormat: info.ext } };
  },
};

export function register(api) {
  api.registerParser(parser);
}
```

Notes: `canParse` receives both the sanitized extension and the **magic-byte-detected** type; content always wins over names. Document-ish formats should return `kind: "document"` with `text` (they then run through the text detectors); image/audio formats return the validated `buffer` passthrough with `kind: "image" | "audio"` plus honest metadata.

## 6. Example — a report exporter plugin

Exporters receive the full `AnalysisDetail` and must return a **string** (stored in the `Report` table):

```js
/** plugins/my-md-report/plugin.json → {"type":"exporter","entry":"index.js", …} */
const exporter = {
  id: "report.md",
  label: "Markdown report",
  format: "md",
  fileExt: "md",
  mimeType: "text/markdown",

  async export(analysis) {
    const lines = [
      `# AIDetective report`,
      ``,
      `> ⚠️ Probabilistic analysis — NOT proof. False positives/negatives are possible.`,
      ``,
      `- Analysis: \`${analysis.id}\` (${analysis.modality}, ${analysis.status})`,
      `- Classification: **${analysis.classification ?? "n/a"}**`,
      `- Likelihood score: ${analysis.likelihoodScore ?? "n/a"} · Confidence: ${analysis.confidence ?? "n/a"}`,
      ``,
      `## Signals`,
      ...analysis.signals.map((s) =>
        `- \`${s.signalKey}\` — aiScore ${s.aiScore ?? "n/a"}, weight ${s.weight} (${s.direction})`
      ),
    ];
    return lines.join("\n");
  },
};

export function register(api) {
  api.registerExporter(exporter);
}
```

(The built-in exporters are `report.json` and `report.html`; a PDF exporter is a roadmap item — this interface is exactly where it lands.)

## 7. Verifying your plugin

```bash
# 1. restart the dev server, then:
curl -s http://localhost:3000/api/v1/plugins | jq '.data'
# → your plugin with status "loaded" and registered.detectors=["text.my.hedging"]

# 2. confirm it appears in the detector registry:
curl -s http://localhost:3000/api/v1/detectors | jq '.data[] | select(.id=="text.my.hedging")'

# 3. analyze something:
curl -s http://localhost:3000/api/v1/analyze \
  -H "Content-Type: application/json" \
  -d '{"content":"In this article, we will dive in. Let'"'"'s dive in!"}' | jq '.data.detectorRuns[] | select(.detectorId=="text.my.hedging")'
```

If the plugin shows `status: "error"`, the `error` field contains the thrown message (also persisted to the `Plugin` table and `SystemEvent`s). Fix and restart — nothing else can break.

## 8. Packaging & submission checklist

- [ ] `plugin.json` validates (correct `type`, relative `.js` entry, unique namespaced ids).
- [ ] `register(api)` is exported; every registration is well-formed.
- [ ] Detector ships `limitations` and returns `skipped` / `aiScore: null` where honest.
- [ ] No network calls from detectors without a documented timeout; no secrets in code.
- [ ] README for your plugin: what it measures, what it does NOT, failure modes.
- [ ] Verified via `GET /api/v1/plugins` (status `loaded`) and one end-to-end analysis.

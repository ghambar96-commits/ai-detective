/**
 * AIDetective example plugin — detector type.
 *
 * Contract: the entry file must export a `register(api)` function.
 * The full PluginApi (registerDetector, registerParser, registerLLMProvider,
 * registerExporter) is documented in docs/plugins.md.
 *
 * This detector is REAL and deterministic: it counts SEO/hedging openings
 * that frequently appear in AI-assisted marketing copy, and reports them as
 * quoted evidence. Its weight is deliberately low: it is a demonstration,
 * not a high-precision detector.
 */
const PHRASES = [
  "in this article, we will", "in this post, we will", "in this guide, we will",
  "let's dive in", "let's dive into", "without further ado", "buckle up",
  "in this comprehensive guide", "whether you're a", "look no further",
  "the world of", "when it comes to choosing", "game-changer",
];

const detector = {
  id: "text.example.hedging",
  name: "Hedging & SEO openings (example plugin)",
  version: "1.0.0",
  description:
    "Example plugin detector: counts hedging/cliché openings common in AI-assisted listicles and SEO copy, quoting each occurrence as evidence.",
  modalities: ["text", "document"],
  defaultWeight: 0.35,
  limitations: [
    "This is a reference plugin demonstrating the contract — deliberately low weight.",
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
        const example = text.slice(start, Math.min(text.length, idx + phrase.length + 60)).replace(/\s+/g, " ").trim();
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
          description: detector.description,
          value: 0,
          aiScore: 0.5,
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
        description: detector.description,
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

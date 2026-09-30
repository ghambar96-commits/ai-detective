/**
 * Detector: text.connectives
 * Density of formal discourse connectives ("furthermore", "moreover",
 * "بنابراین", "علاوه بر این"), especially at sentence starts — typical of
 * model-generated structured prose.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { TextFeatures } from "../../features/text-features";

export const connectivesDetector: Detector = {
  id: "text.connectives",
  name: "Formal connective density",
  version: "1.0.0",
  description:
    "Measures how often formal discourse connectives appear, in total and at sentence starts. High density matches the structured style of LLM prose.",
  modalities: ["text", "document"],
  defaultWeight: 0.5,
  limitations: ["Academic and legal human writing legitimately uses many connectives."],

  async analyze(ctx: DetectorContext) {
    const f = ctx.features.textFeatures as TextFeatures | undefined;
    if (!f || f.sentenceCount < 5) {
      return { status: "skipped" as const, signals: [], summary: "Not enough sentences for connective analysis" };
    }
    const c = f.connectives;
    const starterRatio = f.sentenceCount ? c.sentenceStarters / f.sentenceCount : 0;
    const evidence: EvidenceItem[] = [
      {
        kind: "statistic",
        label: "Connective statistics",
        content: `${c.count} sentences containing formal connectives · ${c.sentenceStarters} sentences START with one (${Math.round(starterRatio * 100)}%)`,
        meta: { count: c.count, starters: c.sentenceStarters, sentences: f.sentenceCount, perSentence: c.perSentence },
      },
    ];

    let aiScore: number;
    let name: string;
    if (c.perSentence > 0.45) {
      aiScore = 0.7;
      name = "Very dense formal connectives";
    } else if (c.perSentence > 0.28) {
      aiScore = 0.62;
      name = "Elevated formal connective density";
    } else if (c.perSentence < 0.08) {
      aiScore = 0.44;
      name = "Sparse connective usage";
    } else {
      aiScore = 0.5;
      name = "Typical connective density";
    }

    const signal: Signal = {
      id: `${this.id}.${c.perSentence > 0.28 ? "high" : c.perSentence < 0.08 ? "low" : "typical"}`,
      detectorId: this.id,
      name,
      description: this.description,
      value: c.perSentence,
      unit: "per-sentence",
      aiScore,
      weight: this.defaultWeight,
      evidence,
    };
    return { status: "ok" as const, signals: [signal], summary: `${c.perSentence} connectives/sentence, ${Math.round(starterRatio * 100)}% starters` };
  },
};

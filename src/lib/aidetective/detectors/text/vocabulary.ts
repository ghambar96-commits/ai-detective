/**
 * Detector: text.vocabulary
 * Lexical richness: type-token ratio, hapax ratio. Very low diversity in a
 * reasonably long text can indicate generated content; high diversity leans human.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { TextFeatures } from "../../features/text-features";

export const vocabularyDetector: Detector = {
  id: "text.vocabulary",
  name: "Vocabulary diversity",
  version: "1.0.0",
  description:
    "Measures lexical richness (unique/total word ratio, hapax legomena share, normalized entropy). Generated text often reuses a limited, safe vocabulary.",
  modalities: ["text", "document"],
  defaultWeight: 0.55,
  limitations: [
    "TTR naturally decreases with text length; use with the root-TTR value.",
    "Topic-specific jargon can lower diversity for human authors too.",
  ],

  async analyze(ctx: DetectorContext) {
    const f = ctx.features.textFeatures as TextFeatures | undefined;
    if (!f || f.wordCount < 25) {
      return { status: "skipped" as const, signals: [], summary: "Text too short for vocabulary statistics" };
    }
    const v = f.vocabulary;
    const evidence: EvidenceItem[] = [
      {
        kind: "statistic",
        label: "Lexical statistics",
        content: `${f.wordCount} words · ${v.unique} unique · TTR ${v.ttr} · root-TTR ${v.rootTtr} · hapax ratio ${v.hapaxRatio} · normalized entropy ${v.entropyNorm}`,
        meta: { words: f.wordCount, unique: v.unique, ttr: v.ttr, rootTtr: v.rootTtr, hapaxRatio: v.hapaxRatio, entropyNorm: v.entropyNorm },
      },
    ];

    // Root TTR ~6-8 is typical prose; very low values indicate repetition/flatness.
    let aiScore: number;
    let name: string;
    if (v.rootTtr < 4.5) {
      aiScore = 0.68;
      name = "Low vocabulary richness";
    } else if (v.rootTtr < 5.5) {
      aiScore = 0.58;
      name = "Below-average vocabulary richness";
    } else if (v.rootTtr > 8.5) {
      aiScore = 0.38;
      name = "Highly varied vocabulary";
    } else {
      aiScore = 0.5;
      name = "Typical vocabulary richness";
    }

    const signal: Signal = {
      id: `${this.id}.${v.rootTtr < 5.5 ? "low" : v.rootTtr > 8.5 ? "high" : "typical"}`,
      detectorId: this.id,
      name,
      description: this.description,
      value: v.rootTtr,
      unit: "root-ttr",
      aiScore,
      weight: this.defaultWeight,
      evidence,
      notes: f.wordCount < 120 ? `Short text (${f.wordCount} words) — diversity estimates are noisy.` : undefined,
    };
    return { status: "ok" as const, signals: [signal], summary: `Root-TTR ${v.rootTtr}, hapax ${v.hapaxRatio}` };
  },
};

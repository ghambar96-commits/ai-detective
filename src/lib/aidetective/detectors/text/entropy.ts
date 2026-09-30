/**
 * Detector: text.lexical_entropy
 * Normalized Shannon entropy of the word distribution. Extremely flat,
 * predictable word usage leans AI; extremely rich usage leans human.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { TextFeatures } from "../../features/text-features";

export const entropyDetector: Detector = {
  id: "text.lexical_entropy",
  name: "Lexical entropy",
  version: "1.0.0",
  description:
    "Shannon entropy of the word-frequency distribution, normalized to [0,1]. Probes how predictable the vocabulary usage is overall.",
  modalities: ["text", "document"],
  defaultWeight: 0.4,
  limitations: [
    "A weak, correlational signal on its own — weight is intentionally low.",
    "Sensitivity to text length and topic jargon.",
  ],

  async analyze(ctx: DetectorContext) {
    const f = ctx.features.textFeatures as TextFeatures | undefined;
    if (!f || f.wordCount < 100) {
      return { status: "skipped" as const, signals: [], summary: "Text too short for entropy statistics" };
    }
    const e = f.vocabulary.entropyNorm;
    const evidence: EvidenceItem[] = [
      {
        kind: "statistic",
        label: "Entropy",
        content: `normalized entropy ${e} over ${f.vocabulary.unique} unique words (${f.wordCount} total)`,
        meta: { entropyNorm: e, unique: f.vocabulary.unique, words: f.wordCount },
      },
    ];

    let aiScore: number;
    let name: string;
    if (e < 0.62) {
      aiScore = 0.66;
      name = "Low lexical entropy (predictable word usage)";
    } else if (e < 0.72) {
      aiScore = 0.58;
      name = "Below-average lexical entropy";
    } else if (e > 0.88) {
      aiScore = 0.4;
      name = "High lexical entropy (varied word usage)";
    } else {
      aiScore = 0.5;
      name = "Typical lexical entropy";
    }

    const signal: Signal = {
      id: `${this.id}.${e < 0.72 ? "low" : e > 0.88 ? "high" : "typical"}`,
      detectorId: this.id,
      name,
      description: this.description,
      value: e,
      unit: "norm-entropy",
      aiScore,
      weight: this.defaultWeight,
      evidence,
    };
    return { status: "ok" as const, signals: [signal], summary: `normalized entropy ${e}` };
  },
};

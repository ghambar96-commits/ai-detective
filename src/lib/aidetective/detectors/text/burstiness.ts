/**
 * Detector: text.burstiness
 * Measures variance of sentence lengths. LLM output tends to be "flat"
 * (uniform sentence rhythm); human writing bursts between short and long.
 * This is a probabilistic stylistic signal — NOT proof.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { TextFeatures } from "../../features/text-features";

export const burstinessDetector: Detector = {
  id: "text.burstiness",
  name: "Sentence-length burstiness",
  version: "1.0.0",
  description:
    "Compares the variability of sentence lengths against values typical of generated text. Low variability (flat rhythm) leans AI; high variability leans human.",
  modalities: ["text", "document"],
  defaultWeight: 0.8,
  limitations: [
    "Formal human prose (legal, academic) can also have low burstiness.",
    "Requires at least ~8 sentences to be meaningful; short texts are flagged as unreliable.",
  ],

  async analyze(ctx: DetectorContext) {
    const f = ctx.features.textFeatures as TextFeatures | undefined;
    if (!f || f.sentenceCount === 0) {
      return { status: "skipped" as const, signals: [], summary: "No sentences to measure" };
    }
    const cv = f.sentenceLengths.cv;
    const reliable = f.sentenceCount >= 8;
    const evidence: EvidenceItem[] = [
      {
        kind: "statistic",
        label: "Sentence length distribution",
        content: `${f.sentenceCount} sentences · mean ${f.sentenceLengths.mean} words · std ${f.sentenceLengths.std} · coefficient of variation ${cv}`,
        meta: { mean: f.sentenceLengths.mean, std: f.sentenceLengths.std, cv, sentences: f.sentenceCount },
      },
      {
        kind: "statistic",
        label: "Length buckets (1-5 / 6-10 / 11-15 / 16-20 / 21-30 / 31+ words)",
        content: f.sentenceLengths.buckets.join(" / "),
        meta: { buckets: f.sentenceLengths.buckets.join(",") },
      },
    ];

    let aiScore: number;
    let name: string;
    if (cv < 0.3) {
      aiScore = 0.78;
      name = "Very uniform sentence rhythm";
    } else if (cv < 0.45) {
      aiScore = 0.64;
      name = "Low sentence-length variability";
    } else if (cv < 0.65) {
      aiScore = 0.5;
      name = "Moderate sentence-length variability";
    } else if (cv < 0.9) {
      aiScore = 0.35;
      name = "High sentence-length variability";
    } else {
      aiScore = 0.22;
      name = "Very irregular, bursty rhythm";
    }

    const notes = reliable
      ? undefined
      : `Only ${f.sentenceCount} sentences — this signal is unreliable for such a short text.`;

    const signal: Signal = {
      id: `${this.id}.${cv < 0.45 ? "low_variance" : cv < 0.65 ? "moderate" : "high_variance"}`,
      detectorId: this.id,
      name,
      description: this.description,
      value: cv,
      unit: "cv",
      aiScore,
      weight: this.defaultWeight,
      evidence,
      notes,
    };
    return {
      status: "ok" as const,
      signals: [signal],
      summary: `Sentence-length CV = ${cv} (${f.sentenceCount} sentences)`,
    };
  },
};

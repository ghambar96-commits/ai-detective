/**
 * Detector: text.repetition
 * n-gram repetition. Models sometimes loop or recycle phrases; human writing
 * repeats content words but rarely repeats long exact sequences.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { TextFeatures } from "../../features/text-features";

export const repetitionDetector: Detector = {
  id: "text.repetition",
  name: "n-gram repetition",
  version: "1.0.0",
  description: "Detects repeated 4-word sequences (exact match). High exact repetition can indicate generation artifacts or duplicated content.",
  modalities: ["text", "document"],
  defaultWeight: 0.5,
  limitations: ["Deliberate repetition (choruses, legal boilerplate, UI copy) is normal in some texts."],

  async analyze(ctx: DetectorContext) {
    const f = ctx.features.textFeatures as TextFeatures | undefined;
    if (!f || f.wordCount < 60) {
      return { status: "skipped" as const, signals: [], summary: "Text too short for n-gram repetition analysis" };
    }
    const r = f.repetition;
    const evidence: EvidenceItem[] = [];
    if (r.topRepeated.length > 0) {
      for (const t of r.topRepeated.slice(0, 3)) {
        evidence.push({ kind: "quote", label: `Repeated ×${t.count}`, content: `"${t.ngram}"` });
      }
    }
    evidence.push({
      kind: "statistic",
      label: "Repetition statistics",
      content: `${r.repeatedQuadgrams} repeated 4-grams · max frequency ${r.maxQuadgramFreq}`,
      meta: { repeatedQuadgrams: r.repeatedQuadgrams, maxFreq: r.maxQuadgramFreq },
    });

    let aiScore: number;
    let name: string;
    if (r.repeatedQuadgrams >= 5) {
      aiScore = 0.72;
      name = "Elevated exact repetition";
    } else if (r.repeatedQuadgrams >= 1) {
      aiScore = 0.56;
      name = "Minor exact repetition";
    } else {
      aiScore = 0.48;
      name = "No significant exact repetition";
    }

    const signal: Signal = {
      id: `${this.id}.${r.repeatedQuadgrams >= 5 ? "high" : r.repeatedQuadgrams >= 1 ? "low" : "none"}`,
      detectorId: this.id,
      name,
      description: this.description,
      value: r.repeatedQuadgrams,
      unit: "repeated-4grams",
      aiScore,
      weight: this.defaultWeight,
      evidence,
    };
    return { status: "ok" as const, signals: [signal], summary: `${r.repeatedQuadgrams} repeated 4-grams` };
  },
};

/**
 * Detector: text.punctuation
 * Punctuation profile: LLM output tends towards uniform, conservative
 * punctuation (few exclamations, occasional em-dash overuse), while human
 * writing shows more irregular punctuation habits.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { TextFeatures } from "../../features/text-features";

export const punctuationDetector: Detector = {
  id: "text.punctuation",
  name: "Punctuation profile",
  version: "1.0.0",
  description:
    "Analyses punctuation habits: exclamation/question usage, em-dash density, ellipses, repeated punctuation, comma regularity.",
  modalities: ["text", "document"],
  defaultWeight: 0.5,
  limitations: [
    "Punctuation style varies strongly by genre, language and personality.",
    "Copy-edited human text can look 'too clean'.",
  ],

  async analyze(ctx: DetectorContext) {
    const f = ctx.features.textFeatures as TextFeatures | undefined;
    if (!f || f.sentenceCount < 3) {
      return { status: "skipped" as const, signals: [], summary: "Not enough sentences for punctuation profile" };
    }
    const p = f.punctuation;
    const votes: Array<{ note: string; score: number; w: number }> = [];

    // Exclamation / question presence — mild human indicator in prose
    if (p.exclaimPerSentence > 0.05 || p.questionPerSentence > 0.08) {
      votes.push({ note: "exclamations/questions present", score: 0.42, w: 0.7 });
    }
    // Em-dash overuse — known LLM tell
    if (p.per1k.emDash > 1.5) votes.push({ note: "heavy em-dash usage", score: 0.72, w: 0.8 });
    else if (p.per1k.emDash > 0.6) votes.push({ note: "moderate em-dash usage", score: 0.6, w: 0.5 });
    // Ellipses & repeated punctuation — human-ish
    if (p.ellipsisCount >= 2 || p.multiPunctCount >= 2) {
      votes.push({ note: "ellipses or repeated punctuation (?!/!!!/…)", score: 0.35, w: 0.7 });
    }
    // Perfectly uniform comma cadence
    if (f.sentenceCount >= 10 && Math.abs(p.commaPerSentence - 1) < 0.08 && p.commaPerSentence > 0.4) {
      votes.push({ note: "suspiciously uniform comma rate across sentences", score: 0.63, w: 0.6 });
    }

    const evidence: EvidenceItem[] = [
      {
        kind: "statistic",
        label: "Punctuation per 1k words",
        content: Object.entries(p.per1k)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · "),
        meta: p.per1k as Record<string, number>,
      },
      {
        kind: "statistic",
        label: "Per sentence",
        content: `commas ${p.commaPerSentence} · exclamations ${p.exclaimPerSentence} · questions ${p.questionPerSentence}`,
      },
    ];

    if (votes.length === 0) {
      const signal: Signal = {
        id: `${this.id}.neutral`,
        detectorId: this.id,
        name: "Unremarkable punctuation profile",
        description: this.description,
        value: p.commaPerSentence,
        unit: "comma/sentence",
        aiScore: 0.5,
        weight: this.defaultWeight * 0.4,
        evidence,
      };
      return { status: "ok" as const, signals: [signal], summary: "No punctuation pattern stood out" };
    }

    const totalW = votes.reduce((a, v) => a + v.w, 0);
    const aiScore = votes.reduce((a, v) => a + v.score * v.w, 0) / totalW;
    evidence.push({
      kind: "observation",
      label: "Observations",
      content: votes.map((v) => `• ${v.note}`).join("\n"),
    });

    const signal: Signal = {
      id: `${this.id}.${aiScore >= 0.55 ? "ai_leaning" : aiScore <= 0.45 ? "human_leaning" : "mixed"}`,
      detectorId: this.id,
      name: aiScore >= 0.55 ? "AI-leaning punctuation habits" : aiScore <= 0.45 ? "Human-leaning punctuation habits" : "Mixed punctuation habits",
      description: this.description,
      value: Math.round(aiScore * 100) / 100,
      unit: "index",
      aiScore,
      weight: this.defaultWeight,
      evidence,
    };
    return { status: "ok" as const, signals: [signal], summary: `${votes.length} punctuation observation(s)` };
  },
};

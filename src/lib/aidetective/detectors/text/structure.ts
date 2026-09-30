/**
 * Detector: text.structure
 * Structural regularity: paragraph length uniformity, capitalization and
 * terminal punctuation discipline. LLM output is often "too tidy".
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { TextFeatures } from "../../features/text-features";

export const structureDetector: Detector = {
  id: "text.structure",
  name: "Structural regularity",
  version: "1.0.0",
  description:
    "Checks how 'tidy' the text structure is: uniform paragraph sizes, every sentence capitalized and perfectly terminated, list-like scaffolding.",
  modalities: ["text", "document"],
  defaultWeight: 0.6,
  limitations: [
    "Professional editors produce tidy human text as well.",
    "Extracted documents (PDF/DOCX) can lose formatting, biasing paragraph statistics.",
  ],

  async analyze(ctx: DetectorContext) {
    const f = ctx.features.textFeatures as TextFeatures | undefined;
    if (!f || f.sentenceCount < 4) {
      return { status: "skipped" as const, signals: [], summary: "Not enough sentences for structural analysis" };
    }
    const evidence: EvidenceItem[] = [
      {
        kind: "statistic",
        label: "Structure statistics",
        content: `${f.paragraphCount} paragraphs · paragraph length CV ${f.paragraphLengths.cv} · sentences starting with capital: ${Math.round(f.casing.startsCapitalRatio * 100)}% · properly terminated: ${Math.round(f.casing.endsPunctRatio * 100)}%`,
        meta: {
          paragraphs: f.paragraphCount,
          paraCv: f.paragraphLengths.cv,
          startsCapitalRatio: f.casing.startsCapitalRatio,
          endsPunctRatio: f.casing.endsPunctRatio,
        },
      },
    ];

    const tidy = f.casing.startsCapitalRatio >= 0.95 && f.casing.endsPunctRatio >= 0.95;
    const uniformParagraphs = f.paragraphCount >= 3 && f.paragraphLengths.cv < 0.18;
    const messy = f.casing.startsCapitalRatio < 0.7 || f.paragraphLengths.cv > 0.8;

    let aiScore: number;
    let name: string;
    if (tidy && uniformParagraphs) {
      aiScore = 0.7;
      name = "Highly regular structure";
    } else if (tidy) {
      aiScore = 0.62;
      name = "Tidy capitalization and termination throughout";
    } else if (messy) {
      aiScore = 0.36;
      name = "Irregular, human-like structure";
    } else {
      aiScore = 0.5;
      name = "Ordinary structural profile";
    }

    const signal: Signal = {
      id: `${this.id}.${aiScore >= 0.6 ? "regular" : aiScore <= 0.4 ? "irregular" : "ordinary"}`,
      detectorId: this.id,
      name,
      description: this.description,
      value: f.paragraphLengths.cv,
      unit: "para-cv",
      aiScore,
      weight: this.defaultWeight,
      evidence,
    };
    return { status: "ok" as const, signals: [signal], summary: `Paragraph CV ${f.paragraphLengths.cv}, tidy=${tidy}` };
  },
};

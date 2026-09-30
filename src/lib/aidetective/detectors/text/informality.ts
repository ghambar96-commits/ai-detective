/**
 * Detector: text.informality
 * Human-tell markers: contractions, informal words, emoji, elongations,
 * ALL-CAPS. Their absence in casual-register text is a mild AI indicator.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { TextFeatures } from "../../features/text-features";

export const informalityDetector: Detector = {
  id: "text.informality",
  name: "Informality & human-tell markers",
  version: "1.0.0",
  description:
    "Looks for contractions (don't, I'm), informal vocabulary (lol, btw), emoji, letter elongation and ALL-CAPS — markers typical of human informal writing.",
  modalities: ["text", "document"],
  defaultWeight: 0.55,
  limitations: [
    "Formal human writing (reports, essays) legitimately lacks all of these markers.",
    "English contraction detection; Persian has no direct equivalent (experimental).",
  ],

  async analyze(ctx: DetectorContext) {
    const f = ctx.features.textFeatures as TextFeatures | undefined;
    if (!f || f.wordCount < 40) {
      return { status: "skipped" as const, signals: [], summary: "Text too short for informality analysis" };
    }
    const i = f.informality;
    const totalHumanish = i.contractionCount + i.informalHits + i.emojiCount + i.elongations + i.allCapsWords;
    const evidence: EvidenceItem[] = [
      {
        kind: "statistic",
        label: "Human-tell markers",
        content: `contractions: ${i.contractionCount} · informal words: ${i.informalHits} · emoji: ${i.emojiCount} · elongations (sooo): ${i.elongations} · ALL-CAPS words: ${i.allCapsWords}`,
        meta: { ...i },
      },
    ];

    let aiScore: number;
    let name: string;
    if (totalHumanish >= 4) {
      aiScore = 0.28;
      name = "Strong human informal markers";
    } else if (totalHumanish >= 1) {
      aiScore = 0.42;
      name = "Some informal human markers";
    } else if (f.wordCount >= 250) {
      aiScore = 0.58;
      name = "No informal markers in a long text (mild AI indicator)";
    } else {
      aiScore = 0.5;
      name = "No informal markers (short text — neutral)";
    }

    const signal: Signal = {
      id: `${this.id}.${totalHumanish >= 4 ? "present" : totalHumanish >= 1 ? "few" : "none"}`,
      detectorId: this.id,
      name,
      description: this.description,
      value: totalHumanish,
      unit: "markers",
      aiScore,
      weight: this.defaultWeight,
      evidence,
    };
    return { status: "ok" as const, signals: [signal], summary: `${totalHumanish} human-tell marker(s)` };
  },
};

/**
 * Detector: text.phrases
 * Frequency of phrase patterns strongly/weakly associated with LLM output
 * (English + experimental Persian list). Includes quoted evidence.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { TextFeatures } from "../../features/text-features";

export const phrasesDetector: Detector = {
  id: "text.phrases",
  name: "AI-associated phrase patterns",
  version: "1.1.0",
  description:
    "Counts occurrences of phrases that are over-represented in LLM output (e.g. 'delve into', 'plays a crucial role', 'in today's world', 'به عنوان یک هوش مصنوعی'). Strong matches are quoted as evidence.",
  modalities: ["text", "document"],
  defaultWeight: 0.85,
  limitations: [
    "Humans use these phrases too — frequency matters, single occurrences are weak evidence.",
    "The Persian phrase list is experimental and smaller than the English one.",
    "Absence of these phrases does NOT mean the text is human-written.",
  ],

  async analyze(ctx: DetectorContext) {
    const f = ctx.features.textFeatures as TextFeatures | undefined;
    if (!f || f.wordCount < 20) {
      return { status: "skipped" as const, signals: [], summary: "Text too short for phrase statistics" };
    }
    const evidence: EvidenceItem[] = [];
    for (const hit of f.phrases.strongHits) {
      evidence.push({ kind: "quote", label: `Matched phrase: "${hit.phrase}"`, content: hit.example });
    }
    evidence.push({
      kind: "statistic",
      label: "Phrase frequency",
      content: `Strong matches: ${f.phrases.strongCount} (${f.phrases.strongPer1k} per 1k words) · Weak matches: ${f.phrases.weakCount} (${f.phrases.weakPer1k} per 1k words)`,
      meta: { strongCount: f.phrases.strongCount, strongPer1k: f.phrases.strongPer1k, weakCount: f.phrases.weakCount, weakPer1k: f.phrases.weakPer1k },
    });

    const density = f.phrases.strongPer1k;
    let aiScore: number;
    let name: string;
    if (density >= 3) {
      aiScore = 0.88;
      name = "Dense AI-associated phrasing";
    } else if (density >= 1.2) {
      aiScore = 0.74;
      name = "Frequent AI-associated phrasing";
    } else if (density > 0) {
      aiScore = 0.6;
      name = "Some AI-associated phrasing";
    } else if (f.wordCount >= 300) {
      aiScore = 0.4;
      name = "No AI-associated phrases found";
    } else {
      aiScore = 0.5;
      name = "No AI-associated phrases (short text — weak signal)";
    }

    const signal: Signal = {
      id: `${this.id}.${density >= 1.2 ? "high_density" : density > 0 ? "present" : "absent"}`,
      detectorId: this.id,
      name,
      description: this.description,
      value: density,
      unit: "per-1k-words",
      aiScore,
      weight: this.defaultWeight,
      evidence,
      notes: "Phrase lists cover English fully; Persian support is experimental.",
    };
    return {
      status: "ok" as const,
      signals: [signal],
      summary: `${f.phrases.strongCount} strong / ${f.phrases.weakCount} weak phrase matches`,
    };
  },
};

/**
 * AIDetective — Scoring Engine.
 *
 * Combines raw detector signals into:
 *   score          → weighted likelihood that AI was involved (0..1)
 *   confidence     → capped estimate of how much to trust the score (never 1.0)
 *   classification → one of the allowed classifications, incl. uncertain/inconclusive
 *
 * Design rules:
 *  - Deterministic and explainable: every contribution is listed in `breakdown`.
 *  - Detector weights are configurable (per detectorId overrides).
 *  - Conflicting signals lower confidence and can force `uncertain`.
 *  - Few/no usable signals → `uncertain` or `inconclusive` (valid outcomes!).
 *  - The score is a probability estimate, NEVER proof.
 */
import type {
  Classification,
  Modality,
  ScoreBreakdownEntry,
  ScoreOutcome,
  ScoringConfig,
  Signal,
} from "./types";

export const DEFAULT_SCORING: ScoringConfig = {
  weights: {},
  aiThreshold: 0.62,
  humanThreshold: 0.42,
  minSignals: 2,
  maxConfidence: 0.92,
};

/** Modality-aware label for a positive AI verdict. */
export function aiClassificationFor(modality: Modality): Classification {
  // Documents are analysed via their extracted text → same label as text.
  return modality === "image" || modality === "audio" ? "likely_synthetic" : "likely_ai_generated";
}

function effectiveWeight(signal: Signal, cfg: ScoringConfig): number {
  const override = cfg.weights[signal.detectorId];
  const w = typeof override === "number" ? override : signal.weight;
  return Math.min(Math.max(w, 0), 1);
}

export function scoreAnalysis(
  signals: Signal[],
  modality: Modality,
  partial?: Partial<ScoringConfig>
): ScoreOutcome {
  const cfg: ScoringConfig = { ...DEFAULT_SCORING, ...partial };
  const usable = signals.filter(
    (s) => s.aiScore !== null && s.aiScore !== undefined && effectiveWeight(s, cfg) > 0
  );

  if (usable.length === 0) {
    return {
      score: null,
      confidence: 0,
      classification: "inconclusive",
      consistency: 0,
      usableSignals: 0,
      breakdown: [],
    };
  }

  const breakdown: ScoreBreakdownEntry[] = [];
  let weightedSum = 0; // Σ vote*weight, vote ∈ [-1, 1]
  let totalWeight = 0;

  for (const s of usable) {
    const w = effectiveWeight(s, cfg);
    const vote = (s.aiScore as number) * 2 - 1; // -1 human … +1 AI
    const contribution = vote * w;
    weightedSum += contribution;
    totalWeight += w;
    breakdown.push({
      signalId: s.id,
      detectorId: s.detectorId,
      weight: w,
      aiScore: s.aiScore as number,
      contribution,
    });
  }

  const polarity = totalWeight > 0 ? weightedSum / totalWeight : 0; // -1..1
  const score = Math.min(Math.max((polarity + 1) / 2, 0), 1);

  // Direction consistency vs. strength, measured over ACTIVE signals (|vote| > 0.1):
  //  - consistency: of the expressed strength, how much points one way (0..1)
  //  - strength:    average distance from neutral, weighted (0..1)
  // Neutral signals do not dilute either measure.
  let activeWeightedSum = 0;
  let activeAbsWeighted = 0;
  let activeTotalWeight = 0;
  for (const entry of breakdown) {
    const vote = entry.aiScore * 2 - 1;
    if (Math.abs(vote) <= 0.1) continue;
    activeWeightedSum += entry.contribution;
    activeAbsWeighted += Math.abs(vote) * entry.weight;
    activeTotalWeight += entry.weight;
  }
  const consistency =
    activeAbsWeighted > 0 ? Math.min(Math.abs(activeWeightedSum) / activeAbsWeighted, 1) : 0;
  const strength = activeTotalWeight > 0 ? Math.min(activeAbsWeighted / activeTotalWeight, 1) : 0;

  // Confidence grows with consistency, strength, signal count and weight — capped hard.
  const countFactor = Math.min(usable.length / 4, 1);
  const weightFactor = Math.min(totalWeight / 5, 1);
  let confidence = 0.25 + 0.35 * consistency + 0.2 * strength + 0.1 * countFactor + 0.1 * weightFactor;
  confidence = Math.min(Math.max(confidence, 0), Math.min(cfg.maxConfidence, 0.99));

  // ── Classification decision ────────────────────────────────────────────────
  let classification: Classification;
  const conflicting = consistency < 0.35;
  const tooFew = usable.length < cfg.minSignals;
  const tooWeak = confidence < 0.3;

  if (tooFew || conflicting || tooWeak) {
    classification = "uncertain";
  } else if (score >= cfg.aiThreshold) {
    classification = aiClassificationFor(modality);
  } else if (score <= cfg.humanThreshold) {
    classification = "likely_human";
  } else {
    classification = "uncertain";
  }

  breakdown.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return {
    score,
    confidence,
    classification,
    consistency,
    usableSignals: usable.length,
    breakdown,
  };
}

export function confidenceLabel(confidence: number | null): string {
  if (confidence === null) return "none";
  if (confidence < 0.35) return "very low";
  if (confidence < 0.55) return "low";
  if (confidence < 0.75) return "moderate";
  return "high (never absolute)";
}

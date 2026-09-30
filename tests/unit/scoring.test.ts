/**
 * Unit tests — Scoring Engine (core/scoring.ts).
 * Deterministic, explainable, capped confidence; uncertain/inconclusive are
 * first-class outcomes.
 */
import { describe, test, expect } from "bun:test";
import { aiClassificationFor, confidenceLabel, scoreAnalysis, DEFAULT_SCORING } from "@/lib/aidetective/core/scoring";
import type { Modality, Signal } from "@/lib/aidetective/core/types";

function sig(detectorId: string, aiScore: number | null, weight = 0.5, id?: string): Signal {
  return {
    id: id ?? `${detectorId}.s1`,
    detectorId,
    name: `signal ${detectorId}`,
    aiScore,
    weight,
    evidence: [],
  };
}

describe("scoring: outcomes", () => {
  test("no usable signals → inconclusive with null score", () => {
    const out = scoreAnalysis([], "text");
    expect(out.score).toBeNull();
    expect(out.classification).toBe("inconclusive");
    expect(out.confidence).toBe(0);
    expect(out.usableSignals).toBe(0);
    expect(out.breakdown).toEqual([]);
  });

  test("null-aiScore signals are excluded, not treated as 0", () => {
    const out = scoreAnalysis([sig("d1", null), sig("d2", null)], "text");
    expect(out.classification).toBe("inconclusive");
    expect(out.score).toBeNull();
  });

  test("fewer than minSignals → uncertain even if unanimous", () => {
    const out = scoreAnalysis([sig("d1", 0.95, 1.0)], "text");
    expect(out.classification).toBe("uncertain");
  });

  test("zero-weight signals are excluded", () => {
    const out = scoreAnalysis([sig("d1", 0.9, 0), sig("d2", 0.9, 0)], "text");
    expect(out.classification).toBe("inconclusive");
  });
});

describe("scoring: classification thresholds", () => {
  const strongAi = [
    sig("d1", 0.9, 0.8),
    sig("d2", 0.85, 0.7),
    sig("d3", 0.88, 0.9),
  ];
  const strongHuman = [
    sig("d1", 0.1, 0.8),
    sig("d2", 0.15, 0.7),
    sig("d3", 0.12, 0.9),
  ];
  const middle = [
    sig("d1", 0.5, 0.8),
    sig("d2", 0.55, 0.7),
    sig("d3", 0.48, 0.9),
  ];

  test("unanimous AI signals → likely_ai_generated for text", () => {
    const out = scoreAnalysis(strongAi, "text");
    expect(out.classification).toBe("likely_ai_generated");
    expect(out.score).toBeGreaterThan(DEFAULT_SCORING.aiThreshold);
  });

  test("image AI verdict maps to likely_synthetic", () => {
    expect(scoreAnalysis(strongAi, "image").classification).toBe("likely_synthetic");
    expect(scoreAnalysis(strongAi, "audio").classification).toBe("likely_synthetic");
    expect(scoreAnalysis(strongAi, "document").classification).toBe("likely_ai_generated");
    expect(aiClassificationFor("image")).toBe("likely_synthetic");
  });

  test("unanimous human signals → likely_human", () => {
    const out = scoreAnalysis(strongHuman, "text");
    expect(out.classification).toBe("likely_human");
    expect(out.score).toBeLessThan(DEFAULT_SCORING.humanThreshold);
  });

  test("ambiguous middle zone → uncertain (not forced into a class)", () => {
    expect(scoreAnalysis(middle, "text").classification).toBe("uncertain");
  });

  test("conflicting signals (low consistency) → uncertain regardless of score", () => {
    const conflicting = [
      sig("d1", 0.95, 0.8),
      sig("d2", 0.05, 0.8),
      sig("d3", 0.9, 0.8),
      sig("d4", 0.05, 0.8),
    ];
    const out = scoreAnalysis(conflicting, "text");
    expect(out.consistency).toBeLessThan(0.35);
    expect(out.classification).toBe("uncertain");
  });
});

describe("scoring: confidence guarantees", () => {
  test("confidence never reaches 1.0 even for maximal input", () => {
    const maximal = Array.from({ length: 10 }, (_, i) => sig(`d${i}`, 1, 1, `s${i}`));
    const out = scoreAnalysis(maximal, "text");
    expect(out.confidence).toBeLessThan(1);
    expect(out.confidence).toBeLessThanOrEqual(DEFAULT_SCORING.maxConfidence);
  });

  test("confidence is monotone in signal strength/consistency", () => {
    const weak = [sig("d1", 0.6, 0.2, "a"), sig("d2", 0.6, 0.2, "b"), sig("d3", 0.6, 0.2, "c")];
    const strong = [sig("d1", 0.95, 0.9, "a"), sig("d2", 0.95, 0.9, "b"), sig("d3", 0.95, 0.9, "c")];
    const weakOut = scoreAnalysis(weak, "text");
    const strongOut = scoreAnalysis(strong, "text");
    // both may classify the same, but confidence ordering must hold
    expect(strongOut.confidence).toBeGreaterThan(weakOut.confidence);
  });
});

describe("scoring: explainability & determinism", () => {
  test("breakdown is sorted by |contribution| descending", () => {
    const out = scoreAnalysis([sig("a", 0.1, 0.3, "x"), sig("b", 0.95, 0.9, "y"), sig("c", 0.5, 0.5, "z")], "text");
    const abs = out.breakdown.map((b) => Math.abs(b.contribution));
    expect([...abs].sort((p, q) => q - p)).toEqual(abs);
  });

  test("score is exact weighted mean of votes (0..1 scale)", () => {
    const out = scoreAnalysis([sig("d1", 0.75, 1, "a"), sig("d2", 0.25, 1, "b")], "text");
    // votes: +0.5 and -0.5 → polarity 0 → score 0.5
    expect(out.score).toBeCloseTo(0.5, 10);
  });

  test("deterministic: identical inputs → identical outputs", () => {
    const signals = [sig("d1", 0.8, 0.7, "a"), sig("d2", 0.3, 0.6, "b"), sig("d3", 0.9, 0.8, "c")];
    const a = scoreAnalysis(signals, "text");
    const b = scoreAnalysis(signals.map((s) => ({ ...s })), "text");
    expect(a).toEqual(b);
  });

  test("weight overrides are respected and clamped to [0,1]", () => {
    const base = [sig("d1", 0.9, 0.2, "a"), sig("d2", 0.9, 0.2, "b")];
    const overridden = scoreAnalysis(base, "text", { weights: { d1: 5 } });
    expect(overridden.breakdown.find((b) => b.detectorId === "d1")?.weight).toBe(1);
    const nulled = scoreAnalysis(base, "text", { weights: { d1: -3 } });
    expect(nulled.breakdown.find((b) => b.detectorId === "d1")).toBeUndefined();
  });

  test("maxConfidence override caps confidence", () => {
    const maximal = Array.from({ length: 10 }, (_, i) => sig(`d${i}`, 1, 1, `s${i}`));
    const out = scoreAnalysis(maximal, "text", { maxConfidence: 0.6 });
    expect(out.confidence).toBeLessThanOrEqual(0.6);
  });
});

describe("confidenceLabel", () => {
  test("maps bands honestly", () => {
    expect(confidenceLabel(null)).toBe("none");
    expect(confidenceLabel(0.1)).toBe("very low");
    expect(confidenceLabel(0.4)).toBe("low");
    expect(confidenceLabel(0.6)).toBe("moderate");
    expect(confidenceLabel(0.9)).toBe("high (never absolute)");
  });
});

/**
 * Detector: image.pixel_stats — EXPERIMENTAL.
 * First-order statistics of decoded pixels (sharpness proxy, LSB uniformity,
 * channel/saturation stats). These are baseline heuristics with limited
 * discriminative power; weight is intentionally low and limitations are shown
 * to the user. TODO(phase-3): replace with trained CV detectors via plugins.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { PixelStats } from "../../features/image-features";

export const pixelStatsDetector: Detector = {
  id: "image.pixel_stats",
  name: "Pixel statistics (experimental)",
  version: "0.3.0",
  description:
    "First-order statistics over decoded pixels: high-frequency energy (Laplacian variance), LSB uniformity, channel balance. Baseline heuristics — NOT a trained model.",
  modalities: ["image"],
  defaultWeight: 0.3,
  limitations: [
    "Experimental heuristics, not an ML model — treat output as descriptive context.",
    "Strong post-processing (sharpening, filters, re-compression) distorts all values.",
    "Currently no trained computer-vision detector is bundled (see Models & Plugins pages).",
  ],

  async analyze(ctx: DetectorContext) {
    const stats = ctx.features.pixelStats as PixelStats | { decoded: false; reason: string } | undefined;
    if (!stats) return { status: "skipped" as const, signals: [], summary: "Pixel stats unavailable" };
    if (!stats.decoded) {
      return {
        status: "skipped" as const,
        signals: [],
        summary: `Pixel analysis unavailable: ${(stats as { reason: string }).reason}`,
      };
    }
    const p = stats as PixelStats;
    const evidence: EvidenceItem[] = [
      {
        kind: "statistic",
        label: "Pixel statistics",
        content: `luma mean ${p.lumaMean} · std ${p.lumaStd} · Laplacian variance ${p.laplacianVariance} · LSB ratios R/G/B ${p.lsbRatios.r}/${p.lsbRatios.g}/${p.lsbRatios.b} · saturation ${p.saturationMean}`,
        meta: {
          laplacianVariance: p.laplacianVariance,
          lsbR: p.lsbRatios.r,
          lsbG: p.lsbRatios.g,
          lsbB: p.lsbRatios.b,
          saturation: p.saturationMean,
        },
      },
    ];

    const votes: Array<{ score: number; w: number; note: string }> = [];
    // Ultra-flat images (very low high-frequency energy) resemble smooth generative output
    if (p.laplacianVariance < 40) votes.push({ score: 0.62, w: 0.6, note: "very low high-frequency energy (smooth/synthetic look)" });
    else if (p.laplacianVariance > 2500) votes.push({ score: 0.42, w: 0.5, note: "very high high-frequency energy (sensor-noise look)" });
    // Extremely uniform LSB planes indicate synthetic gradients or heavy processing
    if (p.lsbRatios.r < 0.42 && p.lsbRatios.g < 0.42 && p.lsbRatios.b < 0.42) {
      votes.push({ score: 0.6, w: 0.4, note: "uniformly low LSB activity across channels" });
    }

    const totalW = votes.reduce((a, v) => a + v.w, 0) || 1;
    const aiScore = votes.length ? votes.reduce((a, v) => a + v.score * v.w, 0) / totalW : 0.5;
    if (votes.length) {
      evidence.push({ kind: "observation", label: "Observations", content: votes.map((v) => `• ${v.note}`).join("\n") });
    } else {
      evidence.push({ kind: "observation", label: "Observations", content: "No pixel-level pattern stood out." });
    }

    const signal: Signal = {
      id: `${this.id}.${votes.length ? "observed" : "neutral"}`,
      detectorId: this.id,
      name: votes.length ? "Pixel-level patterns observed (experimental)" : "No pixel-level pattern (experimental)",
      description: this.description,
      value: p.laplacianVariance,
      unit: "laplacian-var",
      aiScore,
      weight: this.defaultWeight,
      evidence,
      notes: "Experimental baseline — do not rely on this signal alone.",
    };
    return { status: "ok" as const, signals: [signal], summary: `Laplacian var ${p.laplacianVariance}` };
  },
};

/**
 * Detector: audio.waveform — WAV PCM ONLY, EXPERIMENTAL.
 * Deterministic waveform statistics: dynamics (RMS variability), silence
 * structure, clipping, DC offset, zero-crossing rate. Baseline heuristics —
 * no spectral or neural analysis yet (TODO phase-3).
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { WaveformStats } from "../../features/audio-features";

export const waveformDetector: Detector = {
  id: "audio.waveform",
  name: "Waveform statistics (experimental, WAV only)",
  version: "0.3.0",
  description:
    "Decodes PCM WAV audio and measures dynamics: RMS variability across 50 ms windows, silence ratio and pause structure, clipping, DC offset, zero-crossing rate.",
  modalities: ["audio"],
  defaultWeight: 0.4,
  limitations: [
    "Only uncompressed WAV (PCM 8/16/32-bit or float) is decoded; MP3/FLAC/M4A are metadata-only in this MVP.",
    "Heuristic baseline — not a trained model. Music with heavy mastering distorts dynamics statistics.",
  ],

  async analyze(ctx: DetectorContext) {
    const stats = ctx.features.waveformStats as WaveformStats | undefined;
    if (!stats) return { status: "skipped" as const, signals: [], summary: "Waveform stats unavailable" };
    if (!stats.decoded) {
      return {
        status: "skipped" as const,
        signals: [],
        summary: `Waveform analysis unavailable: ${stats.reason}`,
      };
    }

    const evidence: EvidenceItem[] = [
      {
        kind: "statistic",
        label: "Waveform statistics",
        content: `${stats.samples.toLocaleString()} frames · RMS mean ${stats.rmsMean} (CV ${stats.rmsCv}) · peak ${stats.peak} · crest factor ${stats.crestFactor} · silence ${Math.round(stats.silenceRatio * 100)}% in ${stats.silenceRunCount} runs · clipping ${(stats.clippingRatio * 100).toFixed(3)}% · DC offset ${stats.dcOffset} · ZCR ${stats.zcrMean}±${stats.zcrStd}`,
        meta: {
          rmsCv: stats.rmsCv,
          silenceRatio: stats.silenceRatio,
          silenceRuns: stats.silenceRunCount,
          clipping: stats.clippingRatio,
          crest: stats.crestFactor,
          zcrMean: stats.zcrMean,
          zcrStd: stats.zcrStd,
        },
      },
    ];

    const votes: Array<{ score: number; w: number; note: string }> = [];
    // Very flat dynamics across the whole file (TTS tends to be evenly loud)
    if (stats.rmsCv < 0.15 && stats.rmsMean > 0.01) {
      votes.push({ score: 0.64, w: 0.7, note: "very uniform loudness dynamics" });
    } else if (stats.rmsCv > 0.5) {
      votes.push({ score: 0.4, w: 0.6, note: "highly varied dynamics (natural recording look)" });
    }
    // Zero silence gaps at all is unusual for natural speech recordings
    if (stats.silenceRunCount === 0 && stats.rmsMean > 0.005) {
      votes.push({ score: 0.6, w: 0.4, note: "no silence gaps at all" });
    }
    if (stats.clippingRatio > 0.005) {
      votes.push({ score: 0.62, w: 0.5, note: "notable clipping (aggressive mastering or naive synthesis)" });
    }

    const totalW = votes.reduce((a, v) => a + v.w, 0) || 1;
    const aiScore = votes.length ? votes.reduce((a, v) => a + v.score * v.w, 0) / totalW : 0.5;
    if (votes.length) {
      evidence.push({ kind: "observation", label: "Observations", content: votes.map((v) => `• ${v.note}`).join("\n") });
    } else {
      evidence.push({ kind: "observation", label: "Observations", content: "Waveform looks unremarkable." });
    }

    const signal: Signal = {
      id: `${this.id}.${votes.length ? "observed" : "neutral"}`,
      detectorId: this.id,
      name: votes.length ? "Waveform patterns observed (experimental)" : "Waveform looks unremarkable (experimental)",
      description: this.description,
      value: stats.rmsCv,
      unit: "rms-cv",
      aiScore,
      weight: this.defaultWeight,
      evidence,
      notes: "Experimental baseline — do not rely on this signal alone.",
    };
    return { status: "ok" as const, signals: [signal], summary: `RMS CV ${stats.rmsCv}, silence ${Math.round(stats.silenceRatio * 100)}%` };
  },
};

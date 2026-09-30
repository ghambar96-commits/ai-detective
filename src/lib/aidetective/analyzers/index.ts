/**
 * AIDetective — Analyzers (per-modality pipelines).
 * An Analyzer wires: feature extractors → detectors → analyzer-level warnings.
 * Raw detector output stays untouched here; interpretation happens only in
 * the Scoring Engine.
 */
import type { Analyzer, AnalysisOptions, Detector, FeatureExtractor, Modality } from "../core/types";
import { getRegistry } from "../core/registry";
import { textFeaturesExtractor, imageFeaturesExtractor, audioFeaturesExtractor } from "../features/extractors";
import type { TextFeatures } from "../features/text-features";

function filterDetectors(modality: Modality, options: AnalysisOptions): Detector[] {
  const registry = getRegistry();
  const all = registry.listDetectors().filter((d) => d.modalities.includes(modality));
  if (options.detectors && options.detectors.length > 0) {
    const requested = new Set(options.detectors);
    return all.filter((d) => requested.has(d.id));
  }
  return all;
}

// ─── Text / document analyzer ─────────────────────────────────────────────────

export class TextAnalyzer implements Analyzer {
  readonly modality: Modality;
  readonly featureExtractors: FeatureExtractor[] = [textFeaturesExtractor];

  constructor(modality: Modality = "text") {
    this.modality = modality;
  }

  resolveDetectors(options: AnalysisOptions): Detector[] {
    return filterDetectors(this.modality, options);
  }

  collectWarnings(features: Record<string, unknown>): string[] {
    const warnings: string[] = [];
    const f = features.textFeatures as TextFeatures | undefined;
    if (!f) return warnings;
    if (f.wordCount < 40) {
      warnings.push(
        `Very short text (${f.wordCount} words). Statistical AI-detection signals are unreliable below ~120 words — results are provided but should be treated as weak.`
      );
    } else if (f.wordCount < 120) {
      warnings.push(`Short text (${f.wordCount} words). Reliability is reduced; the scoring engine caps confidence accordingly.`);
    }
    if (f.language === "mixed") {
      warnings.push("Mixed-language content detected. Phrase lists cover English fully; Persian support is experimental.");
    } else if (f.language === "fa") {
      warnings.push("Persian text detected. The Persian phrase list is experimental; heuristic coverage is smaller than for English.");
    }
    return warnings;
  }
}

// ─── Image analyzer ───────────────────────────────────────────────────────────

export class ImageAnalyzer implements Analyzer {
  readonly modality: Modality = "image";
  readonly featureExtractors: FeatureExtractor[] = [imageFeaturesExtractor];

  resolveDetectors(options: AnalysisOptions): Detector[] {
    return filterDetectors(this.modality, options);
  }

  collectWarnings(features: Record<string, unknown>): string[] {
    const warnings: string[] = [];
    const format = features.imageFormat as string | undefined;
    const pixel = features.pixelStats as { decoded: boolean; reason?: string } | undefined;
    if (pixel && !pixel.decoded && pixel.reason) {
      warnings.push(`Pixel-level analysis was skipped: ${pixel.reason}`);
    }
    if (format === "webp") {
      warnings.push("WEBP: metadata parsing is limited compared to PNG/JPEG.");
    }
    warnings.push(
      "No trained computer-vision detector is bundled in this MVP; image signals are heuristic baselines and must not be treated as proof."
    );
    return warnings;
  }
}

// ─── Audio analyzer ───────────────────────────────────────────────────────────

export class AudioAnalyzer implements Analyzer {
  readonly modality: Modality = "audio";
  readonly featureExtractors: FeatureExtractor[] = [audioFeaturesExtractor];

  resolveDetectors(options: AnalysisOptions): Detector[] {
    return filterDetectors(this.modality, options);
  }

  collectWarnings(features: Record<string, unknown>): string[] {
    const warnings: string[] = [];
    const wf = features.waveformStats as { decoded: boolean; reason?: string } | undefined;
    if (wf && !wf.decoded && wf.reason) {
      warnings.push(`Waveform analysis was skipped: ${wf.reason}`);
    }
    warnings.push("Speech-to-text / transcript analysis is not implemented in this MVP (see roadmap).");
    warnings.push(
      "No trained audio detector is bundled in this MVP; audio signals are heuristic baselines and must not be treated as proof."
    );
    return warnings;
  }
}

export function getAnalyzerFor(kind: "text" | "image" | "audio", modality?: Modality): Analyzer {
  if (kind === "image") return new ImageAnalyzer();
  if (kind === "audio") return new AudioAnalyzer();
  return new TextAnalyzer(modality === "document" ? "document" : "text");
}

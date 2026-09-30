/**
 * Detector: image.compression
 * JPEG quantization tables (quality estimate via IJG inversion) and chroma
 * subsampling; PNG filter/bit-depth profile. Baseline, mostly descriptive.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import type { JpegStructure } from "../../features/image-features";

export const compressionDetector: Detector = {
  id: "image.compression",
  name: "Compression profile",
  version: "1.0.0",
  description:
    "Reads JPEG quantization tables (estimated encoder quality) and chroma subsampling, or PNG color/bit-depth profile. Mostly descriptive context for other signals.",
  modalities: ["image"],
  defaultWeight: 0.25,
  limitations: [
    "Both cameras and AI tools use similar JPEG settings; this detector rarely leans strongly either way.",
    "Re-compression destroys original encoder characteristics.",
  ],

  async analyze(ctx: DetectorContext) {
    const format = ctx.features.imageFormat as string | undefined;
    if (format !== "jpg" && format !== "png") {
      return { status: "skipped" as const, signals: [], summary: `Compression profile not implemented for ${format ?? "unknown"}` };
    }
    const evidence: EvidenceItem[] = [];

    if (format === "jpg") {
      const jpeg = ctx.features.jpegStructure as JpegStructure | undefined;
      if (!jpeg || jpeg.qualityEstimate === null) {
        return { status: "skipped" as const, signals: [], summary: "No JPEG quantization tables parsed" };
      }
      evidence.push({
        kind: "metadata",
        label: "JPEG structure",
        content: `estimated encoder quality ~${jpeg.qualityEstimate} (IJG scale) · chroma subsampling ${jpeg.chromaSubsampling ?? "unknown"} · ${jpeg.progressive ? "progressive" : "baseline"} encoding`,
        meta: { quality: jpeg.qualityEstimate, subsampling: jpeg.chromaSubsampling, progressive: jpeg.progressive },
      });
      // Very high quality + 4:4:4 is slightly more common in raw generator output;
      // low quality suggests re-upload (weak human/social indicator).
      let aiScore = 0.5;
      let name = "Ordinary JPEG profile";
      if (jpeg.qualityEstimate >= 95 && jpeg.chromaSubsampling === "4:4:4") {
        aiScore = 0.58;
        name = "Very high-quality, full-chroma JPEG (raw export)";
      } else if (jpeg.qualityEstimate <= 70) {
        aiScore = 0.45;
        name = "Heavily compressed JPEG (re-upload typical)";
      }
      const signal: Signal = {
        id: `${this.id}.${aiScore >= 0.55 ? "raw" : aiScore <= 0.45 ? "recompressed" : "ordinary"}`,
        detectorId: this.id,
        name,
        description: this.description,
        value: jpeg.qualityEstimate,
        unit: "quality",
        aiScore,
        weight: this.defaultWeight,
        evidence,
      };
      return { status: "ok" as const, signals: [signal], summary: `JPEG quality ~${jpeg.qualityEstimate}, ${jpeg.chromaSubsampling ?? "?"}` };
    }

    // PNG profile
    const bitDepth = ctx.features.pngBitDepth as number | undefined;
    const colorType = ctx.features.pngColorType as number | undefined;
    evidence.push({
      kind: "metadata",
      label: "PNG structure",
      content: `bit depth ${bitDepth ?? "?"} · color type ${colorType ?? "?"} (6 = RGBA, 2 = RGB)`,
      meta: { bitDepth, colorType },
    });
    const signal: Signal = {
      id: `${this.id}.png_profile`,
      detectorId: this.id,
      name: "PNG profile recorded (descriptive)",
      description: this.description,
      value: `${bitDepth ?? "?"}-bit`,
      aiScore: 0.5,
      weight: this.defaultWeight * 0.5,
      evidence,
    };
    return { status: "ok" as const, signals: [signal], summary: "PNG profile is descriptive only" };
  },
};

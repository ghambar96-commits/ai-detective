/**
 * Detector: image.dimensions
 * Generative models usually emit fixed canvas sizes (multiples of 64:
 * 512×512, 1024×1024, 896×1152 …). Camera sensors produce model-specific
 * odd dimensions. Probabilistic, format-level signal.
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";

const COMMON_AI_SIZES = new Set([
  "512x512", "768x768", "1024x1024", "1024x1792", "1792x1024", "1024x1536", "1536x1024",
  "896x1152", "1152x896", "1216x832", "832x1216", "1344x768", "768x1344", "640x1536",
  "1408x704", "704x1408", "1472x704", "1080x1080", "512x768", "768x512", "912x912",
]);

export const dimensionsDetector: Detector = {
  id: "image.dimensions",
  name: "Dimension profile",
  version: "1.0.0",
  description:
    "Compares image dimensions against canvases typical of diffusion models (multiples of 64) versus camera sensor sizes.",
  modalities: ["image"],
  defaultWeight: 0.45,
  limitations: [
    "Humans also crop/resize to round numbers (e.g. 1920×1080).",
    "Weak signal on its own — always combined with other detectors.",
  ],

  async analyze(ctx: DetectorContext) {
    const width = ctx.features.imageWidth as number | undefined;
    const height = ctx.features.imageHeight as number | undefined;
    if (!width || !height) {
      return { status: "skipped" as const, signals: [], summary: "Dimensions unknown" };
    }
    const key = `${width}x${height}`;
    const mult64 = width % 64 === 0 && height % 64 === 0;
    const mult8 = width % 8 === 0 && height % 8 === 0;
    const evidence: EvidenceItem[] = [
      {
        kind: "metadata",
        label: "Dimensions",
        content: `${width}×${height} · both divisible by 64: ${mult64 ? "yes" : "no"} · by 8: ${mult8 ? "yes" : "no"}`,
        meta: { width, height, mult64, mult8 },
      },
    ];

    let aiScore: number;
    let name: string;
    if (COMMON_AI_SIZES.has(key)) {
      aiScore = 0.75;
      name = "Dimensions match a common AI-generation canvas";
    } else if (mult64 && width >= 512 && height >= 512) {
      aiScore = 0.65;
      name = "Both dimensions are multiples of 64";
    } else if (!mult8) {
      aiScore = 0.3;
      name = "Irregular dimensions (not multiple of 8) — camera-like";
    } else {
      aiScore = 0.5;
      name = "Unremarkable dimension profile";
    }

    const signal: Signal = {
      id: `${this.id}.${COMMON_AI_SIZES.has(key) ? "known_canvas" : mult64 ? "mult64" : !mult8 ? "irregular" : "ordinary"}`,
      detectorId: this.id,
      name,
      description: this.description,
      value: key,
      aiScore,
      weight: this.defaultWeight,
      evidence,
    };
    return { status: "ok" as const, signals: [signal], summary: `${width}×${height}` };
  },
};

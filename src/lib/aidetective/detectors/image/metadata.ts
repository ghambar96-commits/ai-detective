/**
 * Detector: image.metadata — METADATA LAYER ONLY.
 * Reads EXIF / PNG text chunks / software tags / C2PA hints. Separate from
 * visual analysis by design (see spec: metadata ≠ pixel analysis).
 */
import type { Detector, DetectorContext, Signal, EvidenceItem } from "../../core/types";
import {
  extractImageMetadata,
  isEditorSoftware,
  isGenAiSoftware,
  type ImageMetadataFeatures,
} from "../../features/image-features";

export const imageMetadataDetector: Detector = {
  id: "image.metadata",
  name: "Metadata & provenance",
  version: "1.0.0",
  description:
    "Inspects EXIF/PNG metadata: generative-tool tags, camera provenance, editor software, C2PA content-credentials markers. Metadata-only; no pixels are inspected here.",
  modalities: ["image"],
  defaultWeight: 0.9,
  limitations: [
    "Metadata is trivially strippable or forgeable; its absence is weak evidence.",
    "Social-media re-uploads usually lose all metadata.",
  ],

  async analyze(ctx: DetectorContext) {
    const buffer = ctx.input.buffer;
    if (!buffer) return { status: "skipped" as const, signals: [], summary: "No image buffer" };
    const format = (ctx.features.imageFormat as string | undefined) ?? "unknown";
    const meta: ImageMetadataFeatures = extractImageMetadata(buffer, format);

    const evidence: EvidenceItem[] = [];
    const signals: Signal[] = [];

    if (meta.width) {
      evidence.push({
        kind: "metadata",
        label: "Container",
        content: `format ${meta.format} · dimensions ${meta.width}×${meta.height} · EXIF ${meta.hasExif ? "present" : "absent"} · XMP ${meta.hasXmp ? "present" : "absent"} · ICC ${meta.hasIcc ? "present" : "absent"}`,
        meta: { format: meta.format, width: meta.width, height: meta.height, hasExif: meta.hasExif },
      });
    }

    const genAi = isGenAiSoftware(meta.software, meta.pngTextChunks);
    if (genAi) {
      evidence.push({
        kind: "metadata",
        label: "Generative-tool tag found",
        content: `Metadata references "${genAi}" — a known AI generation tool. ${meta.software ? `Software tag: ${meta.software}` : ""}`.trim(),
        meta: { match: genAi, software: meta.software },
      });
      signals.push({
        id: `${this.id}.genai_tag`,
        detectorId: this.id,
        name: "Generative-AI tool tag in metadata",
        description: this.description,
        value: genAi,
        aiScore: 0.95,
        weight: this.defaultWeight,
        evidence,
      });
    }

    const editor = isEditorSoftware(meta.software);
    if (editor) {
      evidence.push({
        kind: "metadata",
        label: "Editor software tag",
        content: `Software tag references "${editor}" — image was edited by software (not proof of AI generation).`,
        meta: { editor },
      });
    }

    if (meta.c2paHint) {
      evidence.push({ kind: "metadata", label: "Content credentials", content: meta.c2paHint });
    }

    const hasCameraProvenance =
      Boolean(meta.camera.make && meta.camera.model) || Boolean(meta.dateTimeOriginal && meta.exposure.iso);

    if (signals.length === 0) {
      if (hasCameraProvenance) {
        evidence.push({
          kind: "metadata",
          label: "Camera provenance",
          content: `Make: ${meta.camera.make ?? "?"} · Model: ${meta.camera.model ?? "?"} · Lens: ${meta.camera.lens ?? "?"} · Taken: ${meta.dateTimeOriginal ?? "?"} · ISO ${meta.exposure.iso ?? "?"} · f/${meta.exposure.fNumber ?? "?"} · ${meta.exposure.exposureTime ?? "?"}s`,
          meta: { make: meta.camera.make, model: meta.camera.model, dateTime: meta.dateTimeOriginal },
        });
        signals.push({
          id: `${this.id}.camera_provenance`,
          detectorId: this.id,
          name: "Camera capture metadata present",
          description: this.description,
          value: `${meta.camera.make ?? ""} ${meta.camera.model ?? ""}`.trim(),
          aiScore: 0.22,
          weight: this.defaultWeight,
          evidence,
          notes: "Camera EXIF suggests a real capture but can be copied by editing tools.",
        });
      } else {
        evidence.push({
          kind: "metadata",
          label: "Metadata summary",
          content: `No camera EXIF and no generative-tool tags found.${meta.exifError ? ` (EXIF parse note: ${meta.exifError})` : ""}${meta.pngTextChunks.length ? ` PNG text chunks: ${meta.pngTextChunks.map((c) => c.key).join(", ")}` : ""}`,
        });
        signals.push({
          id: `${this.id}.no_metadata`,
          detectorId: this.id,
          name: "No capture metadata present",
          description: this.description,
          value: null,
          aiScore: 0.6,
          weight: this.defaultWeight * 0.6,
          evidence,
          notes: "Most images from both AI tools and social apps have no EXIF — this alone is weak evidence.",
        });
      }
    }

    return {
      status: "ok" as const,
      signals,
      summary: genAi
        ? `Generative-tool tag found: ${genAi}`
        : hasCameraProvenance
          ? "Camera provenance present"
          : "No decisive metadata",
    };
  },
};

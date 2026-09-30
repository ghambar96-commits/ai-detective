/** AIDetective — feature extractor adapters bridging raw inputs to features. */
import type { FeatureExtractor, AnalysisInput, Modality } from "../core/types";
import { extractTextFeatures, type TextFeatures } from "./text-features";
import {
  extractImageMetadata,
  extractJpegStructure,
  extractPixelStats,
  parsePngDimensions,
} from "./image-features";
import {
  parseFlacMetadata,
  parseId3Tags,
  parseM4aMetadata,
  parseWavHeader,
  parseWavTags,
  extractWaveformStats,
  type AudioTagFeatures,
} from "./audio-features";

export const textFeaturesExtractor: FeatureExtractor = {
  id: "features.text",
  modalities: ["text", "document"],
  async extract({ input }: { input: AnalysisInput; modality: Modality }) {
    const text = input.text ?? "";
    const textFeatures: TextFeatures = extractTextFeatures(text);
    return { textFeatures };
  },
};

export const imageFeaturesExtractor: FeatureExtractor = {
  id: "features.image",
  modalities: ["image"],
  async extract({ input }) {
    const buffer = input.buffer;
    if (!buffer) return {};
    const format = (input.meta?.format as string | undefined) ?? detectImageFormat(buffer);
    const metadata = extractImageMetadata(buffer, format);
    const jpegStructure = format === "jpg" ? extractJpegStructure(buffer) : undefined;
    const features: Record<string, unknown> = {
      imageFormat: format,
      imageWidth: metadata.width,
      imageHeight: metadata.height,
      imageMetadata: metadata,
      pngBitDepth: metadata.format === "png" ? parsePngBitDepth(buffer) : undefined,
      pngColorType: metadata.format === "png" ? parsePngColorType(buffer) : undefined,
      jpegStructure,
    };
    // JPEG dimension fallback from SOF markers (EXIF may be absent)
    if (features.imageWidth == null && jpegStructure?.width) features.imageWidth = jpegStructure.width;
    if (features.imageHeight == null && jpegStructure?.height) features.imageHeight = jpegStructure.height;
    try {
      features.pixelStats = await extractPixelStats(buffer);
    } catch {
      features.pixelStats = { decoded: false, reason: "pixel decoding failed" };
    }
    return features;
  },
};

export const audioFeaturesExtractor: FeatureExtractor = {
  id: "features.audio",
  modalities: ["audio"],
  async extract({ input }) {
    const buffer = input.buffer;
    if (!buffer) return {};
    const container = detectAudioContainer(buffer);
    let tags: AudioTagFeatures;
    if (container === "wav") tags = parseWavTags(buffer);
    else if (container === "mp3") tags = parseId3Tags(buffer);
    else if (container === "flac") tags = parseFlacMetadata(buffer);
    else if (container === "m4a") tags = parseM4aMetadata(buffer);
    else {
      tags = {
        container: container ?? "unknown", durationSec: null, sampleRate: null, channels: null,
        bitrateKbps: null, encoder: null, title: null, artist: null, softwareHints: [],
        extraTags: [], bitrateConsistent: null,
      };
    }
    const features: Record<string, unknown> = { audioContainer: container, audioTags: tags };
    const wav = container === "wav" ? parseWavHeader(buffer) : null;
    if (wav) {
      features.waveformStats = extractWaveformStats(buffer, wav);
    } else if (container !== "wav") {
      features.waveformStats = {
        decoded: false,
        reason: `${container?.toUpperCase() ?? "container"} decoding is not implemented in this MVP — metadata-level analysis only (TODO phase-3: decode pipeline)`,
        samples: 0, rmsMean: 0, rmsStd: 0, rmsCv: 0, peak: 0, crestFactor: 0,
        dcOffset: 0, clippingRatio: 0, silenceRatio: 0, silenceRunCount: 0, zcrMean: 0, zcrStd: 0,
      };
    }
    return features;
  },
};

function detectImageFormat(buffer: Buffer): string {
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF") return "webp";
  if (buffer[0] === 0x89) return "png";
  return "jpg";
}

function detectAudioContainer(buffer: Buffer): string | null {
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WAVE") return "wav";
  if (buffer.subarray(0, 3).toString("latin1") === "ID3") return "mp3";
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "mp3";
  if (buffer.subarray(0, 4).toString("latin1") === "fLaC") return "flac";
  if (buffer.subarray(4, 8).toString("latin1") === "ftyp") return "m4a";
  return null;
}

function parsePngBitDepth(buffer: Buffer): number | undefined {
  try {
    if (buffer.subarray(12, 16).toString("latin1") === "IHDR") return buffer[24];
  } catch {
    /* ignore */
  }
  return undefined;
}

function parsePngColorType(buffer: Buffer): number | undefined {
  try {
    if (buffer.subarray(12, 16).toString("latin1") === "IHDR") return buffer[25];
  } catch {
    /* ignore */
  }
  return undefined;
}

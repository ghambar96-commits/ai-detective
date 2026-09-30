/**
 * AIDetective — image feature extraction.
 * Two strictly separated layers:
 *  1. Metadata layer  : EXIF, PNG text chunks, JPEG markers/quant tables.
 *  2. Pixel layer     : decoded pixel statistics (sharp; JPEG/PNG/WEBP).
 */
import ExifReader from "exifreader";
import { config } from "../core/config";

// ─── Metadata layer ───────────────────────────────────────────────────────────

export interface ImageMetadataFeatures {
  format: string;
  width: number | null;
  height: number | null;
  hasExif: boolean;
  hasXmp: boolean;
  hasIcc: boolean;
  camera: { make: string | null; model: string | null; lens: string | null };
  software: string | null;
  dateTimeOriginal: string | null;
  exposure: { iso: number | null; fNumber: number | null; exposureTime: string | null; focalLength: string | null };
  creator: string | null;
  description: string | null;
  pngTextChunks: Array<{ key: string; value: string }>;
  exifError: string | null;
  c2paHint: string | null;
}

const GEN_AI_SOFTWARE_PATTERNS = [
  "dall", "dall·e", "midjourney", "stable diffusion", "stablediffusion", "comfyui",
  "automatic1111", "invokeai", "novelai", "firefly", "imagen", "flux", "sdxl",
  "craiyon", "leonardo.ai", "runway", "playground", "ideogram", "recraft", "krea",
];

const EDITOR_PATTERNS = ["photoshop", "gimp", "lightroom", "affinity", "paint.net", "pixelmator", "darktable", "capture one"];

export function extractImageMetadata(buffer: Buffer, format: string): ImageMetadataFeatures {
  const features: ImageMetadataFeatures = {
    format,
    width: null,
    height: null,
    hasExif: false,
    hasXmp: false,
    hasIcc: false,
    camera: { make: null, model: null, lens: null },
    software: null,
    dateTimeOriginal: null,
    exposure: { iso: null, fNumber: null, exposureTime: null, focalLength: null },
    creator: null,
    description: null,
    pngTextChunks: [],
    exifError: null,
    c2paHint: null,
  };

  // C2PA / content credentials hint (JUMBF marker)
  try {
    if (buffer.indexOf(Buffer.from("c2pa", "latin1")) !== -1 || buffer.indexOf(Buffer.from("jumb", "latin1")) !== -1) {
      features.c2paHint = "C2PA/content-credentials marker detected in file";
    }
  } catch {
    /* ignore */
  }

  if (format === "png") {
    const chunks = parsePngTextChunks(buffer);
    features.pngTextChunks = chunks.slice(0, 20);
    const dim = parsePngDimensions(buffer);
    features.width = dim.width;
    features.height = dim.height;
  }

  try {
    const tags = ExifReader.load(buffer, { expanded: false }) as Record<string, { description?: string; value?: unknown }>;
    const get = (name: string): string | null => {
      const t = tags[name];
      if (!t) return null;
      const d = t.description ?? (typeof t.value === "string" ? t.value : undefined);
      return d !== undefined && d !== "" ? String(d) : null;
    };
    features.hasExif = Boolean(tags["Make"] || tags["Model"] || tags["DateTimeOriginal"] || tags["Software"] || tags["exif"]);
    features.hasXmp = Boolean((tags["xmp"] || tags["CreatorTool"] || tags["dc:creator"]) ?? false) || buffer.indexOf(Buffer.from("<x:xmpmeta", "latin1")) !== -1;
    features.hasIcc = Boolean((tags["icc"] ?? false)) || buffer.indexOf(Buffer.from("ICC_PROFILE", "latin1")) !== -1;
    features.camera.make = get("Make");
    features.camera.model = get("Model");
    features.camera.lens = get("LensModel");
    features.software = get("Software") ?? get("CreatorTool");
    features.dateTimeOriginal = get("DateTimeOriginal");
    features.exposure = {
      iso: get("ISOSpeedRatings") ? Number(get("ISOSpeedRatings")) || null : null,
      fNumber: get("FNumber") ? Number(get("FNumber")) || null : null,
      exposureTime: get("ExposureTime"),
      focalLength: get("FocalLength"),
    };
    features.creator = get("Artist") ?? get("dc:creator") ?? get("By-line");
    features.description = get("ImageDescription") ?? get("UserComment");
    // PNG dimensions from IHDR if exifreader missed them
    if (features.width === null && get("ImageWidth")) features.width = Number(get("ImageWidth")) || null;
    if (features.height === null && get("ImageHeight")) features.height = Number(get("ImageHeight")) || null;
  } catch (error) {
    features.exifError = error instanceof Error ? error.message : "EXIF parsing failed";
  }

  return features;
}

export function isGenAiSoftware(software: string | null, chunks: Array<{ key: string; value: string }>): string | null {
  const haystacks = [software ?? "", ...chunks.map((c) => `${c.key}=${c.value}`)].join(" | ").toLowerCase();
  for (const pattern of GEN_AI_SOFTWARE_PATTERNS) {
    if (haystacks.includes(pattern)) return pattern;
  }
  return null;
}

export function isEditorSoftware(software: string | null): string | null {
  if (!software) return null;
  const lower = software.toLowerCase();
  for (const pattern of EDITOR_PATTERNS) if (lower.includes(pattern)) return pattern;
  return null;
}

function parsePngDimensions(buffer: Buffer): { width: number | null; height: number | null } {
  try {
    // IHDR always starts at byte 16 (8 sig + 4 len + 4 type)
    if (buffer.length >= 24 && buffer.subarray(12, 16).toString("latin1") === "IHDR") {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
  } catch {
    /* ignore */
  }
  return { width: null, height: null };
}

export function parsePngTextChunks(buffer: Buffer): Array<{ key: string; value: string }> {
  const chunks: Array<{ key: string; value: string }> = [];
  try {
    let offset = 8;
    while (offset + 12 <= buffer.length && chunks.length < 40) {
      const len = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
      const dataStart = offset + 8;
      if (type === "tEXt") {
        const data = buffer.subarray(dataStart, dataStart + Math.min(len, 4096));
        const nul = data.indexOf(0);
        if (nul > 0) {
          chunks.push({
            key: data.subarray(0, nul).toString("latin1").slice(0, 100),
            value: data.subarray(nul + 1).toString("latin1").slice(0, 800),
          });
        }
      } else if (type === "iTXt") {
        const data = buffer.subarray(dataStart, dataStart + Math.min(len, 4096));
        const nul = data.indexOf(0);
        if (nul > 0) {
          const rest = data.subarray(nul + 1);
          const nul2 = rest.indexOf(0);
          const valueStart = nul2 >= 0 ? Math.min(nul2 + 2, rest.length) : 0;
          chunks.push({
            key: data.subarray(0, nul).toString("latin1").slice(0, 100),
            value: rest.subarray(valueStart).toString("utf8").slice(0, 800),
          });
        }
      } else if (type === "IEND") {
        break;
      }
      offset = dataStart + len + 4; // skip data + CRC
    }
  } catch {
    /* best-effort */
  }
  return chunks;
}

export interface JpegStructure {
  qualityEstimate: number | null;
  chromaSubsampling: string | null;
  progressive: boolean;
  hasQuantTables: boolean;
  width: number | null;
  height: number | null;
}

/** Parse JPEG SOF/DQT markers for compression profile (real, spec-based parsing). */
export function extractJpegStructure(buffer: Buffer): JpegStructure {
  const result: JpegStructure = { qualityEstimate: null, chromaSubsampling: null, progressive: false, hasQuantTables: false, width: null, height: null };
  try {
    let offset = 2;
    let lumTable: number[] | null = null;
    let sampling: Array<[number, number]> = [];
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const len = buffer.readUInt16BE(offset + 2);
      if (marker === 0xdb && len >= 69) {
        // DQT
        const table: number[] = [];
        const pq = buffer[offset + 4] >> 4;
        if (pq === 0) {
          for (let i = 0; i < 64; i++) table.push(buffer[offset + 5 + i]);
          result.hasQuantTables = true;
          if (!lumTable) lumTable = table;
        }
      } else if ((marker === 0xc0 || marker === 0xc2) && len >= 15) {
        if (marker === 0xc2) result.progressive = true;
        result.height = buffer.readUInt16BE(offset + 5);
        result.width = buffer.readUInt16BE(offset + 7);
        const nc = buffer[offset + 9];
        sampling = [];
        for (let i = 0; i < nc; i++) {
          const b = buffer[offset + 11 + i * 2];
          sampling.push([b >> 4, b & 0x0f]);
        }
      } else if (marker === 0xda) {
        break; // start of scan
      }
      offset += 2 + len;
    }
    if (lumTable && sampling.length >= 3) {
      result.qualityEstimate = estimateJpegQuality(lumTable);
      const [y, cb, cr] = sampling;
      result.chromaSubsampling =
        y[0] === 1 && y[1] === 1 && cb[0] === 1 && cb[1] === 1 && cr[0] === 1 && cr[1] === 1
          ? "4:4:4"
          : cb[0] === 1 && cb[1] === 1 && cr[0] === 1 && cr[1] === 1
            ? "4:2:2"
            : cb[0] === 2 && cb[1] === 2
              ? "4:2:0"
              : `${y[0]}x${y[1]}/${cb[0]}x${cb[1]}`;
    }
  } catch {
    /* best-effort */
  }
  return result;
}

// IJG (libjpeg) luminance table — used for quality estimation.
const IJG_STD_LUMA = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

function estimateJpegQuality(table: number[]): number | null {
  // Invert IJG scaling: scale = table[i]*100/std[i]; derive quality per cell.
  const qualities: number[] = [];
  for (let i = 0; i < table.length; i++) {
    const std = IJG_STD_LUMA[i];
    if (!std || !table[i]) continue;
    const scale = (table[i] * 100) / std;
    if (scale <= 0) continue;
    const q = scale >= 100 ? 5000 / scale : (200 - scale) / 2;
    if (q >= 1 && q <= 100) qualities.push(q);
  }
  if (qualities.length < 20) return null;
  qualities.sort((a, b) => a - b);
  return Math.round(qualities[Math.floor(qualities.length / 2)]);
}

// ─── Pixel layer (sharp) ──────────────────────────────────────────────────────

export interface PixelStats {
  decoded: boolean;
  width: number;
  height: number;
  lumaMean: number;
  lumaStd: number;
  laplacianVariance: number; // high-frequency / sharpness proxy
  lsbRatios: { r: number; g: number; b: number };
  channelMeans: { r: number; g: number; b: number };
  channelStds: { r: number; g: number; b: number };
  saturationMean: number;
}

export async function extractPixelStats(buffer: Buffer): Promise<PixelStats | { decoded: false; reason: string }> {
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const image = sharp(buffer, { failOn: "none" });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return { decoded: false, reason: "no dimensions" };
    const pixels = meta.width * meta.height;
    if (pixels > 40_000_000) return { decoded: false, reason: `image too large for pixel analysis (${meta.width}x${meta.height})` };

    const { data, info } = await image
      .clone()
      .resize(Math.min(meta.width, 512), Math.min(meta.height, 512), { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    const n = w * h;
    const luma = new Float32Array(n);
    let rSum = 0, gSum = 0, bSum = 0;
    let lsbR = 0, lsbG = 0, lsbB = 0;
    let satSum = 0;
    let sampled = 0;

    for (let i = 0; i < n; i++) {
      const r = data[i * 3];
      const g = data[i * 3 + 1];
      const b = data[i * 3 + 2];
      rSum += r; gSum += g; bSum += b;
      lsbR += r & 1; lsbG += g & 1; lsbB += b & 1;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      satSum += mx === 0 ? 0 : (mx - mn) / mx;
      luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      sampled++;
    }

    let lSum = 0, lSq = 0;
    for (let i = 0; i < n; i++) {
      lSum += luma[i];
      lSq += luma[i] * luma[i];
    }
    const lMean = lSum / n;
    const lStd = Math.sqrt(Math.max(lSq / n - lMean * lMean, 0));

    // Laplacian (4-neighbour) variance on the downsampled luma — sharpness/noise proxy
    const lap: number[] = [];
    for (let y = 1; y < h - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2) {
        const idx = y * w + x;
        const v = 4 * luma[idx] - luma[idx - 1] - luma[idx + 1] - luma[idx - w] - luma[idx + w];
        lap.push(v);
      }
    }
    const lapMean = lap.reduce((a, b) => a + b, 0) / Math.max(lap.length, 1);
    const lapVar = lap.reduce((a, b) => a + (b - lapMean) ** 2, 0) / Math.max(lap.length, 1);

    const channelStd = (ch: number): number => {
      let s = 0, sq = 0;
      for (let i = 0; i < n; i++) {
        const v = data[i * 3 + ch];
        s += v;
        sq += v * v;
      }
      const m = s / n;
      return Math.sqrt(Math.max(sq / n - m * m, 0));
    };

    return {
      decoded: true,
      width: meta.width,
      height: meta.height,
      lumaMean: round(lMean),
      lumaStd: round(lStd),
      laplacianVariance: round(lapVar),
      lsbRatios: { r: round(lsbR / sampled), g: round(lsbG / sampled), b: round(lsbB / sampled) },
      channelMeans: { r: round(rSum / sampled), g: round(gSum / sampled), b: round(bSum / sampled) },
      channelStds: { r: round(channelStd(0)), g: round(channelStd(1)), b: round(channelStd(2)) },
      saturationMean: round(satSum / sampled),
    };
  } catch (error) {
    return { decoded: false, reason: error instanceof Error ? error.message : "decode failed" };
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function maxPixelDimension(): number {
  return config.security.maxUploadMb > 50 ? 8000 : 8000;
}

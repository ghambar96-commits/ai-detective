/**
 * Unit tests — image pipeline: metadata parsing, JPEG structure, PNG chunks,
 * pixel statistics and the 4 image detectors. Real crafted PNG/JPEG buffers.
 */
import { describe, test, expect } from "bun:test";
import {
  extractImageMetadata,
  extractJpegStructure,
  extractPixelStats,
  isGenAiSoftware,
  isEditorSoftware,
  parsePngTextChunks,
} from "@/lib/aidetective/features/image-features";
import { imageFeaturesExtractor } from "@/lib/aidetective/features/extractors";
import { builtinDetectors } from "@/lib/aidetective/detectors/register";
import { buildPng, buildJpegHeaders } from "../helpers/fixtures";
import type { Detector, DetectorContext } from "@/lib/aidetective/core/types";

const imageDetectors = builtinDetectors.filter((d) => d.modalities.includes("image"));

describe("image metadata layer", () => {
  test("clean PNG: dimensions parsed from IHDR, no EXIF", () => {
    const png = buildPng({ width: 320, height: 240 });
    const meta = extractImageMetadata(png, "png");
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
    expect(meta.format).toBe("png");
    expect(meta.camera.make).toBeNull();
    expect(meta.camera.model).toBeNull();
  });

  test("PNG tEXt chunks are parsed (key/value)", () => {
    const png = buildPng({ width: 16, height: 16, textChunks: [["Software", "Midjourney"], ["Comment", "hello"]] });
    const chunks = parsePngTextChunks(png);
    expect(chunks).toContainEqual({ key: "Software", value: "Midjourney" });
    expect(chunks).toContainEqual({ key: "Comment", value: "hello" });
  });

  test("gen-AI software matcher hits known tools (case-insensitive)", () => {
    const png = buildPng({ width: 16, height: 16, textChunks: [["Software", "Stable Diffusion XL"]] });
    const meta = extractImageMetadata(png, "png");
    expect(isGenAiSoftware(meta.software, meta.pngTextChunks)).toBe("stable diffusion");
    expect(isEditorSoftware("Adobe Photoshop 2024")).toBe("photoshop");
    expect(isEditorSoftware("gimp 2.10")).toBe("gimp");
    expect(isGenAiSoftware("Lightroom", [])).toBeNull();
  });

  test("JPEG structure parser: SOF dimensions, DQT quality, 4:2:0 subsampling", () => {
    const jpeg = buildJpegHeaders({ width: 1024, height: 768, quality: 92 });
    const s = extractJpegStructure(jpeg);
    expect(s.width).toBe(1024);
    expect(s.height).toBe(768);
    expect(s.hasQuantTables).toBe(true);
    expect(s.qualityEstimate).toBeGreaterThan(80);
    expect(s.qualityEstimate).toBeLessThanOrEqual(100);
    expect(s.chromaSubsampling).toBe("4:2:0");
    expect(s.progressive).toBe(false);
  });

  test("JPEG structure parser: progressive flag on SOF2", () => {
    const base = buildJpegHeaders({ width: 64, height: 64, quality: 80 });
    // swap SOF0 (0xc0) → SOF2 (0xc2)
    const idx = base.indexOf(Buffer.from([0xff, 0xc0]));
    base[idx + 1] = 0xc2;
    expect(extractJpegStructure(base).progressive).toBe(true);
  });

  test("garbage buffer does not crash metadata parsing", () => {
    const meta = extractImageMetadata(Buffer.from([1, 2, 3, 4, 5]), "jpg");
    expect(meta.width).toBeNull();
    expect(meta.height).toBeNull();
  });
});

describe("image pixel layer (sharp)", () => {
  test("real PNG decodes with deterministic statistics", async () => {
    const png = buildPng({
      width: 64,
      height: 64,
      pixel: (x, y) => [Math.round((x / 63) * 255), Math.round((y / 63) * 255), 128],
    });
    const a = await extractPixelStats(png);
    const b = await extractPixelStats(png);
    expect(a.decoded).toBe(true);
    expect(b.decoded).toBe(true);
    expect(a).toEqual(b);
    if (a.decoded) {
      expect(a.width).toBe(64);
      expect(a.height).toBe(64);
      expect(a.lumaMean).toBeGreaterThan(0);
      expect(a.lsbRatios.r).toBeGreaterThanOrEqual(0);
      expect(a.lsbRatios.r).toBeLessThanOrEqual(1);
    }
  });

  test("undecodable buffer reports decoded:false with a reason", async () => {
    const out = await extractPixelStats(Buffer.from("not an image at all"));
    expect(out.decoded).toBe(false);
    if (!out.decoded) expect(out.reason).toBeTruthy();
  });
});

describe("image feature extractor adapter", () => {
  test("produces complete feature set for a PNG", async () => {
    const png = buildPng({ width: 48, height: 32 });
    const features = await imageFeaturesExtractor.extract({
      input: { kind: "image", buffer: png },
      modality: "image",
    });
    expect(features.imageFormat).toBe("png");
    expect(features.imageWidth).toBe(48);
    expect(features.imageHeight).toBe(32);
    expect(features.pngBitDepth).toBe(8);
    expect(features.pngColorType).toBe(2);
    expect((features.pixelStats as { decoded: boolean }).decoded).toBe(true);
  });
});

describe("image detectors: contract + determinism + direction", () => {
  function ctxFor(buffer: Buffer, features: Record<string, unknown>): DetectorContext {
    return { input: { kind: "image", buffer }, modality: "image", features, options: {} };
  }

  for (const detector of imageDetectors) {
    test(`${detector.id}: deterministic on a clean PNG`, async () => {
      const png = buildPng({ width: 512, height: 512 });
      const features = await imageFeaturesExtractor.extract({ input: { kind: "image", buffer: png }, modality: "image" });
      const ctx = ctxFor(png, features);
      const a = await detector.analyze(ctx);
      const b = await detector.analyze(ctx);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(["ok", "skipped"]).toContain(a.status);
    });
  }

  test("metadata detector: gen-AI tag → strong AI signal (0.95); clean PNG → weak", async () => {
    const meta = imageDetectors.find((d) => d.id === "image.metadata")!;
    const aiPng = buildPng({ width: 64, height: 64, textChunks: [["Software", "Midjourney v6"]] });
    const cleanPng = buildPng({ width: 64, height: 64 });

    const aiFeatures = await imageFeaturesExtractor.extract({ input: { kind: "image", buffer: aiPng }, modality: "image" });
    const cleanFeatures = await imageFeaturesExtractor.extract({ input: { kind: "image", buffer: cleanPng }, modality: "image" });

    const aiResult = await meta.analyze(ctxFor(aiPng, aiFeatures));
    const cleanResult = await meta.analyze(ctxFor(cleanPng, cleanFeatures));

    const aiSignal = aiResult.signals.find((s) => s.id.endsWith("genai_tag"));
    expect(aiSignal).toBeDefined();
    expect(aiSignal!.aiScore).toBe(0.95);
    expect(cleanResult.signals[0].aiScore!).toBeLessThan(aiSignal!.aiScore!);
  });

  test("dimensions detector: 1024×1024 (known canvas) → 0.75; odd size → 0.3", async () => {
    const dim = imageDetectors.find((d) => d.id === "image.dimensions")!;
    const known = await dim.analyze(ctxFor(Buffer.alloc(0), { imageWidth: 1024, imageHeight: 1024 }));
    const odd = await dim.analyze(ctxFor(Buffer.alloc(0), { imageWidth: 1023, imageHeight: 767 }));
    expect(known.signals[0].aiScore).toBe(0.75);
    expect(odd.signals[0].aiScore).toBe(0.3);
  });

  test("compression detector: JPEG quality recorded; PNG profile is descriptive", async () => {
    const comp = imageDetectors.find((d) => d.id === "image.compression")!;
    const jpeg = buildJpegHeaders({ width: 512, height: 512, quality: 95 });
    const jpegResult = await comp.analyze(ctxFor(jpeg, {
      imageFormat: "jpg",
      jpegStructure: extractJpegStructure(jpeg),
    }));
    expect(jpegResult.status).toBe("ok");
    expect(jpegResult.signals[0].aiScore).toBeGreaterThanOrEqual(0.5);

    const png = buildPng({ width: 8, height: 8 });
    const pngResult = await comp.analyze(ctxFor(png, { imageFormat: "png", pngBitDepth: 8, pngColorType: 2 }));
    expect(pngResult.signals[0].aiScore).toBe(0.5); // neutral by design
  });

  test("pixel-stats detector: skips undecoded buffers with an honest reason", async () => {
    const px = imageDetectors.find((d) => d.id === "image.pixel_stats")!;
    const result = await px.analyze(ctxFor(Buffer.alloc(0), { pixelStats: { decoded: false, reason: "unit-test reason" } }));
    expect(result.status).toBe("skipped");
    expect(result.summary).toContain("unit-test reason");
  });
});

/**
 * Unit tests — audio pipeline: WAV header/PCM decoding, waveform statistics,
 * ID3/FLAC/M4A metadata parsing and the 2 audio detectors.
 * Real crafted WAV/MP3/FLAC/M4A buffers.
 */
import { describe, test, expect } from "bun:test";
import {
  parseWavHeader,
  extractWaveformStats,
  parseId3Tags,
  parseFlacMetadata,
  parseM4aMetadata,
  parseWavTags,
} from "@/lib/aidetective/features/audio-features";
import { audioFeaturesExtractor } from "@/lib/aidetective/features/extractors";
import { builtinDetectors } from "@/lib/aidetective/detectors/register";
import { buildWav, buildWavWithSoftwareTag, buildMp3, buildFlac, buildM4a } from "../helpers/fixtures";
import type { Detector, DetectorContext } from "@/lib/aidetective/core/types";

const audioDetectors = builtinDetectors.filter((d) => d.modalities.includes("audio"));

describe("WAV header parsing", () => {
  test("PCM16 mono 8kHz header fields + duration", () => {
    const wav = buildWav({ sampleRate: 8000, durationSec: 0.5 });
    const info = parseWavHeader(wav);
    expect(info).not.toBeNull();
    expect(info!.audioFormat).toBe(1);
    expect(info!.channels).toBe(1);
    expect(info!.sampleRate).toBe(8000);
    expect(info!.bitsPerSample).toBe(16);
    expect(info!.durationSec).toBeCloseTo(0.5, 1);
  });

  test("non-WAV buffer → null", () => {
    expect(parseWavHeader(Buffer.from("garbage data"))).toBeNull();
  });
});

describe("waveform statistics (deterministic PCM decoding)", () => {
  test("pure sine: known RMS ≈ amplitude/√2, peak ≈ amplitude", () => {
    const wav = buildWav({ sampleRate: 8000, durationSec: 1, generator: (t) => 0.8 * Math.sin(2 * Math.PI * 440 * t) });
    const info = parseWavHeader(wav)!;
    const stats = extractWaveformStats(wav, info);
    expect(stats.decoded).toBe(true);
    expect(stats.samples).toBe(8000);
    // sine RMS = 0.8/√2 ≈ 0.5657 (windowed over 50ms windows = exact multiples)
    expect(stats.rmsMean).toBeGreaterThan(0.54);
    expect(stats.rmsMean).toBeLessThan(0.59);
    expect(stats.peak).toBeGreaterThan(0.79);
    expect(stats.peak).toBeLessThanOrEqual(1);
    expect(stats.dcOffset).toBeCloseTo(0, 2);
    expect(stats.clippingRatio).toBe(0);
  });

  test("silence → zero RMS and full silence ratio", () => {
    const wav = buildWav({ sampleRate: 4000, durationSec: 0.25, generator: () => 0 });
    const info = parseWavHeader(wav)!;
    const stats = extractWaveformStats(wav, info);
    expect(stats.decoded).toBe(true);
    expect(stats.rmsMean).toBe(0);
    expect(stats.silenceRatio).toBe(1);
  });

  test("clipped square wave: peak = 1, clipping recorded", () => {
    const wav = buildWav({
      sampleRate: 4000,
      durationSec: 0.25,
      generator: (t) => (Math.sin(2 * Math.PI * 100 * t) >= 0 ? 1 : -1),
    });
    const info = parseWavHeader(wav)!;
    const stats = extractWaveformStats(wav, info);
    expect(stats.decoded).toBe(true);
    expect(stats.peak).toBe(1);
    expect(stats.clippingRatio).toBe(1);
  });

  test("determinism: identical buffer → identical stats", () => {
    const wav = buildWav({ durationSec: 0.3 });
    const info = parseWavHeader(wav)!;
    expect(extractWaveformStats(wav, info)).toEqual(extractWaveformStats(wav, info));
  });

  test("unsupported bit depth → decoded:false with honest reason", () => {
    const wav = buildWav({ durationSec: 0.1 });
    wav.writeUInt16LE(24, 34); // claim 24-bit
    const info = parseWavHeader(wav)!;
    const stats = extractWaveformStats(wav, info);
    expect(stats.decoded).toBe(false);
    expect(stats.reason).toContain("24-bit");
  });
});

describe("container metadata parsers", () => {
  test("WAV LIST/INFO ISFT tag parsed as encoder", () => {
    const wav = buildWavWithSoftwareTag("coqui-tts");
    const tags = parseWavTags(wav);
    expect(tags.container).toBe("wav");
    expect(tags.encoder).toContain("coqui");
    expect(tags.softwareHints.length).toBeGreaterThan(0);
  });

  test("MP3 ID3v2.3: title/encoder parsed; TTS encoder flagged as software hint", () => {
    const mp3 = buildMp3({ title: "generated speech", encoder: "Bark TTS engine" });
    const tags = parseId3Tags(mp3);
    expect(tags.container).toBe("mp3");
    expect(tags.title).toBe("generated speech");
    expect(tags.encoder).toContain("Bark");
    expect(tags.softwareHints.join(" ").toLowerCase()).toContain("bark");
    expect(tags.bitrateKbps).toBe(128);
    expect(tags.sampleRate).toBe(44100);
  });

  test("MP3 without TTS tags → no software hints", () => {
    const tags = parseId3Tags(buildMp3({ title: "live recording", encoder: "LAME3.100" }));
    expect(tags.softwareHints).toEqual([]);
  });

  test("FLAC STREAMINFO: sample rate + duration", () => {
    const flac = buildFlac(44100, 22050);
    const tags = parseFlacMetadata(flac);
    expect(tags.container).toBe("flac");
    expect(tags.sampleRate).toBe(44100);
    expect(tags.durationSec).toBeCloseTo(0.5, 1);
    expect(tags.channels).toBe(1);
  });

  test("M4A metadata parses without crashing (limited MVP support)", () => {
    const tags = parseM4aMetadata(buildM4a());
    expect(tags.container).toBe("m4a");
  });
});

describe("audio feature extractor adapter", () => {
  test("WAV: full waveform stats present", async () => {
    const wav = buildWav({ durationSec: 0.2 });
    const features = await audioFeaturesExtractor.extract({ input: { kind: "audio", buffer: wav }, modality: "audio" });
    expect(features.audioContainer).toBe("wav");
    const wf = features.waveformStats as { decoded: boolean; samples: number };
    expect(wf.decoded).toBe(true);
    expect(wf.samples).toBeGreaterThan(0);
  });

  test("non-WAV: honest metadata-only mode with explicit reason", async () => {
    const features = await audioFeaturesExtractor.extract({ input: { kind: "audio", buffer: buildMp3({}) }, modality: "audio" });
    const wf = features.waveformStats as { decoded: boolean; reason?: string };
    expect(wf.decoded).toBe(false);
    expect(wf.reason).toContain("not implemented");
  });
});

describe("audio detectors: contract + determinism", () => {
  function ctxFor(buffer: Buffer, features: Record<string, unknown>): DetectorContext {
    return { input: { kind: "audio", buffer }, modality: "audio", features, options: {} };
  }

  for (const detector of audioDetectors) {
    test(`${detector.id}: deterministic on a real WAV`, async () => {
      const wav = buildWav({ durationSec: 0.2 });
      const features = await audioFeaturesExtractor.extract({ input: { kind: "audio", buffer: wav }, modality: "audio" });
      const a = await detector.analyze(ctxFor(wav, features));
      const b = await detector.analyze(ctxFor(wav, features));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.status).toBe("ok");
      expect(a.signals.length).toBeGreaterThan(0);
    });
  }

  test("metadata detector: TTS hint → 0.93 AI signal; plain WAV → ≤ 0.55", async () => {
    const meta = audioDetectors.find((d) => d.id === "audio.metadata")!;
    const ttsWav = buildWavWithSoftwareTag("elevenlabs");
    const plainWav = buildWav({ durationSec: 0.2 });

    const ttsFeatures = await audioFeaturesExtractor.extract({ input: { kind: "audio", buffer: ttsWav }, modality: "audio" });
    const plainFeatures = await audioFeaturesExtractor.extract({ input: { kind: "audio", buffer: plainWav }, modality: "audio" });

    const ttsSignal = (await meta.analyze(ctxFor(ttsWav, ttsFeatures))).signals[0];
    const plainSignal = (await meta.analyze(ctxFor(plainWav, plainFeatures))).signals[0];
    expect(ttsSignal.id).toContain("tts_tag");
    expect(ttsSignal.aiScore).toBe(0.93);
    expect(plainSignal.aiScore!).toBeLessThanOrEqual(0.55);
  });

  test("waveform detector runs on WAV and reports statistics honestly", async () => {
    const wf = audioDetectors.find((d) => d.id === "audio.waveform")!;
    const wav = buildWav({ durationSec: 0.2 });
    const features = await audioFeaturesExtractor.extract({ input: { kind: "audio", buffer: wav }, modality: "audio" });
    const result = await wf.analyze(ctxFor(wav, features));
    expect(result.status).toBe("ok");
    expect(result.signals[0].aiScore).toBeGreaterThanOrEqual(0);
    expect(result.signals[0].aiScore).toBeLessThanOrEqual(1);
  });
});

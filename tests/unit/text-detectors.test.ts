/**
 * Unit tests — all builtin text detectors.
 * Contract checks + determinism guarantees (same input twice → identical output).
 */
import { describe, test, expect } from "bun:test";
import { builtinDetectors } from "@/lib/aidetective/detectors/register";
import { extractTextFeatures } from "@/lib/aidetective/features/text-features";
import type { Detector, DetectorContext } from "@/lib/aidetective/core/types";
import { AI_TEXT, HUMAN_TEXT, SHORT_TEXT } from "../helpers/fixtures";

const textDetectors = builtinDetectors.filter((d) => d.modalities.includes("text"));
const imageDetectors = builtinDetectors.filter((d) => d.modalities.includes("image"));
const audioDetectors = builtinDetectors.filter((d) => d.modalities.includes("audio"));

function ctxFor(text: string): DetectorContext {
  return {
    input: { kind: "text", text },
    modality: "text",
    features: { textFeatures: extractTextFeatures(text) },
    options: {},
  };
}

async function runDeterministic(detector: Detector, ctx: DetectorContext) {
  const a = await detector.analyze(ctx);
  const b = await detector.analyze(ctx);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  return a;
}

describe("detector registry composition", () => {
  test("9 text, 4 image, 2 audio builtin detectors are registered", () => {
    expect(textDetectors.length).toBe(9);
    expect(imageDetectors.length).toBe(4);
    expect(audioDetectors.length).toBe(2);
    expect(builtinDetectors.length).toBe(15);
  });

  test("every detector exposes honest metadata", () => {
    for (const d of builtinDetectors) {
      expect(d.id).toMatch(/^(text|image|audio|document)\./);
      expect(d.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(d.description.length).toBeGreaterThan(20);
      expect(d.limitations.length).toBeGreaterThan(0);
      expect(d.defaultWeight).toBeGreaterThan(0);
      expect(d.defaultWeight).toBeLessThanOrEqual(1);
      expect(d.modalities.length).toBeGreaterThan(0);
    }
    // unique ids
    const ids = builtinDetectors.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("text detectors: contract + determinism", () => {
  for (const detector of textDetectors) {
    test(`${detector.id}: deterministic on AI text, valid signal shape`, async () => {
      const ctx = ctxFor(AI_TEXT);
      const result = await runDeterministic(detector, ctx);
      expect(["ok", "skipped", "error"]).toContain(result.status);
      for (const s of result.signals) {
        expect(s.detectorId).toBe(detector.id);
        if (s.aiScore !== null) {
          expect(s.aiScore).toBeGreaterThanOrEqual(0);
          expect(s.aiScore).toBeLessThanOrEqual(1);
        }
        expect(s.weight).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(s.evidence)).toBe(true);
      }
    });

    test(`${detector.id}: deterministic on human text + never crashes on short text`, async () => {
      await runDeterministic(detector, ctxFor(HUMAN_TEXT));
      const short = await runDeterministic(detector, ctxFor(SHORT_TEXT));
      expect(["ok", "skipped"]).toContain(short.status);
    });
  }
});

describe("text detectors: directional behaviour", () => {
  test("burstiness: human bursty text has higher CV and lower AI score than uniform AI text", async () => {
    const d = textDetectors.find((x) => x.id === "text.burstiness")!;
    const ai = (await d.analyze(ctxFor(AI_TEXT))).signals[0];
    const human = (await d.analyze(ctxFor(HUMAN_TEXT))).signals[0];
    expect(ai).toBeDefined();
    expect(human).toBeDefined();
    const aiFeatures = extractTextFeatures(AI_TEXT);
    const humanFeatures = extractTextFeatures(HUMAN_TEXT);
    expect(humanFeatures.sentenceLengths.cv).toBeGreaterThan(aiFeatures.sentenceLengths.cv);
    expect(human.aiScore!).toBeLessThan(ai.aiScore!);
  });

  test("phrases: AI text has phrase hits with quoted evidence; human text has none", async () => {
    const d = textDetectors.find((x) => x.id === "text.phrases")!;
    const ai = (await d.analyze(ctxFor(AI_TEXT))).signals[0];
    const human = (await d.analyze(ctxFor(HUMAN_TEXT))).signals[0];
    expect(ai.aiScore!).toBeGreaterThan(0.5);
    expect(human.aiScore!).toBeLessThanOrEqual(0.5);
    const evidenceJson = JSON.stringify(ai.evidence);
    expect(evidenceJson).toContain("quote");
  });

  test("informality: human text scores lower (more human-leaning) than AI text", async () => {
    const d = textDetectors.find((x) => x.id === "text.informality")!;
    const ai = (await d.analyze(ctxFor(AI_TEXT))).signals[0];
    const human = (await d.analyze(ctxFor(HUMAN_TEXT))).signals[0];
    expect(human.aiScore!).toBeLessThan(ai.aiScore!);
  });

  test("detectors marked unreliable for short input include notes or skip", async () => {
    const burstiness = textDetectors.find((x) => x.id === "text.burstiness")!;
    const result = await burstiness.analyze(ctxFor(SHORT_TEXT));
    const signal = result.signals[0];
    if (signal) {
      expect(signal.notes).toBeTruthy();
    }
  });
});

describe("text detectors: Persian support (experimental)", () => {
  test("Persian AI-phrase list fires on Persian AI-style text", async () => {
    const faAiText = `در دنیای امروز هوش مصنوعی نقش مهمی ایفا می‌کند. شایان ذکر است که این فناوری بدون شک یکی از مهم‌ترین دستاوردهاست. علاوه بر این، در عصر حاضر نقش حیاتی ایفا کرده و گنجینه‌ای از دانش را در اختیار ما می‌گذارد. در نتیجه می‌توان گفت که این ابزار پنجره‌ای به دنیای تازه‌ای است. جالب است بدانید که سفری به دنیای هوش مصنوعی آغاز شده و به جرأت می‌توان گفت آینده روشنی پیش روست. بنابراین لازم به ذکر است که این تحول ادامه خواهد داشت و در نهایت همه جانبه خواهد بود.`;
    const d = textDetectors.find((x) => x.id === "text.phrases")!;
    const result = await runDeterministic(d, ctxFor(faAiText));
    expect(result.signals[0].aiScore!).toBeGreaterThan(0.5);
  });
});

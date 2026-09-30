/**
 * Unit tests — text feature extraction (features/text-features.ts).
 * Pure statistics: deterministic, no network, no ML.
 */
import { describe, test, expect } from "bun:test";
import { extractTextFeatures, AI_PHRASES_STRONG_EN } from "@/lib/aidetective/features/text-features";
import { AI_TEXT, HUMAN_TEXT, SHORT_TEXT } from "../helpers/fixtures";

describe("text features: basics", () => {
  const f = extractTextFeatures(AI_TEXT);

  test("counts words, sentences, paragraphs", () => {
    expect(f.wordCount).toBeGreaterThan(120);
    expect(f.sentenceCount).toBeGreaterThan(5);
    expect(f.charCount).toBe(AI_TEXT.replace(/\r\n/g, "\n").length);
  });

  test("language detection en/fa/mixed", () => {
    expect(f.language).toBe("en");
    const fa = extractTextFeatures("این یک متن آزمایشی به زبان فارسی است. هوش مصنوعی نقش مهمی ایفا می‌کند.");
    expect(fa.language).toBe("fa");
    const mixed = extractTextFeatures("Hello world این متن فارسی است hello again بیشتر متن اینجا");
    expect(mixed.language).toBe("mixed");
  });

  test("sentence length stats are consistent", () => {
    expect(f.sentenceLengths.min).toBeGreaterThan(0);
    expect(f.sentenceLengths.max).toBeGreaterThanOrEqual(f.sentenceLengths.min);
    expect(f.sentenceLengths.cv).toBeGreaterThanOrEqual(0);
    expect(f.sentenceLengths.buckets.reduce((a, b) => a + b, 0)).toBe(f.sentenceCount);
  });

  test("vocabulary metrics within valid ranges", () => {
    expect(f.vocabulary.ttr).toBeGreaterThan(0);
    expect(f.vocabulary.ttr).toBeLessThanOrEqual(1);
    expect(f.vocabulary.entropyNorm).toBeGreaterThan(0);
    expect(f.vocabulary.entropyNorm).toBeLessThanOrEqual(1);
    expect(f.vocabulary.unique).toBeLessThanOrEqual(f.wordCount);
  });
});

describe("text features: AI phrase detection", () => {
  test("AI text contains known strong phrases; human text does not", () => {
    const ai = extractTextFeatures(AI_TEXT);
    const human = extractTextFeatures(HUMAN_TEXT);
    expect(ai.phrases.strongCount).toBeGreaterThan(0);
    expect(human.phrases.strongCount).toBe(0);
    // every reported hit must be a real phrase from the list
    const list = AI_PHRASES_STRONG_EN;
    for (const hit of ai.phrases.strongHits) {
      expect(list).toContain(hit.phrase);
      expect(hit.example.length).toBeGreaterThan(0);
    }
  });
});

describe("text features: burstiness contrast", () => {
  test("human-style text has higher sentence-length variability than AI-style text", () => {
    const ai = extractTextFeatures(AI_TEXT);
    const human = extractTextFeatures(HUMAN_TEXT);
    expect(human.sentenceLengths.cv).toBeGreaterThan(ai.sentenceLengths.cv);
  });
});

describe("text features: informality markers", () => {
  test("informal text scores higher on informality", () => {
    const ai = extractTextFeatures(AI_TEXT);
    const human = extractTextFeatures(HUMAN_TEXT);
    expect(human.informality.informalHits).toBeGreaterThan(ai.informality.informalHits);
    expect(human.informality.emojiCount + human.informality.elongations).toBeGreaterThan(0);
  });
});

describe("text features: determinism", () => {
  test("identical input → identical feature object (incl. content hash)", () => {
    const a = extractTextFeatures(AI_TEXT);
    const b = extractTextFeatures(AI_TEXT);
    expect(a).toEqual(b);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("different input → different hash", () => {
    expect(extractTextFeatures(AI_TEXT).contentHash).not.toBe(extractTextFeatures(HUMAN_TEXT).contentHash);
  });
});

describe("text features: edge cases", () => {
  test("short text does not crash and reports low counts", () => {
    const f = extractTextFeatures(SHORT_TEXT);
    expect(f.wordCount).toBeGreaterThan(0);
    expect(f.sentenceCount).toBeGreaterThan(0);
    expect(f.wordCount).toBeLessThan(10);
  });

  test("empty string produces zeroed, non-crashing features", () => {
    const f = extractTextFeatures("");
    expect(f.wordCount).toBe(0);
    expect(f.sentenceCount).toBe(0);
    expect(f.vocabulary.ttr).toBe(0);
  });

  test("markdown is not auto-stripped here (parser responsibility)", () => {
    const f = extractTextFeatures("# Heading\n\n**bold** text");
    expect(f.wordCount).toBeGreaterThan(0);
  });
});

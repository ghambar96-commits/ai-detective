/**
 * AIDetective — text feature extraction.
 * Pure, deterministic statistics. No ML, no LLM, no network.
 * These features are the raw material detectors interpret; they are kept
 * separate from interpretation so new detectors can reuse them.
 */
import { createHash } from "crypto";

// ─── AI-leaning phrase lists (tiered) ─────────────────────────────────────────
// Tier "strong": rarely used by humans in flowing prose, common in LLM output.
// Tier "weak": over-represented in LLM output but common in human formal writing too.

export const AI_PHRASES_STRONG_EN = [
  "as an ai", "i cannot provide", "i apologize for the confusion", "certainly! here",
  "of course! here", "delve into", "delves into", "delving into", "tapestry",
  "testament to", "in the realm of", "in today's fast-paced", "ever-evolving",
  "ever-changing landscape", "navigate the complexities", "navigating the complexities",
  "unlock the potential", "unleash the power", "harness the power", "embark on a journey",
  "beacon of", "symphony of", "dance of", "kaleidoscope of", "pivotal role",
  "plays a crucial role", "plays a vital role", "serves as a testament",
  "it is important to note", "it's important to note", "it is worth noting",
  "it's worth noting", "in conclusion,", "in summary,", "to summarize,",
];

export const AI_PHRASES_WEAK_EN = [
  "moreover,", "furthermore,", "additionally,", "however, it is", "on the other hand,",
  "overall,", "significantly", "notably,", "crucial", "seamless", "robust framework",
  "in today's world", "in the modern", "a double-edged sword", "when it comes to",
  "at the end of the day", "landscape of",
];

export const AI_PHRASES_STRONG_FA = [
  "به عنوان یک هوش مصنوعی", "در دنیای امروز", "در جهان امروز", "در عصر حاضر",
  "نقش مهمی ایفا", "نقش حیاتی ایفا", "شایان ذکر است", "لازم به ذکر است",
  "در نتیجه می‌توان", "جالب است بدانید", "سفری به دنیای", "پنجره‌ای به دنیای",
  "به جرأت می‌توان گفت", "گنجینه‌ای از", "همگواری", "بدون شک یکی از",
];

export const AI_PHRASES_WEAK_FA = [
  "علاوه بر این", "بنابراین", "به طور کلی", "در این راستا", "در ادامه",
  "همچنین", "به عبارت دیگر", "از سوی دیگر", "در نهایت", "چکیده",
];

// Human-leaning markers
const INFORMAL_MARKERS = /\b(lol|lmao|omg|haha+|hehe+|btw|idk|imo|fyi|tbh|ngl|pls|plz|thx|u|ur|cant|dont|wanna|gonna|kinda|sorta|yeah|yep|nope|ok|okay|hm+|uh+|um+)\b/gi;
const CONTRACTIONS = /\b\w+(?:n't|'re|'ve|'ll|'d|'m)\b/gi;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const ELONGATION = /(.)\1{2,}/g; // sooo, woooow
const MULTI_PUNCT = /([!?]){2,}|[!?]{1,}\s*[!?]+/g;

const COMMON_CONNECTIVES_EN = [
  "furthermore", "moreover", "additionally", "however", "therefore", "thus",
  "consequently", "nevertheless", "nonetheless", "overall", "ultimately", "in addition",
];

const COMMON_CONNECTIVES_FA = [
  "بنابراین", "درنتیجه", "در نتیجه", "علاوه", "همچنین", "اما",
  "هرچند", "با این حال", "درعوض", "سپس", "نهایتا",
];

export interface TextFeatures {
  charCount: number;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  language: "fa" | "en" | "mixed";
  sentenceLengths: { mean: number; std: number; cv: number; min: number; max: number; buckets: number[] };
  paragraphLengths: { mean: number; std: number; cv: number };
  wordLength: { mean: number };
  vocabulary: { unique: number; ttr: number; rootTtr: number; hapaxRatio: number; entropyNorm: number };
  punctuation: {
    per1k: Record<string, number>;
    exclaimPerSentence: number;
    questionPerSentence: number;
    commaPerSentence: number;
    multiPunctCount: number;
    ellipsisCount: number;
  };
  phrases: {
    strongHits: Array<{ phrase: string; example: string }>;
    strongCount: number;
    weakCount: number;
    strongPer1k: number;
    weakPer1k: number;
  };
  connectives: { count: number; perSentence: number; sentenceStarters: number };
  repetition: {
    maxQuadgramFreq: number;
    repeatedQuadgrams: number;
    topRepeated: Array<{ ngram: string; count: number }>;
  };
  informality: {
    informalHits: number;
    contractionCount: number;
    emojiCount: number;
    elongations: number;
    allCapsWords: number;
    repeatedPunct: number;
  };
  casing: { startsCapitalRatio: number; endsPunctRatio: number };
  digitsRatio: number;
  doubleSpaces: number;
  contentHash: string;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
}

function findPhraseExamples(text: string, phrase: string, maxExamples: number): Array<{ phrase: string; example: string }> {
  const results: Array<{ phrase: string; example: string }> = [];
  const lower = text.toLowerCase();
  let idx = lower.indexOf(phrase);
  while (idx !== -1 && results.length < maxExamples) {
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + phrase.length + 80);
    results.push({
      phrase,
      example: (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : ""),
    });
    idx = lower.indexOf(phrase, idx + phrase.length);
  }
  return results;
}

export function extractTextFeatures(rawText: string): TextFeatures {
  // Normalise whitespace-preserving; strip markdown noise lightly.
  const text = rawText.replace(/\r\n/g, "\n").replace(/\u0000/g, "");
  const lower = text.toLowerCase();
  const words = Array.from(text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’_]*/gu)).map((m) => m[0]);
  const sentences = Array.from(text.matchAll(/[^.!?\n]+[.!?…]+["'»)\]]*|[^.!?\n]+$/gm)).map((m) => m[0].trim()).filter((s) => s.length > 0);
  const paragraphs = text.split(/\n\s*\n+/).map((p) => p.trim()).filter((p) => p.length > 0);

  const wordCount = words.length;
  const per1k = (n: number) => (wordCount > 0 ? (n / wordCount) * 1000 : 0);

  // Language guess
  const faChars = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const enChars = (text.match(/[a-zA-Z]/g) ?? []).length;
  const totalAlpha = faChars + enChars;
  const language: TextFeatures["language"] =
    totalAlpha === 0 ? "en" : faChars / totalAlpha > 0.7 ? "fa" : enChars / totalAlpha > 0.7 ? "en" : "mixed";

  // Sentence lengths (in words)
  const sentLens = sentences.map((s) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length).filter((n) => n > 0);
  const sMean = mean(sentLens);
  const sStd = std(sentLens);

  // Paragraph lengths
  const paraLens = paragraphs.map((p) => (p.match(/[\p{L}\p{N}]+/gu) ?? []).length);
  const pMean = mean(paraLens);
  const pStd = std(paraLens);

  // Vocabulary
  const freq = new Map<string, number>();
  for (const w of words) {
    const key = w.toLowerCase();
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  const unique = freq.size;
  let hapax = 0;
  for (const c of freq.values()) if (c === 1) hapax++;
  let entropy = 0;
  for (const c of freq.values()) {
    const p = c / wordCount;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const entropyNorm = unique > 1 ? entropy / Math.log2(unique) : 0;

  // Punctuation
  const counts = {
    comma: (text.match(/,/g) ?? []).length,
    semicolon: (text.match(/;/g) ?? []).length,
    colon: (text.match(/:/g) ?? []).length,
    emDash: (text.match(/—|--/g) ?? []).length,
    paren: (text.match(/[()]/g) ?? []).length,
    quote: (text.match(/["“”«»]/g) ?? []).length,
    exclaim: (text.match(/!/g) ?? []).length,
    question: (text.match(/\?/g) ?? []).length,
    ellipsis: (text.match(/\.\.\.|…/g) ?? []).length,
    period: (text.match(/\./g) ?? []).length,
  };
  const multiPunctCount = (text.match(/([!?])\1+/g) ?? []).length;

  // AI phrases
  const strongLists = [...AI_PHRASES_STRONG_EN, ...(language === "en" ? [] : AI_PHRASES_STRONG_FA)];
  const weakLists = [...AI_PHRASES_WEAK_EN, ...(language === "en" ? [] : AI_PHRASES_WEAK_FA)];
  const strongHits: Array<{ phrase: string; example: string }> = [];
  let strongTotal = 0;
  for (const phrase of strongLists) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const hits = (lower.match(re) ?? []).length;
    if (hits > 0) {
      strongTotal += hits;
      if (strongHits.length < 8) strongHits.push(...findPhraseExamples(text, phrase, 1));
    }
  }
  let weakTotal = 0;
  for (const phrase of weakLists) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    weakTotal += (lower.match(re) ?? []).length;
  }

  // Connectives & sentence starters
  const connectiveList = language === "fa" ? COMMON_CONNECTIVES_FA : COMMON_CONNECTIVES_EN;
  let connectiveCount = 0;
  let starters = 0;
  for (const s of sentences) {
    const sl = s.toLowerCase();
    const firstWord = sl.split(/\s+/)[0]?.replace(/[^\p{L}]/gu, "") ?? "";
    if (connectiveList.includes(firstWord)) starters++;
    for (const c of connectiveList) {
      if (sl.includes(c)) {
        connectiveCount++;
        break;
      }
    }
  }

  // n-gram repetition (4-grams)
  const quadgrams = new Map<string, number>();
  for (let i = 0; i + 4 <= words.length; i++) {
    const key = words.slice(i, i + 4).join(" ").toLowerCase();
    quadgrams.set(key, (quadgrams.get(key) ?? 0) + 1);
  }
  let repeatedQuadgrams = 0;
  let maxQuadFreq = 0;
  let topRepeated: Array<{ ngram: string; count: number }> = [];
  for (const [ngram, count] of quadgrams) {
    if (count > 1) repeatedQuadgrams++;
    if (count > maxQuadFreq) maxQuadFreq = count;
  }
  if (repeatedQuadgrams > 0) {
    topRepeated = Array.from(quadgrams.entries())
      .filter(([, c]) => c > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ngram, count]) => ({ ngram, count }));
  }

  // Informality & casing
  const informalHits = (text.match(INFORMAL_MARKERS) ?? []).length;
  const contractionCount = (text.match(CONTRACTIONS) ?? []).length;
  const emojiCount = (text.match(new RegExp(EMOJI_RE, "gu")) ?? []).length;
  const elongations = (text.match(ELONGATION) ?? []).length;
  const allCapsWords = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
  const startsCapital = sentences.filter((s) => /^\p{Lu}/u.test(s.trim())).length;
  const endsPunct = sentences.filter((s) => /[.!?…]["'»)\]]*$/.test(s.trim())).length;

  const buckets = [0, 0, 0, 0, 0, 0]; // 1-5,6-10,11-15,16-20,21-30,31+
  for (const len of sentLens) {
    if (len <= 5) buckets[0]++;
    else if (len <= 10) buckets[1]++;
    else if (len <= 15) buckets[2]++;
    else if (len <= 20) buckets[3]++;
    else if (len <= 30) buckets[4]++;
    else buckets[5]++;
  }

  return {
    charCount: text.length,
    wordCount,
    sentenceCount: sentLens.length,
    paragraphCount: paragraphs.length,
    language,
    sentenceLengths: {
      mean: r2(sMean),
      std: r2(sStd),
      cv: sMean > 0 ? r2(sStd / sMean) : 0,
      min: sentLens.length ? Math.min(...sentLens) : 0,
      max: sentLens.length ? Math.max(...sentLens) : 0,
      buckets,
    },
    paragraphLengths: { mean: r2(pMean), std: r2(pStd), cv: pMean > 0 ? r2(pStd / pMean) : 0 },
    wordLength: { mean: r2(wordCount ? words.reduce((a, w) => a + w.length, 0) / wordCount : 0) },
    vocabulary: {
      unique,
      ttr: wordCount ? r2(unique / wordCount) : 0,
      rootTtr: wordCount ? r2(unique / Math.sqrt(wordCount)) : 0,
      hapaxRatio: wordCount ? r2(hapax / wordCount) : 0,
      entropyNorm: r2(entropyNorm),
    },
    punctuation: {
      per1k: Object.fromEntries(
        Object.entries(counts).map(([k, v]) => [k, r2(per1k(v))])
      ) as Record<string, number>,
      exclaimPerSentence: r2(sentLens.length ? counts.exclaim / sentLens.length : 0),
      questionPerSentence: r2(sentLens.length ? counts.question / sentLens.length : 0),
      commaPerSentence: r2(sentLens.length ? counts.comma / sentLens.length : 0),
      multiPunctCount,
      ellipsisCount: counts.ellipsis,
    },
    phrases: {
      strongHits,
      strongCount: strongTotal,
      weakCount: weakTotal,
      strongPer1k: r2(per1k(strongTotal)),
      weakPer1k: r2(per1k(weakTotal)),
    },
    connectives: {
      count: connectiveCount,
      perSentence: r2(sentLens.length ? connectiveCount / sentLens.length : 0),
      sentenceStarters: starters,
    },
    repetition: {
      maxQuadgramFreq: maxQuadFreq,
      repeatedQuadgrams,
      topRepeated,
    },
    informality: {
      informalHits,
      contractionCount,
      emojiCount,
      elongations,
      allCapsWords,
      repeatedPunct: multiPunctCount,
    },
    casing: {
      startsCapitalRatio: sentLens.length ? r2(startsCapital / sentLens.length) : 0,
      endsPunctRatio: sentLens.length ? r2(endsPunct / sentLens.length) : 0,
    },
    digitsRatio: wordCount ? r2((text.match(/\d/g) ?? []).length / Math.max(text.length, 1)) : 0,
    doubleSpaces: (text.match(/ {2,}/g) ?? []).length,
    contentHash: createHash("sha256").update(text).digest("hex"),
  };
}

function r2(n: number): number {
  return Math.round(n * 1000) / 1000;
}

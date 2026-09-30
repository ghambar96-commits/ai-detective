/**
 * Unit tests — file parsers (parsers/index.ts) and analyzer routing.
 * Real TXT/MD/PDF/DOCX/PNG/WAV buffers built by the fixtures.
 */
import { describe, test, expect } from "bun:test";
import { TextFileParser, PdfParser, DocxParser, ImageParser, AudioParser, builtinParsers } from "@/lib/aidetective/parsers";
import { getAnalyzerFor } from "@/lib/aidetective/analyzers";
import { detectFileType } from "@/lib/aidetective/security/files";
import { buildPdf, buildDocx, buildPng, buildWav } from "../helpers/fixtures";

describe("parser registry", () => {
  test("5 builtin parsers registered with unique ids", () => {
    expect(builtinParsers.length).toBe(5);
    expect(new Set(builtinParsers.map((p) => p.id)).size).toBe(5);
  });
});

describe("text parser", () => {
  const parser = new TextFileParser();

  test("canParse: txt/md by extension, and any UTF-8 text by detection", () => {
    const textDetected = detectFileType(Buffer.from("hello"));
    expect(parser.canParse({ ext: "txt", detected: textDetected })).toBe(true);
    expect(parser.canParse({ ext: "md", detected: textDetected })).toBe(true);
    expect(parser.canParse({ ext: "png", detected: detectFileType(buildPng({ width: 1, height: 1 })) })).toBe(false);
  });

  test("parses plain text; strips BOM", async () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("سلام دنیا\nhello")]);
    const out = await parser.parse(buf, { fileName: "a.txt", ext: "txt" });
    expect(out.kind).toBe("text");
    expect(out.text).toBe("سلام دنیا\nhello");
  });

  test("markdown: syntax stripped, link text kept", async () => {
    const md = "# Title\n\nThis is **bold** and [a link](https://x.y) with `code`.\n\n- item one\n- item two";
    const out = await parser.parse(Buffer.from(md, "utf8"), { fileName: "a.md", ext: "md" });
    expect(out.kind).toBe("text");
    expect(out.text).not.toContain("#");
    expect(out.text).not.toContain("**");
    expect(out.text).toContain("a link");
    expect(out.text).toContain("item one");
  });
});

describe("PDF parser", () => {
  const parser = new PdfParser();

  test("canParse tied to detected pdf type", () => {
    const pdfBuf = buildPdf("test");
    expect(parser.canParse({ ext: "pdf", detected: detectFileType(pdfBuf) })).toBe(true);
    expect(parser.canParse({ ext: "pdf", detected: detectFileType(Buffer.from("txt")) })).toBe(false);
  });

  test("extracts real text from a crafted PDF", async () => {
    const sentence = "The quick brown fox jumps over the lazy dog near the riverbank while the sun sets behind the hills.";
    const pdf = buildPdf(sentence);
    const out = await parser.parse(pdf, { fileName: "doc.pdf", ext: "pdf" });
    expect(out.kind).toBe("document");
    expect(out.text).toContain("quick brown fox");
    expect(out.warnings ?? []).toEqual([]);
    expect((out.meta as { extractable?: boolean }).extractable).toBe(true);
  });

  test("invalid PDF → explicit error (no silent garbage)", async () => {
    await expect(parser.parse(Buffer.from("this is not a pdf at all"), { fileName: "bad.pdf", ext: "pdf" })).rejects.toThrow(/PDF parsing failed/);
  });
});

describe("DOCX parser", () => {
  const parser = new DocxParser();

  test("canParse tied to detected docx type", () => {
    const docx = buildDocx(["x"]);
    expect(parser.canParse({ ext: "docx", detected: detectFileType(docx) })).toBe(true);
  });

  test("extracts real body text from a crafted OOXML docx", async () => {
    const docx = buildDocx([
      "Artificial intelligence generated this sentence in a uniform tone.",
      "The second paragraph continues in the same manner as the first.",
      "A third paragraph completes the document for extraction testing.",
    ]);
    const out = await parser.parse(docx, { fileName: "doc.docx", ext: "docx" });
    expect(out.kind).toBe("document");
    expect(out.text).toContain("Artificial intelligence generated this sentence");
    expect(out.text).toContain("third paragraph");
  });

  test("corrupt docx → explicit error", async () => {
    // a ZIP without word/document.xml is still detected as "docx" by hint bytes
    const notDocx = buildDocx(["irrelevant"]);
    await expect(parser.parse(notDocx.subarray(0, 20), { fileName: "bad.docx", ext: "docx" })).rejects.toThrow(/DOCX parsing failed/);
  });
});

describe("image & audio passthrough parsers", () => {
  test("ImageParser passes PNG buffer through with format meta", async () => {
    const png = buildPng({ width: 4, height: 4 });
    const parser = new ImageParser();
    const out = await parser.parse(png, { fileName: "x.png", ext: "png" });
    expect(out.kind).toBe("image");
    expect(out.buffer).toBe(png);
    expect((out.meta as { format: string }).format).toBe("png");
  });

  test("ImageParser warns on WEBP metadata limits", async () => {
    const webp = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1"), Buffer.alloc(8)]);
    const out = await new ImageParser().parse(webp, { fileName: "x.webp", ext: "webp" });
    expect(out.kind).toBe("image");
    expect(out.warnings?.some((w) => w.includes("WEBP"))).toBe(true);
  });

  test("AudioParser declares its declaredExt from detected info (regression: ReferenceError)", async () => {
    const wav = buildWav({ durationSec: 0.05 });
    const out = await new AudioParser().parse(wav, { fileName: "x.wav", ext: "wav" });
    expect(out.kind).toBe("audio");
    expect((out.meta as { declaredExt: string }).declaredExt).toBe("wav");
  });
});

describe("analyzer routing", () => {
  test("kind → analyzer modality mapping", () => {
    expect(getAnalyzerFor("text", "text").modality).toBe("text");
    expect(getAnalyzerFor("text", "document").modality).toBe("document");
    expect(getAnalyzerFor("image").modality).toBe("image");
    expect(getAnalyzerFor("audio").modality).toBe("audio");
  });

  test("document analyzer collects honest short-text warnings", () => {
    const analyzer = getAnalyzerFor("text", "document");
    const warnings = analyzer.collectWarnings({ textFeatures: { wordCount: 10, language: "en" } });
    expect(warnings.some((w) => w.includes("Very short text"))).toBe(true);
  });

  test("image/audio analyzers always surface honest baseline warnings", () => {
    expect(getAnalyzerFor("image").collectWarnings({}).some((w) => w.includes("No trained computer-vision detector"))).toBe(true);
    expect(getAnalyzerFor("audio").collectWarnings({}).some((w) => w.includes("Speech-to-text"))).toBe(true);
  });
});

/**
 * AIDetective — file parsers.
 * Each parser converts a binary container into a normalized ParseOutput.
 * New formats plug in via the registry (plugins/<name>/ with type "parser").
 */
import type { FileParser, ParseOutput, DetectedFileType } from "../core/types";

// ─── Plain text (TXT / MD) ────────────────────────────────────────────────────

export class TextFileParser implements FileParser {
  readonly id = "parser.text";
  readonly name = "Plain text parser";
  readonly description = "Reads UTF-8 text files (txt, md). Markdown syntax is lightly stripped before analysis.";
  readonly extensions = ["txt", "md", "markdown", "text", "log", "csv"];
  readonly mimeTypes = ["text/plain", "text/markdown"];
  readonly outputKinds = ["text" as const];

  canParse({ ext, detected }: { ext: string; detected: DetectedFileType }): boolean {
    return detected.family === "text" && (this.extensions.includes(ext.toLowerCase()) || detected.ext === "txt");
  }

  async parse(buffer: Buffer, info: { fileName: string; ext: string }): Promise<ParseOutput> {
    const ext = info.ext.toLowerCase();
    let text = stripBom(buffer.toString("utf8"));
    const warnings: string[] = [];
    if (ext === "md" || ext === "markdown") {
      text = stripMarkdown(text);
    }
    return {
      kind: "text",
      text,
      meta: { parser: this.id, declaredFormat: ext || "txt" },
      warnings,
    };
  }
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export class PdfParser implements FileParser {
  readonly id = "parser.pdf";
  readonly name = "PDF text extractor";
  readonly description = "Extracts embedded text from PDF files (server-side, no network). Scanned/image-only PDFs produce an explicit warning.";
  readonly extensions = ["pdf"];
  readonly mimeTypes = ["application/pdf"];
  readonly outputKinds = ["document" as const];

  canParse({ detected }: { ext: string; detected: DetectedFileType }): boolean {
    return detected.ext === "pdf";
  }

  async parse(buffer: Buffer, info: { fileName: string; ext: string }): Promise<ParseOutput> {
    const warnings: string[] = [];
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      const merged = Array.isArray(text) ? text.join("\n\n") : text;
      const cleaned = merged.replace(/\u0000/g, "").trim();
      if (cleaned.replace(/\s/g, "").length < 40) {
        warnings.push(
          "PDF contains little or no extractable text (possibly scanned images). Text-level AI detection cannot run on image-only PDFs."
        );
        return { kind: "document", text: cleaned, meta: { parser: this.id, pages: totalPages, extractable: false }, warnings };
      }
      return { kind: "document", text: cleaned, meta: { parser: this.id, pages: totalPages, extractable: true }, warnings };
    } catch (error) {
      throw new Error(
        `PDF parsing failed for "${info.fileName}": ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

export class DocxParser implements FileParser {
  readonly id = "parser.docx";
  readonly name = "DOCX text extractor";
  readonly description = "Extracts body text from Microsoft Word (.docx) documents.";
  readonly extensions = ["docx"];
  readonly mimeTypes = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
  readonly outputKinds = ["document" as const];

  canParse({ detected }: { ext: string; detected: DetectedFileType }): boolean {
    return detected.ext === "docx";
  }

  async parse(buffer: Buffer, info: { fileName: string; ext: string }): Promise<ParseOutput> {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value.replace(/\u0000/g, "").trim();
      const warnings: string[] = [];
      if (text.replace(/\s/g, "").length < 20) {
        warnings.push("DOCX contained almost no extractable text.");
      }
      return { kind: "document", text, meta: { parser: this.id, format: "docx" }, warnings };
    } catch (error) {
      throw new Error(
        `DOCX parsing failed for "${info.fileName}": ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }
}

// ─── Image passthrough (PNG / JPG / WEBP) ─────────────────────────────────────

export class ImageParser implements FileParser {
  readonly id = "parser.image";
  readonly name = "Image passthrough";
  readonly description = "Validates and passes PNG/JPEG/WEBP buffers to the image pipeline (metadata + pixel analysis).";
  readonly extensions = ["png", "jpg", "jpeg", "webp"];
  readonly mimeTypes = ["image/png", "image/jpeg", "image/webp"];
  readonly outputKinds = ["image" as const];

  canParse({ detected }: { ext: string; detected: DetectedFileType }): boolean {
    return detected.family === "image";
  }

  async parse(buffer: Buffer, info: { fileName: string; ext: string }): Promise<ParseOutput> {
    const warnings: string[] = [];
    const detectedExt = buffer.subarray(0, 4).toString("latin1") === "RIFF" ? "webp" : buffer[0] === 0x89 ? "png" : "jpg";
    if (detectedExt === "webp") {
      warnings.push("WEBP: metadata parsing is limited; pixel analysis runs on the decoded frame.");
    }
    return {
      kind: "image",
      buffer,
      meta: { parser: this.id, format: detectedExt, declaredExt: info.ext },
      warnings,
    };
  }
}

// ─── Audio passthrough (WAV / MP3 / FLAC / M4A) ───────────────────────────────

export class AudioParser implements FileParser {
  readonly id = "parser.audio";
  readonly name = "Audio passthrough";
  readonly description = "Validates and passes WAV/MP3/FLAC/M4A buffers to the audio pipeline (metadata + waveform analysis where supported).";
  readonly extensions = ["wav", "mp3", "flac", "m4a"];
  readonly mimeTypes = ["audio/wav", "audio/mpeg", "audio/flac", "audio/mp4", "audio/x-m4a"];
  readonly outputKinds = ["audio" as const];

  canParse({ detected }: { ext: string; detected: DetectedFileType }): boolean {
    return detected.family === "audio";
  }

  async parse(buffer: Buffer, info: { fileName: string; ext: string }): Promise<ParseOutput> {
    return {
      kind: "audio",
      buffer,
      meta: { parser: this.id, declaredExt: info.ext },
      warnings: [],
    };
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*_]{3,}\s*$/gm, " ");
}

export const builtinParsers: FileParser[] = [
  new TextFileParser(),
  new PdfParser(),
  new DocxParser(),
  new ImageParser(),
  new AudioParser(),
];

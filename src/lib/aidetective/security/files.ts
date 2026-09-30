/**
 * AIDetective — upload security.
 * Uploaded files are UNTRUSTED input:
 *  - file type is detected from magic bytes, never from client-supplied name/MIME
 *  - filenames are sanitized, storage names are generated ids (no path traversal)
 *  - size limits are enforced before buffering
 */
import { createHash } from "crypto";
import { mkdirSync } from "fs";
import { join, resolve } from "path";
import { AppError } from "../core/errors";
import { config } from "../core/config";
import type { DetectedFileType } from "../core/types";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff]);
const FLAC_SIG = Buffer.from("fLaC", "latin1");
const PDF_SIG = Buffer.from("%PDF-", "latin1");
const DOCX_HINT = Buffer.from("word/", "latin1");

export const ALLOWED_UPLOAD_EXTENSIONS = [
  "txt", "md", "pdf", "docx",
  "png", "jpg", "jpeg", "webp",
  "wav", "mp3", "flac", "m4a",
] as const;

export const AUDIO_EXTENSIONS = ["wav", "mp3", "flac", "m4a"];
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
export const DOCUMENT_EXTENSIONS = ["txt", "md", "pdf", "docx"];

function hasSequence(buf: Buffer, seq: Buffer, start = 0, end = buf.length): boolean {
  const idx = buf.indexOf(seq, start);
  return idx !== -1 && idx < end;
}

/**
 * Magic-byte sniffing. The result is the ONLY source of truth for routing;
 * client-declared extension/MIME are treated as hints only.
 */
export function detectFileType(buf: Buffer): DetectedFileType {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) {
    return { mime: "image/png", ext: "png", family: "image" };
  }
  if (buf.length >= 3 && buf.subarray(0, 3).equals(JPEG_SIG)) {
    return { mime: "image/jpeg", ext: "jpg", family: "image" };
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return { mime: "image/webp", ext: "webp", family: "image" };
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WAVE") {
    return { mime: "audio/wav", ext: "wav", family: "audio" };
  }
  if (buf.length >= 4 && buf.subarray(0, 4).equals(FLAC_SIG)) {
    return { mime: "audio/flac", ext: "flac", family: "audio" };
  }
  // MP3: ID3v2 tag or MPEG frame sync
  if (buf.length >= 3 && buf.subarray(0, 3).toString("latin1") === "ID3") {
    return { mime: "audio/mpeg", ext: "mp3", family: "audio" };
  }
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return { mime: "audio/mpeg", ext: "mp3", family: "audio" };
  }
  // MP4/M4A: box "ftyp" at offset 4
  if (buf.length >= 12 && buf.subarray(4, 8).toString("latin1") === "ftyp") {
    return { mime: "audio/mp4", ext: "m4a", family: "audio" };
  }
  if (buf.length >= 5 && buf.subarray(0, 5).equals(PDF_SIG)) {
    return { mime: "application/pdf", ext: "pdf", family: "document" };
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5 || buf[2] === 7)) {
    // ZIP container — DOCX if it contains a "word/" entry near the start
    if (hasSequence(buf, DOCX_HINT, 0, Math.min(buf.length, 64 * 1024))) {
      return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx", family: "document" };
    }
    return { mime: "application/zip", ext: "zip", family: "archive" };
  }
  // Text heuristic: decodable as UTF-8 with almost no control characters
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  const text = sample.toString("utf8");
  let control = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 9 || (c > 13 && c < 32)) && c !== 0xfeff) control++;
  }
  if (sample.length > 0 && control / Math.max(sample.length, 1) < 0.02) {
    return { mime: "text/plain", ext: "txt", family: "text" };
  }
  return { mime: "application/octet-stream", ext: "bin", family: "binary" };
}

/** Strip any path component, dangerous chars; cap length. Never trust the client name. */
export function sanitizeFilename(name: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[^a-zA-Z0-9._\- \u0600-\u06FF]/g, "_")
    .replace(/\.{2,}/g, ".")
    .trim();
  const capped = cleaned.slice(0, 120);
  return capped.length > 0 ? capped : "upload.bin";
}

export function fileSha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface ValidatedUpload {
  buffer: Buffer;
  detected: DetectedFileType;
  originalName: string;
  sizeBytes: number;
  warnings: string[];
}

/**
 * Validate an uploaded file end-to-end. Throws structured AppErrors.
 * `hintExt`/`hintMime` are advisory — content wins.
 */
export function validateUpload(
  buffer: Buffer,
  originalName: string,
  hintExt?: string,
  hintMime?: string
): ValidatedUpload {
  const maxBytes = config.security.maxUploadMb * 1024 * 1024;
  if (buffer.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Uploaded file is empty");
  }
  if (buffer.length > maxBytes) {
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      `File exceeds the ${config.security.maxUploadMb} MB limit`,
      { sizeBytes: buffer.length, maxBytes }
    );
  }
  const detected = detectFileType(buffer);
  if (detected.family === "binary" || detected.family === "archive") {
    throw new AppError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Unsupported file type. Allowed: txt, md, pdf, docx, png, jpg, webp, wav, mp3, flac, m4a",
      { detected: detected.mime }
    );
  }
  const warnings: string[] = [];
  const safeName = sanitizeFilename(originalName);
  const declaredExt = (hintExt ?? safeName.split(".").pop() ?? "").toLowerCase();
  if (declaredExt && declaredExt !== detected.ext && !(declaredExt === "jpeg" && detected.ext === "jpg")) {
    warnings.push(
      `Declared extension ".${declaredExt}" does not match detected content type "${detected.mime}" — content type was used.`
    );
  }
  if (hintMime && !hintMime.includes(detected.mime) && !detected.mime.includes("text")) {
    warnings.push(`Declared MIME type "${hintMime}" does not match detected content type "${detected.mime}".`);
  }
  return { buffer, detected, originalName: safeName, sizeBytes: buffer.length, warnings };
}

// ─── Safe storage ─────────────────────────────────────────────────────────────

export function uploadsRoot(): string {
  const root = resolve(process.cwd(), config.storage.uploadsDir);
  mkdirSync(root, { recursive: true });
  return root;
}

/** Storage path for an analysis id — ids are server-generated (cuid), ext is whitelisted. */
export function storagePathFor(analysisId: string, ext: string): string {
  const safeExt = ALLOWED_UPLOAD_EXTENSIONS.includes(ext as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number])
    ? ext
    : "bin";
  return join(uploadsRoot(), `${analysisId}.${safeExt}`);
}

export function isInsideUploads(path: string): boolean {
  const root = uploadsRoot();
  return resolve(path).startsWith(root + (root.endsWith("/") ? "" : "/"));
}

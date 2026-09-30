/**
 * Unit tests — upload security (security/files.ts): magic-byte detection,
 * filename sanitization, size limits, safe storage paths, traversal defence.
 */
import { describe, test, expect } from "bun:test";
import {
  detectFileType,
  sanitizeFilename,
  validateUpload,
  fileSha256,
  storagePathFor,
  isInsideUploads,
  uploadsRoot,
  ALLOWED_UPLOAD_EXTENSIONS,
} from "@/lib/aidetective/security/files";
import { AppError } from "@/lib/aidetective/core/errors";
import { buildPng, buildWav, buildMp3, buildFlac, buildM4a, buildDocx, buildPdf, buildStoredZip } from "../helpers/fixtures";

describe("magic-byte detection (content wins, never client hints)", () => {
  test("PNG / JPEG / WEBP signatures", () => {
    expect(detectFileType(buildPng({ width: 1, height: 1 }))).toEqual({ mime: "image/png", ext: "png", family: "image" });
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
    expect(detectFileType(jpeg).ext).toBe("jpg");
    const webp = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1"), Buffer.alloc(8)]);
    expect(detectFileType(webp).mime).toBe("image/webp");
  });

  test("WAV / FLAC / MP3 / M4A signatures", () => {
    expect(detectFileType(buildWav({ durationSec: 0.05 })).ext).toBe("wav");
    expect(detectFileType(buildFlac()).ext).toBe("flac");
    expect(detectFileType(buildMp3({})).ext).toBe("mp3");
    expect(detectFileType(buildM4a()).ext).toBe("m4a");
    const bareFrame = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0]);
    expect(detectFileType(bareFrame).family).toBe("audio");
  });

  test("PDF / DOCX / ZIP / plain text / binary", () => {
    expect(detectFileType(buildPdf("Hello world content for the pdf parser test.")).ext).toBe("pdf");
    const docx = buildDocx(["Hello world, this is a real docx body for testing."]);
    expect(detectFileType(docx).ext).toBe("docx");
    const zip = buildStoredZip([{ name: "a.txt", data: Buffer.from("x") }]);
    expect(detectFileType(zip).family).toBe("archive");
    expect(detectFileType(Buffer.from("just some plain text, nothing else here\n"))).toEqual({ mime: "text/plain", ext: "txt", family: "text" });
    expect(detectFileType(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x7f, 0xff])).family).toBe("binary");
  });

  test("client-declared extension is only a hint: PNG named .exe is still detected as PNG", () => {
    const png = buildPng({ width: 1, height: 1 });
    const validated = validateUpload(png, "totally-not-malicious.exe", "exe", "application/octet-stream");
    expect(validated.detected.ext).toBe("png");
    expect(validated.warnings.length).toBeGreaterThan(0);
  });
});

describe("filename sanitization", () => {
  test("strips path traversal (unix + windows + mixed)", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32\\evil.dll")).toBe("evil.dll");
    expect(sanitizeFilename("/abs/path/file.png")).toBe("file.png");
  });

  test("removes control characters and dangerous chars", () => {
    expect(sanitizeFilename("file\u0000\u001f:name?.png")).not.toMatch(/[\x00-\x1f:?]/);
    expect(sanitizeFilename("a<b>c|d\"e*f.png")).toBe("a_b_c_d_e_f.png");
  });

  test("collapses dot sequences (no '..') and caps length", () => {
    expect(sanitizeFilename("....hidden..file.png")).not.toContain("..");
    const long = sanitizeFilename(`${"a".repeat(300)}.png`);
    expect(long.length).toBeLessThanOrEqual(120);
  });

  test("empty/dangerous-only names fall back to a safe default", () => {
    expect(sanitizeFilename("")).toBe("upload.bin");
    expect(sanitizeFilename("..//..//")).toBe("upload.bin");
    expect(sanitizeFilename("پرونده.png")).toBe("پرونده.png"); // Persian chars preserved
  });
});

describe("upload validation", () => {
  test("empty buffer → VALIDATION_ERROR", () => {
    expect(() => validateUpload(Buffer.alloc(0), "x.png")).toThrow(AppError);
    try {
      validateUpload(Buffer.alloc(0), "x.png");
    } catch (e) {
      expect((e as AppError).code).toBe("VALIDATION_ERROR");
    }
  });

  test("oversized buffer → PAYLOAD_TOO_LARGE", () => {
    const big = Buffer.alloc(26 * 1024 * 1024); // default limit is 25 MB
    expect(() => validateUpload(big, "big.bin")).toThrow(AppError);
  });

  test("binary/archive content → UNSUPPORTED_MEDIA_TYPE with allow-list message", () => {
    try {
      validateUpload(Buffer.from([0x00, 0x01, 0x02, 0x7f, 0xff, 0xfe]), "evil.bin");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("UNSUPPORTED_MEDIA_TYPE");
      expect((e as AppError).message).toContain("Allowed:");
    }
    const zip = buildStoredZip([{ name: "x", data: Buffer.from("y") }]);
    expect(() => validateUpload(zip, "archive.zip")).toThrow(AppError);
  });

  test("declared extension mismatch produces a warning but content wins", () => {
    const wav = buildWav({ durationSec: 0.05 });
    const v = validateUpload(wav, "sound.wav", "wav", "audio/mpeg");
    expect(v.detected.mime).toBe("audio/wav");
    expect(v.warnings.some((w) => w.includes("audio/mpeg"))).toBe(true);
  });

  test("jpeg/jpg declared alias does not warn", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
    const v = validateUpload(jpeg, "photo.jpeg", "jpeg", "image/jpeg");
    expect(v.warnings).toEqual([]);
  });

  test("sha256 of content is stable", () => {
    const buf = Buffer.from("deterministic content");
    expect(fileSha256(buf)).toBe(fileSha256(Buffer.from("deterministic content")));
    expect(fileSha256(buf)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("safe storage", () => {
  test("storagePathFor whitelists extensions", () => {
    expect(storagePathFor("abc123", "png")).toMatch(/abc123\.png$/);
    expect(storagePathFor("abc123", "exe")).toMatch(/abc123\.bin$/);
  });

  test("traversal-containment: malicious storage paths are rejected by isInsideUploads (defence-in-depth)", () => {
    // storagePathFor assumes a server-generated id, but even IF a malicious
    // path ever reached storage metadata, the worker and DELETE endpoints must
    // refuse anything outside uploads/.
    const malicious = storagePathFor("../../evil", "png");
    expect(isInsideUploads(malicious)).toBe(false);
    expect(isInsideUploads("/etc/passwd")).toBe(false);
  });

  test("uploads root is inside project and isInsideUploads enforces containment", () => {
    const root = uploadsRoot();
    expect(isInsideUploads(`${root}/abc.png`)).toBe(true);
    expect(isInsideUploads(`${root}/../secret.txt`)).toBe(false);
    expect(isInsideUploads("/etc/passwd")).toBe(false);
  });

  test("allow-list covers exactly the documented formats", () => {
    expect([...ALLOWED_UPLOAD_EXTENSIONS].sort()).toEqual(
      ["docx", "flac", "jpeg", "jpg", "m4a", "md", "mp3", "pdf", "png", "txt", "wav", "webp"].sort()
    );
  });
});

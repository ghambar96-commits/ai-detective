/**
 * Unit tests — API key hashing/generation (pure crypto), error payload
 * mapping and structured-error semantics.
 */
import { describe, test, expect } from "bun:test";
import { hashApiKey, generateApiKey } from "@/lib/aidetective/security/auth";
import { AppError, toErrorPayload } from "@/lib/aidetective/core/errors";

describe("API key generation & hashing", () => {
  test("format: adk_ prefix + hex, prefix is a stable slice of plaintext", () => {
    const { plaintext, prefix, hash } = generateApiKey();
    expect(plaintext).toMatch(/^adk_[a-f0-9]{48}$/);
    expect(prefix).toBe(plaintext.slice(0, 12));
    expect(prefix.startsWith("adk_")).toBe(true);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("hash is sha256 of plaintext and deterministic", () => {
    const key = "adk_abcdef1234567890abcdef1234567890abcdef1234567890";
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey("other")).not.toBe(hashApiKey(key));
  });

  test("keys are unique across generations (48 bits entropy×4 hex)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateApiKey().plaintext);
    expect(seen.size).toBe(100);
  });

  test("hash never equals plaintext (no reversible storage)", () => {
    const { plaintext, hash } = generateApiKey();
    expect(hash).not.toContain(plaintext);
    expect(plaintext).not.toContain(hash);
  });
});

describe("structured errors", () => {
  test("AppError exposes code + HTTP status mapping", () => {
    expect(new AppError("VALIDATION_ERROR", "x").status).toBe(400);
    expect(new AppError("UNAUTHORIZED", "x").status).toBe(401);
    expect(new AppError("NOT_FOUND", "x").status).toBe(404);
    expect(new AppError("PAYLOAD_TOO_LARGE", "x").status).toBe(413);
    expect(new AppError("UNSUPPORTED_MEDIA_TYPE", "x").status).toBe(415);
    expect(new AppError("CONFLICT", "x").status).toBe(409);
    expect(new AppError("RATE_LIMITED", "x").status).toBe(429);
    expect(new AppError("INTERNAL_ERROR", "x").status).toBe(500);
    expect(new AppError("SERVICE_UNAVAILABLE", "x").status).toBe(503);
  });

  test("toErrorPayload maps AppError and unknown errors", () => {
    const appErr = toErrorPayload(new AppError("NOT_FOUND", "nope", { id: "1" }));
    expect(appErr.code).toBe("NOT_FOUND");
    expect(appErr.details).toEqual({ id: "1" });

    const generic = toErrorPayload(new Error("boom"));
    expect(generic.code).toBe("INTERNAL_ERROR");
    expect(generic.message).toBe("boom");

    const weird = toErrorPayload("just a string");
    expect(weird.code).toBe("INTERNAL_ERROR");
    expect(weird.message).toBe("Unexpected internal error");
  });
});

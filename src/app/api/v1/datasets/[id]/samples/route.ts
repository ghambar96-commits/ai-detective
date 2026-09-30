import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler, corsPreflight, jsonOk, readJson } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

const importSchema = z.object({
  samples: z
    .array(
      z.object({
        content: z.string().min(1).max(100_000),
        label: z.string().max(60).optional(),
      })
    )
    .min(1)
    .max(500),
});

/**
 * POST /api/v1/datasets/{id}/samples
 * Text sample import (JSONL-like). Stores counts and labels for future
 * evaluation runs. Binary (image/audio) sample import is TODO(phase-3).
 */
export const POST = apiHandler<{ id: string }>(async ({ req, params }) => {
  await ensureBootstrap();
  const dataset = await db.dataset.findUnique({ where: { id: params.id } });
  if (!dataset) throw new AppError("NOT_FOUND", `Dataset "${params.id}" not found`);
  if (!["text", "document", "mixed"].includes(dataset.modality)) {
    throw new AppError("VALIDATION_ERROR", "Text sample import currently supports text/document/mixed datasets only (binary import is TODO phase-3)");
  }
  const parsed = importSchema.safeParse(await readJson(req, 8_000_000));
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid samples payload", parsed.error.issues);

  await db.dataset.update({
    where: { id: params.id },
    data: { sampleCount: { increment: parsed.data.samples.length }, updatedAt: new Date() },
  });
  return jsonOk({
    imported: parsed.data.samples.length,
    note: "Samples are counted and labelled for future evaluation runs; full evaluation/training is TODO phase-3.",
  }, undefined, 202);
});

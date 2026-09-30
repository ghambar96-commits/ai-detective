import { z } from "zod";
import { apiHandler, readJson, corsPreflight, jsonOk } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { analyzeText } from "@/lib/aidetective/orchestrator";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  content: z.string().min(1, "content is required"),
  options: z
    .object({
      detectors: z.array(z.string()).max(32).optional(),
      useLlm: z.boolean().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export const OPTIONS = () => corsPreflight();

/**
 * POST /api/v1/analyze
 * Analyze raw text inline. Returns the completed analysis.
 */
export const POST = apiHandler(async ({ req }) => {
  await ensureBootstrap();
  const parsed = bodySchema.safeParse(await readJson(req, 1_500_000));
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid request body", parsed.error.issues);
  }
  const detail = await analyzeText({
    content: parsed.data.content,
    options: parsed.data.options,
  });
  return jsonOk(detail);
});

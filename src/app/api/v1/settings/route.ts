import { z } from "zod";
import { apiHandler, corsPreflight, jsonOk, readJson } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { getSettingsService } from "@/lib/aidetective/services/settings";
import { listLLMProviders } from "@/lib/aidetective/llm/providers";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

const putSchema = z.object({
  llm: z
    .object({
      enabled: z.boolean().optional(),
      provider: z.string().max(60).optional(),
      baseUrl: z.string().max(300).nullable().optional(),
      model: z.string().max(120).nullable().optional(),
      apiKey: z.string().max(300).nullable().optional(),
      temperature: z.number().min(0).max(2).optional(),
      timeoutMs: z.number().min(2000).max(120_000).optional(),
    })
    .optional(),
  scoring: z
    .object({
      aiThreshold: z.number().min(0.51).max(0.95).optional(),
      humanThreshold: z.number().min(0.05).max(0.49).optional(),
      minSignals: z.number().int().min(1).max(8).optional(),
      maxConfidence: z.number().min(0.5).max(0.95).optional(),
    })
    .optional(),
  security: z.object({ requireApiKey: z.boolean().optional() }).optional(),
});

/** GET /api/v1/settings — current runtime configuration (API key fields are masked). */
export const GET = apiHandler(async () => {
  await ensureBootstrap();
  const s = getSettingsService();
  const [llm, scoring, security] = await Promise.all([s.getLLM(), s.getScoring(), s.getSecurity()]);
  return jsonOk({
    llm: { ...llm, apiKey: llm.apiKey ? "•••••••• (stored)" : null, hasApiKey: Boolean(llm.apiKey) },
    scoring,
    security,
    providers: listLLMProviders().map((p) => ({ id: p.id, label: p.label, kind: p.kind })),
  });
});

/** PUT /api/v1/settings — update runtime configuration. */
export const PUT = apiHandler(async ({ req }) => {
  await ensureBootstrap();
  const parsed = putSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid settings payload", parsed.error.issues);
  const s = getSettingsService();
  const result: Record<string, unknown> = {};
  if (parsed.data.llm) {
    const patch = { ...parsed.data.llm };
    if (patch.apiKey === "•••••••• (stored)") delete patch.apiKey;
    result.llm = await s.setLLM(patch);
    if (result.llm) (result.llm as { apiKey?: string | null }).apiKey = (result.llm as { apiKey?: string | null }).apiKey ? "•••••••• (stored)" : null;
  }
  if (parsed.data.scoring) result.scoring = await s.setScoring(parsed.data.scoring);
  if (parsed.data.security) result.security = await s.setSecurity(parsed.data.security);
  return jsonOk(result);
});

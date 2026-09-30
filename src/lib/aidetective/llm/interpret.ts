/**
 * AIDetective — LLM interpretation runner.
 * Receives the STRUCTURED output of the Analysis Engine (score, confidence,
 * signals, evidence summaries) and produces a human-readable explanation.
 * The LLM never sees raw instructions to "decide" — it is explicitly told the
 * verdict comes from the deterministic engine and it must only explain.
 */
import type { AnalysisOptions, LLMConfig } from "../core/types";
import { getSettingsService } from "../services/settings";
import { getLLMProvider } from "./providers";
import { createLogger } from "../core/logger";

const log = createLogger("llm");

export interface InterpretationInput {
  modality: string;
  classification: string;
  score: number | null;
  confidence: number;
  signals: Array<{
    detectorId: string;
    name: string;
    value: string | number | boolean | null | undefined;
    aiScore: number | null;
    direction: string;
    evidence: Array<{ label: string; content: string }>;
  }>;
  warnings: string[];
  detectorSummaries: Array<{ detectorId: string; status: string; summary?: string }>;
  fileName?: string;
}

export interface InterpretationOutput {
  text: string;
  provider: string;
  model: string;
}

export async function interpretWithLLM(
  input: InterpretationInput,
  options: AnalysisOptions
): Promise<InterpretationOutput | null> {
  const settings = getSettingsService();
  const cfg: LLMConfig = await settings.getLLM();
  const wantsLlm = options.useLlm === true;

  if (!wantsLlm || !cfg.enabled) return null;

  const provider = getLLMProvider(cfg.provider);
  if (!provider) {
    log.warn("configured llm provider not found — skipping interpretation", { provider: cfg.provider });
    return null;
  }
  if (!provider.isConfigured(cfg)) {
    log.warn("llm provider not configured — skipping interpretation", { provider: cfg.provider });
    return null;
  }

  const compactSignals = input.signals.slice(0, 20).map((s) => ({
    detector: s.detectorId,
    signal: s.name,
    value: s.value ?? null,
    aiScore: s.aiScore,
    direction: s.direction,
    keyEvidence: s.evidence.slice(0, 2).map((e) => `${e.label}: ${e.content.slice(0, 220)}`),
  }));

  const system = [
    "You are the explanation layer of AIDetective, an open-source probabilistic AI-content detection platform.",
    "A deterministic analysis engine has ALREADY produced the verdict below. Your job is ONLY to explain it.",
    "Hard rules:",
    "1. NEVER change, contradict or re-compute the verdict, score or confidence.",
    "2. NEVER claim certainty. Detection is probabilistic and can produce false positives and false negatives.",
    "3. Explain what the signals mean and how they relate to each other, in clear, non-alarmist language.",
    "4. If evidence is weak or conflicting, say so plainly.",
    "5. Answer in the same language as the analysed content if identifiable, otherwise English.",
    "6. Keep it under 300 words. Use short paragraphs or bullet points.",
  ].join("\n");

  const user = [
    `Content type: ${input.modality}${input.fileName ? ` (file: ${input.fileName})` : ""}`,
    `Engine verdict: ${input.classification}`,
    `Likelihood score: ${input.score !== null ? input.score.toFixed(3) : "n/a"} (0=human, 1=AI; not proof)`,
    `Confidence: ${input.confidence.toFixed(3)}`,
    "",
    "Raw signals:",
    JSON.stringify(compactSignals, null, 1),
    "",
    input.warnings.length ? `Warnings: ${input.warnings.join(" | ")}` : "Warnings: none",
    "",
    "Write: (1) a short summary of the findings, (2) how the signals support or weaken each other, (3) honest limitations/caveats for this specific case.",
  ].join("\n");

  try {
    const result = await provider.complete(
      { ...cfg, timeoutMs: cfg.timeoutMs ?? 25_000, maxTokens: cfg.maxTokens ?? 700 },
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ]
    );
    return { text: result.text.trim(), provider: result.provider, model: result.model };
  } catch (error) {
    log.error("llm interpretation failed", {
      provider: cfg.provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return null; // interpretation is optional — analysis continues without it
  }
}

/** Tiny connectivity test used by the LLM settings page. */
export async function testLLMConnection(): Promise<{
  ok: boolean;
  provider: string;
  model: string | null;
  latencyMs: number | null;
  error: string | null;
}> {
  const cfg = await getSettingsService().getLLM();
  const provider = getLLMProvider(cfg.provider);
  if (!provider) {
    return { ok: false, provider: cfg.provider, model: null, latencyMs: null, error: `Unknown provider "${cfg.provider}"` };
  }
  if (!provider.isConfigured(cfg)) {
    return { ok: false, provider: cfg.provider, model: null, latencyMs: null, error: `Provider "${provider.label}" is not fully configured (missing base URL / model)` };
  }
  const started = Date.now();
  try {
    const result = await provider.complete({ ...cfg, timeoutMs: Math.min(cfg.timeoutMs ?? 20_000, 20_000) }, [
      { role: "system", content: "Reply with exactly: OK" },
      { role: "user", content: "ping" },
    ]);
    return { ok: Boolean(result.text), provider: result.provider, model: result.model, latencyMs: result.latencyMs, error: result.text ? null : "Empty response" };
  } catch (error) {
    return {
      ok: false,
      provider: cfg.provider,
      model: cfg.model ?? null,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * AIDetective — LLM provider abstraction (provider-agnostic, optional layer).
 *
 * Rules enforced by design:
 *  - The LLM NEVER decides the AI-detection verdict. It only explains the
 *    structured evidence produced by the Analysis Engine.
 *  - The application is fully functional with LLM disabled.
 *  - No vendor lock-in: Ollama, any OpenAI-compatible API (OpenAI, OpenRouter,
 *    custom endpoints) and the managed ZAI runtime are supported; more via plugins.
 */
import type { LLMCompletionResult, LLMConfig, LLMMessage, LLMProvider } from "../core/types";
import { AppError } from "../core/errors";
import { createLogger } from "../core/logger";

const log = createLogger("llm");

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs: number; signal?: AbortSignal }
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  const onOuterAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onOuterAbort);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onOuterAbort);
  }
}

// ─── Ollama (local) ───────────────────────────────────────────────────────────

export class OllamaProvider implements LLMProvider {
  readonly id = "ollama";
  readonly label = "Ollama (local)";
  readonly kind = "local" as const;

  isConfigured(config: LLMConfig): boolean {
    return Boolean(config.baseUrl);
  }

  async complete(config: LLMConfig, messages: LLMMessage[]): Promise<LLMCompletionResult> {
    if (!this.isConfigured(config)) {
      throw new AppError("SERVICE_UNAVAILABLE", "Ollama provider requires AIDETECTIVE_LLM_BASE_URL (e.g. http://localhost:11434)");
    }
    const started = Date.now();
    const base = config.baseUrl!.replace(/\/+$/, "");
    const response = await fetchWithTimeout(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model ?? "llama3.1",
        messages,
        stream: false,
        options: { temperature: config.temperature },
      }),
      timeoutMs: config.timeoutMs ?? 30_000,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AppError("SERVICE_UNAVAILABLE", `Ollama error ${response.status}`, { body: body.slice(0, 300) });
    }
    const data = (await response.json()) as { message?: { content?: string }; model?: string };
    return {
      text: data.message?.content ?? "",
      model: data.model ?? config.model ?? "ollama",
      provider: this.id,
      latencyMs: Date.now() - started,
    };
  }
}

// ─── OpenAI-compatible (OpenAI / OpenRouter / custom endpoints) ───────────────

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = "openai_compatible";
  readonly label = "OpenAI-compatible API (OpenAI, OpenRouter, custom)";
  readonly kind = "remote" as const;

  isConfigured(config: LLMConfig): boolean {
    return Boolean(config.baseUrl);
  }

  async complete(config: LLMConfig, messages: LLMMessage[]): Promise<LLMCompletionResult> {
    if (!this.isConfigured(config)) {
      throw new AppError("SERVICE_UNAVAILABLE", "OpenAI-compatible provider requires a base URL (e.g. https://api.openai.com/v1 or https://openrouter.ai/api/v1)");
    }
    const started = Date.now();
    const base = config.baseUrl!.replace(/\/+$/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
    const response = await fetchWithTimeout(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model ?? "gpt-4o-mini",
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      }),
      timeoutMs: config.timeoutMs ?? 30_000,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AppError("SERVICE_UNAVAILABLE", `OpenAI-compatible endpoint error ${response.status}`, { body: body.slice(0, 300) });
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      model: data.model ?? config.model ?? "openai-compatible",
      provider: this.id,
      latencyMs: Date.now() - started,
    };
  }
}

// ─── ZAI managed runtime (backend-only SDK) ───────────────────────────────────

export class ZaiProvider implements LLMProvider {
  readonly id = "zai";
  readonly label = "ZAI managed runtime";
  readonly kind = "managed" as const;

  isConfigured(_config: LLMConfig): boolean {
    return true; // the managed runtime requires no user-side configuration
  }

  async complete(config: LLMConfig, messages: LLMMessage[]): Promise<LLMCompletionResult> {
    const started = Date.now();
    try {
      const { default: ZAI } = await import("z-ai-web-dev-sdk");
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages,
        thinking: { type: "disabled" },
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      });
      const text = completion.choices[0]?.message?.content ?? "";
      if (!text) throw new AppError("SERVICE_UNAVAILABLE", "ZAI runtime returned an empty response");
      return {
        text,
        model: "glm-4.5-flash",
        provider: this.id,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      log.error("zai provider failed", { error: error instanceof Error ? error.message : String(error) });
      throw new AppError("SERVICE_UNAVAILABLE", "ZAI managed runtime is unavailable", {
        hint: "Disable the LLM layer or configure a local provider (Ollama / OpenAI-compatible).",
      });
    }
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

function builtinProviders(): LLMProvider[] {
  return [new OllamaProvider(), new OpenAICompatibleProvider(), new ZaiProvider()];
}

export function getLLMProvider(id: string): LLMProvider | null {
  const g = globalThis as unknown as { __aidetectiveLLMProviders?: Map<string, LLMProvider> };
  if (!g.__aidetectiveLLMProviders) {
    g.__aidetectiveLLMProviders = new Map(builtinProviders().map((p) => [p.id, p]));
  }
  const map = g.__aidetectiveLLMProviders;
  return map.get(id) ?? null;
}

export function listLLMProviders(): LLMProvider[] {
  const g = globalThis as unknown as { __aidetectiveLLMProviders?: Map<string, LLMProvider> };
  if (!g.__aidetectiveLLMProviders) getLLMProvider("zai");
  return Array.from(g.__aidetectiveLLMProviders!.values());
}

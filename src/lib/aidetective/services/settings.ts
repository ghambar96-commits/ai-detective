/**
 * AIDetective — settings service.
 * Runtime configuration (LLM, scoring, security) persisted in the DB,
 * seeded from environment defaults. Never stores secrets in logs.
 */
import { db } from "@/lib/db";
import { config } from "../core/config";
import type { LLMConfig, ScoringConfig } from "../core/types";
import { DEFAULT_SCORING } from "../core/scoring";

export interface SecuritySettings {
  requireApiKey: boolean;
}

class SettingsService {
  private cache = new Map<string, { value: unknown; expires: number }>();
  private static TTL = 3000;

  private async getRaw<T>(key: string, fallback: T): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value as T;
    try {
      const row = await db.setting.findUnique({ where: { key } });
      if (row) {
        const value = JSON.parse(row.value) as T;
        this.cache.set(key, { value, expires: Date.now() + SettingsService.TTL });
        return value;
      }
    } catch {
      // DB unavailable — fall back to env defaults
    }
    return fallback;
  }

  private async setRaw<T>(key: string, value: T): Promise<void> {
    await db.setting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value) },
      update: { value: JSON.stringify(value) },
    });
    this.cache.set(key, { value, expires: Date.now() + SettingsService.TTL });
  }

  getLLMDefaults(): LLMConfig {
    return {
      enabled: config.llm.enabled,
      provider: config.llm.provider,
      baseUrl: config.llm.baseUrl,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
      temperature: config.llm.temperature,
      timeoutMs: config.llm.timeoutMs,
    };
  }

  async getLLM(): Promise<LLMConfig> {
    const stored = await this.getRaw<Partial<LLMConfig>>("llm.config", {});
    return { ...this.getLLMDefaults(), ...stored };
  }

  async setLLM(partial: Partial<LLMConfig>): Promise<LLMConfig> {
    const current = await this.getLLM();
    const next: LLMConfig = { ...current, ...partial };
    await this.setRaw("llm.config", next);
    return next;
  }

  getScoringDefaults(): ScoringConfig {
    return {
      weights: {},
      aiThreshold: config.scoring.aiThreshold,
      humanThreshold: config.scoring.humanThreshold,
      minSignals: config.scoring.minSignals,
      maxConfidence: config.scoring.maxConfidence,
    };
  }

  async getScoring(): Promise<ScoringConfig> {
    const stored = await this.getRaw<Partial<ScoringConfig>>("scoring.config", {});
    const merged = { ...this.getScoringDefaults(), ...stored };
    return {
      ...merged,
      maxConfidence: Math.min(Math.max(merged.maxConfidence, 0.5), 0.95),
      aiThreshold: Math.min(Math.max(merged.aiThreshold, 0.51), 0.95),
      humanThreshold: Math.min(Math.max(merged.humanThreshold, 0.05), 0.49),
      minSignals: Math.min(Math.max(merged.minSignals, 1), 8),
    };
  }

  async setScoring(partial: Partial<ScoringConfig>): Promise<ScoringConfig> {
    const current = await this.getScoring();
    const next = { ...current, ...partial };
    await this.setRaw("scoring.config", next);
    return this.getScoring();
  }

  async getSecurity(): Promise<SecuritySettings> {
    const stored = await this.getRaw<SecuritySettings>("security.config", { requireApiKey: config.security.requireApiKey });
    return stored;
  }

  async setSecurity(partial: Partial<SecuritySettings>): Promise<SecuritySettings> {
    const current = await this.getSecurity();
    const next = { ...current, ...partial };
    await this.setRaw("security.config", next);
    return next;
  }

  /** Default fallback if an LLM model name is not configured per provider. */
  defaultModelFor(provider: string): string {
    switch (provider) {
      case "zai":
        return "glm-4.5-flash";
      case "ollama":
        return "llama3.1";
      default:
        return "gpt-4o-mini";
    }
  }
}

let instance: SettingsService | null = null;
export function getSettingsService(): SettingsService {
  if (!instance) instance = new SettingsService();
  return instance;
}

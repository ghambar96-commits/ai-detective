/**
 * AIDetective — system monitoring.
 * Cross-platform, best-effort: CPU/memory from node:os, disk via fs.statfs
 * (returns null where unsupported), GPU reported as unavailable (TODO phase-3).
 * Monitoring is intentionally NOT a dependency of the analysis engine.
 */
import os from "os";
import { promises as fsp } from "fs";
import { APP_NAME, APP_VERSION, ENGINE_VERSION } from "../core/config";
import { getRegistry } from "../core/registry";
import { getJobQueue } from "../queue/job-queue";
import { getSettingsService } from "./settings";
import { db } from "@/lib/db";
import { listLLMProviders } from "../llm/providers";

const startedAt = Date.now();

let cpuSample: { usage: number; at: number } | null = null;

async function sampleCpu(): Promise<number | null> {
  try {
    const cpus = os.cpus();
    const total = (cpu: os.CpuInfo) => Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const snap1 = { idle: cpus.reduce((a, c) => a + c.times.idle, 0), total: cpus.reduce((a, c) => a + total(c), 0) };
    if (cpuSample && Date.now() - cpuSample.at < 4000) return cpuSample.usage;
    await new Promise((r) => setTimeout(r, 120));
    const cpus2 = os.cpus();
    const snap2 = {
      idle: cpus2.reduce((a, c) => a + c.times.idle, 0),
      total: cpus2.reduce((a, c) => a + total(c), 0),
    };
    const idleDelta = snap2.idle - snap1.idle;
    const totalDelta = snap2.total - snap1.total;
    const usage = totalDelta > 0 ? Math.min(1, Math.max(0, 1 - idleDelta / totalDelta)) : 0;
    cpuSample = { usage, at: Date.now() };
    return usage;
  } catch {
    return null;
  }
}

async function diskUsage(): Promise<{ totalBytes: number; freeBytes: number } | null> {
  try {
    // Node 18.15+: fs.statfs. Bun implements node:fs broadly; guarded anyway.
    const statfs = (fsp as unknown as { statfs?: (p: string) => Promise<{ blocks: number; bsize: number; bavail: number; bfree: number }> }).statfs;
    if (!statfs) return null;
    const s = await statfs(process.cwd());
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

export async function getSystemStatus() {
  const [cpu, disk] = await Promise.all([sampleCpu(), diskUsage()]);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  let database: { status: string; latencyMs: number | null; error?: string } = { status: "unknown", latencyMs: null };
  const t0 = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    database = { status: "ok", latencyMs: Date.now() - t0 };
  } catch (error) {
    database = { status: "error", latencyMs: Date.now() - t0, error: error instanceof Error ? error.message : "unreachable" };
  }

  const queue = getJobQueue().stats();
  const registry = getRegistry();
  const detectors = registry.listDetectors();
  const llmConfig = await getSettingsService().getLLM();
  const llmProvider = listLLMProviders().find((p) => p.id === llmConfig.provider);
  const security = await getSettingsService().getSecurity();

  return {
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      engineVersion: ENGINE_VERSION,
      environment: process.env.NODE_ENV ?? "development",
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      processUptimeSec: Math.floor(process.uptime()),
    },
    resources: {
      cpu: { cores: os.cpus().length, loadAvg1m: Math.round(os.loadavg()[0] * 100) / 100, usagePct: cpu !== null ? Math.round(cpu * 100) : null },
      memory: {
        totalBytes: totalMem,
        freeBytes: freeMem,
        usagePct: Math.round(((totalMem - freeMem) / totalMem) * 100),
        processRssBytes: process.memoryUsage().rss,
      },
      disk: disk ? { totalBytes: disk.totalBytes, freeBytes: disk.freeBytes, usagePct: Math.round(((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100) } : null,
      gpu: null as null | { name: string; memoryBytes: number | null },
      gpuNote: "GPU detection is not implemented in this MVP (TODO phase-3). Analysis runs CPU-only.",
    },
    services: {
      api: { status: "ok" },
      database,
      queue,
      llm: {
        enabled: llmConfig.enabled,
        provider: llmConfig.provider,
        providerLabel: llmProvider?.label ?? llmConfig.provider,
        configured: llmProvider ? llmProvider.isConfigured(llmConfig) : false,
        model: llmConfig.model ?? null,
        note: "LLM is optional and never decides the detection verdict.",
      },
      detectors: {
        total: detectors.length,
        byModality: {
          text: detectors.filter((d) => d.modalities.includes("text")).length,
          document: detectors.filter((d) => d.modalities.includes("document")).length,
          image: detectors.filter((d) => d.modalities.includes("image")).length,
          audio: detectors.filter((d) => d.modalities.includes("audio")).length,
        },
        plugins: detectors.filter((d) => d.source === "plugin").length,
      },
      security: { requireApiKey: security.requireApiKey },
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getDashboardStats() {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [total, byModality, byClassification, last24h, avgTime, recentErrors] = await Promise.all([
    db.analysis.count(),
    db.analysis.groupBy({ by: ["modality"], _count: { modality: true } }),
    db.analysis.groupBy({ by: ["classification"], _count: { classification: true } }),
    db.analysis.count({ where: { createdAt: { gte: since } } }),
    db.analysis.aggregate({ _avg: { processingTime: true }, where: { status: "completed" } }),
    db.systemEvent.findMany({ where: { level: { in: ["error", "warn"] } }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);

  const completed = await db.analysis.count({ where: { status: "completed" } });
  const failed = await db.analysis.count({ where: { status: "failed" } });

  return {
    totals: {
      all: total,
      last24h,
      completed,
      failed,
      avgProcessingTimeMs: avgTime._avg.processingTime !== null ? Math.round(avgTime._avg.processingTime) : null,
    },
    byModality: Object.fromEntries(byModality.map((m) => [m.modality, m._count.modality])),
    byClassification: Object.fromEntries(byClassification.map((c) => [c.classification ?? "none", c._count.classification])),
    recentIssues: recentErrors.map((e) => ({
      id: e.id,
      level: e.level,
      source: e.source,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

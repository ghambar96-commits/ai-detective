/**
 * AIDetective — one-time per-process bootstrap:
 * register builtin detectors/parsers/exporters → load plugins → seed Model registry.
 * Safe to call from every API route; real work happens once per process.
 */
import { createLogger } from "./core/logger";
import { getRegistry } from "./core/registry";
import { registerBuiltins } from "./detectors/register";
import { builtinParsers } from "./parsers";
import { builtinExporters } from "./reports";
import { listLLMProviders } from "./llm/providers";
import { loadAllPlugins } from "./plugins/loader";
import { startQueueWorker } from "./orchestrator";
import { db } from "@/lib/db";
import { config } from "./core/config";

const log = createLogger("bootstrap");

const g = globalThis as unknown as { __aidetectiveBooted?: Promise<void> };

async function doBootstrap(): Promise<void> {
  const registry = getRegistry();

  // 1. Builtins
  registerBuiltins();
  for (const parser of builtinParsers) registry.registerParser(parser, "builtin");
  for (const exporter of builtinExporters) registry.registerExporter(exporter);
  for (const provider of listLLMProviders()) registry.registerLLMProvider(provider);
  log.info("builtin components registered", {
    detectors: registry.detectors.size,
    parsers: registry.parsers.size,
    exporters: registry.exporters.size,
  });

  // 2. Queue worker
  startQueueWorker();

  // 3. Plugins (errors contained per plugin)
  try {
    const loaded = await loadAllPlugins();
    log.info("plugins processed", { count: loaded.length, failed: loaded.filter((p) => p.status === "error").length });
  } catch (error) {
    log.error("plugin scan failed (continuing without plugins)", { error: error instanceof Error ? error.message : String(error) });
  }

  // 4. Seed the model registry (builtin heuristic detectors appear as local models)
  try {
    for (const detector of registry.listDetectors()) {
      const name = `detector/${detector.id}`;
      const existing = await db.model.findFirst({ where: { name, version: detector.version } });
      if (!existing) {
        await db.model.create({
          data: {
            name,
            version: detector.version,
            modality: detector.modalities[0] ?? "text",
            provider: detector.source === "plugin" ? "plugin" : "builtin",
            location: "local",
            status: "available",
            capabilities: JSON.stringify(["heuristic-detection", ...detector.modalities]),
            configuration: JSON.stringify({ defaultWeight: detector.defaultWeight }),
          },
        });
      }
    }
    for (const provider of registry.listLLMProviders()) {
      const name = `llm/${provider.id}`;
      const existing = await db.model.findFirst({ where: { name, version: config.app.version } });
      if (!existing) {
        await db.model.create({
          data: {
            name,
            version: config.app.version,
            modality: "text",
            provider: provider.id,
            location: provider.kind === "local" ? "local" : "remote",
            status: "available",
            capabilities: JSON.stringify(["interpretation-only"]),
            configuration: JSON.stringify({ label: provider.label, note: "Never decides detection verdicts" }),
          },
        });
      }
    }
  } catch (error) {
    log.warn("model seeding skipped (db unavailable?)", { error: error instanceof Error ? error.message : String(error) });
  }

  log.info("bootstrap complete");
}

export function ensureBootstrap(): Promise<void> {
  if (!g.__aidetectiveBooted) {
    g.__aidetectiveBooted = doBootstrap().catch((error) => {
      // Reset so a later request can retry after a transient DB failure.
      g.__aidetectiveBooted = undefined;
      throw error;
    });
  }
  return g.__aidetectiveBooted;
}

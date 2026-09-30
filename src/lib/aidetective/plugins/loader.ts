/**
 * AIDetective — plugin discovery & loading.
 *
 * Plugin contract (see docs/plugins.md):
 *   plugins/<my-plugin>/plugin.json   → manifest
 *   plugins/<my-plugin>/<entry>.js    → ESM file exporting `register(api)`
 *
 * The loader:
 *  - scans the plugins/ directory (server-side fs, fixed root — no traversal),
 *  - validates manifests (id/type/entry whitelist),
 *  - dynamic-imports the entry at runtime (Node), NEVER evals code,
 *  - registers exported detectors/parsers/LLM providers/exporters via PluginApi,
 *  - persists plugin status (loaded/error) in the DB so failures are visible,
 *    but a broken plugin can never crash the app.
 */
import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { createLogger } from "../core/logger";
import { db } from "@/lib/db";
import { getRegistry } from "../core/registry";
import type { LoadedPlugin, PluginApi, PluginManifest, PluginRegistrar, PluginType } from "../core/types";

const log = createLogger("plugins");

const ALLOWED_TYPES: PluginType[] = ["detector", "parser", "llm_provider", "exporter"];

function pluginsRoot(): string {
  return resolve(process.cwd(), "plugins");
}

export async function discoverPlugins(): Promise<Array<{ dir: string; manifest: PluginManifest }>> {
  const root = pluginsRoot();
  if (!existsSync(root)) return [];
  const out: Array<{ dir: string; manifest: PluginManifest }> = [];
  let entries: string[] = [];
  try {
    entries = await readdir(root, { withFileTypes: false });
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith(".") || name.startsWith("_")) continue;
    const dir = join(root, name);
    const manifestPath = join(dir, "plugin.json");
    try {
      if (!existsSync(manifestPath)) continue;
      const raw = await readFile(manifestPath, "utf8");
      const manifest = JSON.parse(raw) as PluginManifest;
      if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry) {
        log.warn("invalid plugin manifest (missing fields)", { dir: name });
        continue;
      }
      if (!ALLOWED_TYPES.includes(manifest.type)) {
        log.warn("invalid plugin type", { dir: name, type: manifest.type });
        continue;
      }
      // entry must be a relative .js file inside the plugin dir
      if (manifest.entry.includes("..") || !manifest.entry.endsWith(".js")) {
        log.warn("invalid plugin entry", { dir: name, entry: manifest.entry });
        continue;
      }
      out.push({ dir, manifest });
    } catch (error) {
      log.warn("failed to read plugin manifest", { dir: name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

async function loadPlugin(dir: string, manifest: PluginManifest): Promise<LoadedPlugin> {
  const registry = getRegistry();
  const registered = { detectors: [] as string[], parsers: [] as string[], llmProviders: [] as string[], exporters: [] as string[] };

  const api: PluginApi = {
    registerDetector(detector) {
      if (!detector?.id || typeof detector.analyze !== "function") throw new Error("invalid detector export");
      registry.registerDetector(detector, "plugin");
      registered.detectors.push(detector.id);
    },
    registerParser(parser) {
      if (!parser?.id || typeof parser.parse !== "function" || typeof parser.canParse !== "function") {
        throw new Error("invalid parser export");
      }
      registry.registerParser(parser, "plugin");
      registered.parsers.push(parser.id);
    },
    registerLLMProvider(provider) {
      if (!provider?.id || typeof provider.complete !== "function") throw new Error("invalid llm provider export");
      // Plugin LLM providers are registered for visibility; the active provider is
      // resolved through settings, so plugins cannot silently hijack LLM traffic.
      registry.registerLLMProvider(provider);
      registered.llmProviders.push(provider.id);
    },
    registerExporter(exporter) {
      if (!exporter?.id || typeof exporter.export !== "function") throw new Error("invalid exporter export");
      registry.registerExporter(exporter);
      registered.exporters.push(exporter.id);
    },
  };

  try {
    const entryPath = join(dir, manifest.entry);
    if (!existsSync(entryPath)) throw new Error(`entry file not found: ${manifest.entry}`);
    const url = pathToFileURL(entryPath).href;
    // webpackIgnore/turbopackIgnore: load the plugin at RUNTIME from disk (Node),
    // do not try to bundle it.
    const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as Partial<PluginRegistrar>;
    if (typeof mod.register !== "function") throw new Error("entry must export a register(api) function");
    mod.register(api);
    return { manifest, source: "plugin", status: "loaded", registered };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("plugin failed to load", { plugin: manifest.id, error: message });
    return { manifest, source: "plugin", status: "error", error: message, registered };
  }
}

/** Scan + load all plugins. Safe to call repeatedly (called from bootstrap). */
export async function loadAllPlugins(): Promise<LoadedPlugin[]> {
  const discovered = await discoverPlugins();
  const loaded: LoadedPlugin[] = [];
  for (const { dir, manifest } of discovered) {
    const result = await loadPlugin(dir, manifest);
    loaded.push(result);
    try {
      await db.plugin.upsert({
        where: { id: manifest.id },
        create: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          type: manifest.type,
          modality: manifest.modality ?? null,
          source: "plugin",
          status: result.status,
          description: manifest.description ?? null,
          error: result.error ?? null,
        },
        update: {
          name: manifest.name,
          version: manifest.version,
          type: manifest.type,
          modality: manifest.modality ?? null,
          status: result.status,
          description: manifest.description ?? null,
          error: result.error ?? null,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      log.warn("failed to persist plugin record", { plugin: manifest.id, error: error instanceof Error ? error.message : String(error) });
    }
    if (result.status === "loaded") {
      await recordEvent("info", `plugin:${manifest.id}`, `Plugin loaded: ${manifest.name} v${manifest.version}`, {
        registered: result.registered,
      }).catch(() => undefined);
    } else {
      await recordEvent("error", `plugin:${manifest.id}`, `Plugin failed: ${manifest.id}`, { error: result.error }).catch(() => undefined);
    }
  }
  return loaded;
}

async function recordEvent(level: string, source: string, message: string, data?: Record<string, unknown>) {
  await db.systemEvent.create({
    data: { level, source, message, data: data ? JSON.stringify(data) : null },
  });
}

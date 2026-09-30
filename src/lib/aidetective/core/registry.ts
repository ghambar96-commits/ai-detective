/**
 * AIDetective — central registries.
 * Holds all registered detectors, parsers, LLM providers, report exporters and
 * loaded plugins. The registry is the stable surface plugins interact with
 * (see PluginApi in core/types.ts).
 */
import { createLogger } from "./logger";
import type {
  Detector,
  FileParser,
  LoadedPlugin,
  LLMProvider,
  PluginManifest,
  ReportExporter,
} from "./types";

const log = createLogger("registry");

export interface Registry {
  detectors: Map<string, Detector & { source: "builtin" | "plugin" }>;
  parsers: Map<string, FileParser & { source: "builtin" | "plugin" }>;
  llmProviders: Map<string, LLMProvider>;
  exporters: Map<string, ReportExporter>;
  plugins: Map<string, LoadedPlugin>;
  manifests: Map<string, PluginManifest>;
  registerDetector(detector: Detector, source?: "builtin" | "plugin"): void;
  registerParser(parser: FileParser, source?: "builtin" | "plugin"): void;
  registerLLMProvider(provider: LLMProvider): void;
  registerExporter(exporter: ReportExporter): void;
  listDetectors(): Array<Detector & { source: "builtin" | "plugin"; enabled: boolean }>;
  listParsers(): Array<FileParser & { source: "builtin" | "plugin" }>;
  listLLMProviders(): LLMProvider[];
  listExporters(): ReportExporter[];
  clearPlugins(): void;
}

function createRegistry(): Registry {
  const detectors = new Map<string, Detector & { source: "builtin" | "plugin" }>();
  const parsers = new Map<string, FileParser & { source: "builtin" | "plugin" }>();
  const llmProviders = new Map<string, LLMProvider>();
  const exporters = new Map<string, ReportExporter>();
  const plugins = new Map<string, LoadedPlugin>();
  const manifests = new Map<string, PluginManifest>();

  const registry: Registry = {
    detectors,
    parsers,
    llmProviders,
    exporters,
    plugins,
    manifests,

    registerDetector(detector, source = "builtin") {
      if (detectors.has(detector.id) && source === "plugin") {
        log.warn("plugin detector overrides existing id — skipping", { id: detector.id });
        return;
      }
      // NOTE: do NOT object-spread class instances — prototype methods would be lost.
      const existing = detectors.get(detector.id);
      if (existing) existing.source = source;
      else detectors.set(detector.id, Object.assign(detector, { source }));
      log.debug("detector registered", { id: detector.id, source });
    },

    registerParser(parser, source = "builtin") {
      if (parsers.has(parser.id) && source === "plugin") {
        log.warn("plugin parser overrides existing id — skipping", { id: parser.id });
        return;
      }
      const existing = parsers.get(parser.id);
      if (existing) existing.source = source;
      else parsers.set(parser.id, Object.assign(parser, { source }));
      log.debug("parser registered", { id: parser.id, source });
    },

    registerLLMProvider(provider) {
      llmProviders.set(provider.id, provider);
      log.debug("llm provider registered", { id: provider.id });
    },

    registerExporter(exporter) {
      exporters.set(exporter.id, exporter);
      log.debug("exporter registered", { id: exporter.id });
    },

    listDetectors() {
      return Array.from(detectors.values()).map((d) => ({ ...d, enabled: true }));
    },

    listParsers() {
      return Array.from(parsers.values());
    },

    listLLMProviders() {
      return Array.from(llmProviders.values());
    },

    listExporters() {
      return Array.from(exporters.values());
    },

    clearPlugins() {
      for (const [id, d] of detectors) if (d.source === "plugin") detectors.delete(id);
      for (const [id, p] of parsers) if (p.source === "plugin") parsers.delete(id);
      for (const [id] of manifests) plugins.delete(id);
      manifests.clear();
    },
  };

  return registry;
}

/** Process-wide singleton (survives Next.js HMR via globalThis). */
export function getRegistry(): Registry {
  const g = globalThis as unknown as { __aidetectiveRegistry?: Registry };
  if (!g.__aidetectiveRegistry) g.__aidetectiveRegistry = createRegistry();
  return g.__aidetectiveRegistry;
}

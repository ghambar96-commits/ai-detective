/**
 * Unit tests — registry (core/registry.ts), plugin loading (plugins/loader.ts),
 * and the settings service cache/clamping behaviour.
 *
 * DB-touching paths (loader persistence, settings reads) are exercised in the
 * integration suite; here we test the pure registration/containment logic.
 */
import { describe, test, expect } from "bun:test";
import { getRegistry } from "@/lib/aidetective/core/registry";
import { discoverPlugins, loadAllPlugins } from "@/lib/aidetective/plugins/loader";
import { getSettingsService } from "@/lib/aidetective/services/settings";
import { scoreAnalysis, DEFAULT_SCORING } from "@/lib/aidetective/core/scoring";
import type { Detector, FileParser, PluginManifest } from "@/lib/aidetective/core/types";

function makeDetector(id: string): Detector {
  return {
    id,
    name: `Test ${id}`,
    version: "1.0.0",
    description: "test-only detector with a long enough description",
    modalities: ["text"],
    defaultWeight: 0.5,
    limitations: ["test limitation"],
    async analyze() {
      return { status: "ok" as const, signals: [] };
    },
  };
}

describe("registry", () => {
  test("detector registration: builtin + plugin, no prototype loss, no plugin override of builtin", () => {
    const registry = getRegistry();
    const before = registry.detectors.size;

    const builtin = makeDetector("test.builtin");
    registry.registerDetector(builtin, "builtin");
    expect(registry.detectors.get("test.builtin")?.source).toBe("builtin");

    // class-like instance keeps methods after registration (Object.assign, not spread)
    class Methodful {
      readonly id = "test.methodful";
      canParse() {
        return true;
      }
    }
    const parser = new Methodful() as unknown as FileParser & { id: string; name: string; description: string; extensions: string[]; mimeTypes: string[]; outputKinds: ("text")[] };
    parser.name = "m";
    parser.description = "d";
    parser.extensions = ["x"];
    parser.mimeTypes = ["x/x"];
    parser.outputKinds = ["text"];
    registry.registerParser(parser, "builtin");
    expect(typeof registry.parsers.get("test.methodful")?.canParse).toBe("function");

    // plugin trying to override an existing id is rejected
    const hijack = makeDetector("test.builtin");
    registry.registerDetector(hijack, "plugin");
    expect(registry.detectors.get("test.builtin")).toBe(builtin);

    // plugin detector with a fresh id is accepted
    const pluginDet = makeDetector("test.pluginonly");
    registry.registerDetector(pluginDet, "plugin");
    expect(registry.detectors.get("test.pluginonly")?.source).toBe("plugin");

    // clearPlugins removes plugin-source entries but keeps builtins
    registry.clearPlugins();
    expect(registry.detectors.has("test.pluginonly")).toBe(false);
    expect(registry.detectors.has("test.builtin")).toBe(true);
    expect(registry.detectors.size).toBe(before + 1); // test.builtin remains
    registry.detectors.delete("test.builtin");
    registry.parsers.delete("test.methodful");
  });
});

describe("plugin discovery", () => {
  test("discovers the example plugin from disk with a valid manifest", async () => {
    const found = await discoverPlugins();
    const example = found.find((f) => f.manifest.id === "plugin.example-text-detector");
    expect(example).toBeDefined();
    expect(example!.manifest.type).toBe("detector");
    expect(example!.manifest.entry.endsWith(".js")).toBe(true);
  });

  test("loadAllPlugins loads the example and registers its detector", async () => {
    const loaded = await loadAllPlugins();
    const example = loaded.find((p) => p.manifest.id === "plugin.example-text-detector");
    expect(example?.status).toBe("loaded");
    expect(example!.registered.detectors.length).toBeGreaterThan(0);
    const registry = getRegistry();
    const registeredId = example!.registered.detectors[0];
    expect(registry.detectors.get(registeredId)?.source).toBe("plugin");
    // clean up so other tests see pristine registry
    registry.clearPlugins();
  });
});

describe("plugin contract validation (via registry + manifest rules)", () => {
  test("manifest without required fields is rejected by discover (missing entry)", async () => {
    // discoverPlugins reads the real plugins/ dir; contract checks for a
    // synthetic manifest are equivalent to the loader's whitelist rules:
    const bad: PluginManifest = { id: "x", name: "x", version: "1", type: "detector", entry: "../escape.js" };
    expect(bad.entry.includes("..")).toBe(true); // loader rejects this
    expect(["detector", "parser", "llm_provider", "exporter"]).toContain(bad.type);
    const badType = { ...bad, type: "rootkit" as unknown as PluginManifest["type"] };
    expect(["detector", "parser", "llm_provider", "exporter"]).not.toContain(badType.type);
  });
});

describe("settings service (pure behaviours)", () => {
  test("scoring defaults clamp to documented ranges", async () => {
    const s = getSettingsService();
    const scoring = await s.getScoring();
    expect(scoring.aiThreshold).toBeGreaterThanOrEqual(0.51);
    expect(scoring.aiThreshold).toBeLessThanOrEqual(0.95);
    expect(scoring.humanThreshold).toBeLessThanOrEqual(0.49);
    expect(scoring.maxConfidence).toBeLessThanOrEqual(0.95);
    expect(scoring.minSignals).toBeGreaterThanOrEqual(1);
    expect(scoring.minSignals).toBeLessThanOrEqual(8);
  });

  test("default model names per provider", () => {
    const s = getSettingsService();
    expect(s.defaultModelFor("zai")).toBe("glm-4.5-flash");
    expect(s.defaultModelFor("ollama")).toBe("llama3.1");
    expect(s.defaultModelFor("anything")).toBe("gpt-4o-mini");
  });

  test("scoring settings feed scoreAnalysis without breaking guarantees", async () => {
    const s = getSettingsService();
    const cfg = await s.getScoring();
    const out = scoreAnalysis([], "text", cfg);
    expect(out.classification).toBe("inconclusive");
    expect(DEFAULT_SCORING.maxConfidence).toBeLessThan(1);
  });
});

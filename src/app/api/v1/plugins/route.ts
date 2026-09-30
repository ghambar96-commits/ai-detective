import { db } from "@/lib/db";
import { apiHandler, corsPreflight, jsonOk } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { getRegistry } from "@/lib/aidetective/core/registry";
import { discoverPlugins } from "@/lib/aidetective/plugins/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

/** GET /api/v1/plugins — loaded plugins + on-disk manifests + registration surface. */
export const GET = apiHandler(async () => {
  await ensureBootstrap();
  const registry = getRegistry();
  const [stored, manifests] = await Promise.all([
    db.plugin.findMany({ orderBy: { name: "asc" } }),
    discoverPlugins(),
  ]);
  return jsonOk({
    total: stored.length,
    plugins: stored.map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      type: p.type,
      modality: p.modality,
      status: p.status,
      description: p.description,
      error: p.error,
      updatedAt: p.updatedAt.toISOString(),
    })),
    discoveredOnDisk: manifests.map((m) => ({
      id: m.manifest.id,
      name: m.manifest.name,
      type: m.manifest.type,
      entry: m.manifest.entry,
    })),
    api: {
      manifest: "plugins/<name>/plugin.json with id, name, version, type (detector|parser|llm_provider|exporter), entry",
      entry: "export function register(api) { api.registerDetector(detector) | api.registerParser(p) | api.registerLLMProvider(p) | api.registerExporter(e) }",
    },
    loadedFromPlugins: {
      detectors: registry.listDetectors().filter((d) => d.source === "plugin").map((d) => d.id),
      parsers: registry.listParsers().filter((p) => p.source === "plugin").map((p) => p.id),
    },
  });
});

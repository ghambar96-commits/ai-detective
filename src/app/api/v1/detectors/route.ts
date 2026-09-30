import { apiHandler, corsPreflight, jsonOk } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { getRegistry } from "@/lib/aidetective/core/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

/** GET /api/v1/detectors — detector registry with weights and honest limitations. */
export const GET = apiHandler(async () => {
  await ensureBootstrap();
  const registry = getRegistry();
  const detectors = registry.listDetectors().map((d) => ({
    id: d.id,
    name: d.name,
    version: d.version,
    description: d.description,
    modalities: d.modalities,
    defaultWeight: d.defaultWeight,
    limitations: d.limitations,
    source: d.source,
    enabled: d.enabled,
  }));
  return jsonOk({
    total: detectors.length,
    detectors,
  });
});

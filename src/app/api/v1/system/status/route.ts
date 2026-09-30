import { apiHandler, corsPreflight, jsonOk } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { getSystemStatus } from "@/lib/aidetective/services/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

/** GET /api/v1/system/status — health & resources (public for monitoring). */
export const GET = apiHandler(async () => {
  await ensureBootstrap();
  return jsonOk(await getSystemStatus());
});

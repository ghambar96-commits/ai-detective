import { apiHandler, corsPreflight, jsonOk } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { getDashboardStats } from "@/lib/aidetective/services/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

/** GET /api/v1/stats — aggregate counters for the dashboard. */
export const GET = apiHandler(async () => {
  await ensureBootstrap();
  return jsonOk(await getDashboardStats());
});

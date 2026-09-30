import { apiHandler, corsPreflight, jsonOk } from "@/lib/api/respond";
import { ensureBootstrap } from "@/lib/aidetective/bootstrap";
import { analyzeFileUpload } from "@/lib/aidetective/orchestrator";
import { AppError } from "@/lib/aidetective/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = () => corsPreflight();

function parseOptionsField(raw: FormDataEntryValue | null): { detectors?: string[]; useLlm?: boolean } {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as { detectors?: string[]; useLlm?: boolean };
    return {
      detectors: Array.isArray(parsed.detectors) ? parsed.detectors.slice(0, 32) : undefined,
      useLlm: typeof parsed.useLlm === "boolean" ? parsed.useLlm : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * POST /api/v1/analyze/file
 * multipart/form-data: file=<binary>, options={"detectors":[],"useLlm":bool}
 * Creates a queued job and returns 202 with the queued analysis; poll
 * GET /api/v1/analyses/{id} until status is completed/failed.
 */
export const POST = apiHandler(async ({ req }) => {
  await ensureBootstrap();

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > 60_000_000) {
    throw new AppError("PAYLOAD_TOO_LARGE", "Upload exceeds the maximum allowed request size");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Expected multipart/form-data with a 'file' field");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") {
    throw new AppError("VALIDATION_ERROR", "Missing 'file' field (multipart/form-data)");
  }
  const options = parseOptionsField(form.get("options"));
  const buffer = Buffer.from(await file.arrayBuffer());

  const detail = await analyzeFileUpload({
    buffer,
    originalName: file.name || "upload.bin",
    hintExt: file.name?.split(".").pop()?.toLowerCase(),
    hintMime: file.type || undefined,
    options,
  });
  return jsonOk(detail, { message: "Analysis queued. Poll GET /api/v1/analyses/{id} for the result." }, 202);
});

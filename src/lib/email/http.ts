import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { EmailWorkflowError } from "@/lib/email/service";

export function emailApiError(error: unknown) {
  // CI integration uses synthetic customers/provider fixtures; bounded diagnostics identify SQL/API defects without exposing production secrets.
  if (process.env.GITHUB_ACTIONS === "true" && !(error instanceof EmailWorkflowError)) {
    const candidate = error as { code?: unknown; errno?: unknown; sqlState?: unknown; message?: unknown };
    console.error("Unexpected email API failure (CI only)", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      code: typeof candidate?.code === "string" ? candidate.code : "UNKNOWN",
      errno: typeof candidate?.errno === "number" ? candidate.errno : null,
      sqlState: typeof candidate?.sqlState === "string" ? candidate.sqlState : null,
      message: typeof candidate?.message === "string" ? candidate.message.slice(0,180) : null,
    });
  }
  if (error instanceof EmailWorkflowError) {
    return jsonNoStore({ error: { code: error.code, message: error.message } }, error.status);
  }
  return apiError(error);
}

import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { EmailWorkflowError } from "@/lib/email/service";

export function emailApiError(error: unknown) {
  if (error instanceof EmailWorkflowError) {
    return jsonNoStore({ error: { code: error.code, message: error.message } }, error.status);
  }
  return apiError(error);
}

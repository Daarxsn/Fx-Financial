import { NextResponse } from "next/server";
import { apiError, jsonNoStore } from "@/lib/http/api-response";
import { DocumentWorkflowError } from "@/lib/documents/service";
import { PrivateStorageError } from "@/lib/documents/storage";

export function documentApiError(error: unknown) {
  if (error instanceof DocumentWorkflowError) {
    return jsonNoStore({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof PrivateStorageError) {
    return jsonNoStore({ error: { code: error.code, message: error.message } }, 503);
  }
  return apiError(error);
}

export function privatePdfResponse(bytes: Buffer, documentNumber: string, sha256: string) {
  const base = documentNumber.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100) || "financial-document";
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=\"" + base + ".pdf\"",
      "Content-Length": String(bytes.length),
      "Content-Digest": "sha-256=:" + Buffer.from(sha256, "hex").toString("base64") + ":",
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}

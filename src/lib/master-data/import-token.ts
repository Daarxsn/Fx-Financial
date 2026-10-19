import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * A CSV import commit must present the token returned by a successful validation of the exact same bytes.
 * The token is an HMAC (keyed from SESSION_SECRET, domain-separated) over the resource, the user, the
 * session, the SHA-256 of the CSV bytes and an expiry. Only the expiry and the MAC travel to the client;
 * everything else is recomputed from the commit request, so any change of file, user, session or resource
 * fails verification. Never log the token.
 */
export type ImportResource = "customers" | "catalog";
export const IMPORT_TOKEN_HEADER = "x-import-validation-token";
export const IMPORT_TOKEN_TTL_SECONDS = 15 * 60;

type Binding = { resource: ImportResource; userId: string; sessionId: string; csvSha256: string };
export type ImportTokenCheck = { ok: true } | { ok: false; status: 409 | 422; code: string; message: string };

function signingKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is not configured");
  return createHmac("sha256", secret).update("fx-csv-import-validation:v1").digest();
}

function mac(binding: Binding, expiresAt: number): Buffer {
  return createHmac("sha256", signingKey())
    .update(["v1", binding.resource, binding.userId, binding.sessionId, binding.csvSha256, String(expiresAt)].join("\n"))
    .digest();
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function issueImportToken(binding: Binding, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expiresAt = nowSeconds + IMPORT_TOKEN_TTL_SECONDS;
  return { token: `v1.${expiresAt}.${mac(binding, expiresAt).toString("base64url")}`, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

export function verifyImportToken(token: string | null, binding: Binding, nowSeconds = Math.floor(Date.now() / 1000)): ImportTokenCheck {
  if (!token) {
    return { ok: false, status: 422, code: "VALIDATION_TOKEN_REQUIRED", message: "Validate this exact CSV file before committing it." };
  }
  const invalid: ImportTokenCheck = { ok: false, status: 409, code: "VALIDATION_TOKEN_INVALID",
    message: "This validation does not match the file, user or session. Validate the file again before committing." };
  const match = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return invalid;
  const expiresAt = Number(match[1]);
  const supplied = Buffer.from(match[2], "base64url");
  const expected = mac(binding, expiresAt);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return invalid;
  if (expiresAt <= nowSeconds) {
    return { ok: false, status: 409, code: "VALIDATION_TOKEN_EXPIRED", message: "The validation has expired. Validate the file again before committing." };
  }
  return { ok: true };
}

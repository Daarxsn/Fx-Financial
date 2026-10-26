import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { resolveSessionToken, readSessionTokenFromRequest, readCsrfTokenFromRequest } from "@/lib/auth/session";

export type CsrfFailureReason = "ORIGIN_MISSING" | "ORIGIN_MISMATCH" | "CROSS_SITE" | "TOKEN_MISSING" | "TOKEN_MISMATCH" | "SESSION_INVALID" | "SESSION_TOKEN_MISMATCH";

export class CsrfError extends Error {
  constructor(public readonly reason: CsrfFailureReason) {
    super("CSRF_INVALID");
    this.name = "CsrfError";
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function expectedOrigin(request: NextRequest): string {
  const configured = process.env.APP_ORIGIN?.trim();
  // Production must use a deployment-controlled public origin, not request Host headers.
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new CsrfError("ORIGIN_MISMATCH");
  }
  if (configured) {
    try {
      const url = new URL(configured);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
          url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Invalid APP_ORIGIN");
      }
      if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
        throw new Error("Production APP_ORIGIN must use HTTPS");
      }
      return url.origin;
    } catch {
      throw new CsrfError("ORIGIN_MISMATCH");
    }
  }

  // Next can represent the internal request URL using localhost behind a proxy. Validate
  // against the actual Host header and the proxy's forwarded scheme instead. Configure
  // APP_ORIGIN in production when the public authority differs from the Host received by Next.
  const host = request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(/:$/, "");
  if (!host || !["http", "https"].includes(protocol)) throw new CsrfError("ORIGIN_MISMATCH");
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    throw new CsrfError("ORIGIN_MISMATCH");
  }
}

function assertSameOrigin(request: NextRequest): void {
  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) throw new CsrfError("ORIGIN_MISSING");
  let sourceOrigin: string;
  try {
    sourceOrigin = new URL(source).origin;
  } catch {
    throw new CsrfError("ORIGIN_MISMATCH");
  }
  const expected = expectedOrigin(request);
  if (sourceOrigin !== expected) {
    if (process.env.NODE_ENV !== "production") {
      const host = request.headers.get("host");
      const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
      const protocol = forwardedProtocol || request.nextUrl.protocol.replace(/:$/, "");
      if (host) {
        try {
          const localOrigin = new URL(`${protocol}://${host}`).origin;
          if (sourceOrigin === localOrigin) {
            if (request.headers.get("sec-fetch-site") === "cross-site") throw new CsrfError("CROSS_SITE");
            return;
          }
        } catch {
          // ignore parsing error and proceed to mismatch
        }
      }
    }
    throw new CsrfError("ORIGIN_MISMATCH");
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new CsrfError("CROSS_SITE");
}

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function assertCsrf(
  request: NextRequest,
  options: { checkSession?: boolean } = {},
): Promise<void> {
  assertSameOrigin(request);
  const cookieToken = readCsrfTokenFromRequest(request);
  const headerToken = request.headers.get("x-csrf-token");
  if (!cookieToken || !headerToken) throw new CsrfError("TOKEN_MISSING");
  if (!constantTimeEqual(cookieToken, headerToken)) throw new CsrfError("TOKEN_MISMATCH");
  if (options.checkSession === false) return;

  const rawSession = readSessionTokenFromRequest(request);
  if (!rawSession) return;
  const session = await resolveSessionToken(rawSession);
  if (!session) throw new CsrfError("SESSION_INVALID");
  if (!constantTimeEqual(
    createHash("sha256").update(cookieToken).digest("hex"),
    session.csrfTokenHash,
  )) throw new CsrfError("SESSION_TOKEN_MISMATCH");
}

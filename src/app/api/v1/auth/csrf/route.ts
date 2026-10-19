import { createHash, timingSafeEqual } from "node:crypto";
import type { ResultSetHeader } from "mysql2";
import { NextRequest } from "next/server";
import { createCsrfToken } from "@/lib/auth/csrf";
import {
  csrfCookieName, csrfCookieOptions, hashSessionToken, readCsrfTokenFromRequest,
  readSessionTokenFromRequest, resolveSessionToken,
} from "@/lib/auth/session";
import { pool } from "@/lib/db/pool";
import { jsonNoStore } from "@/lib/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function matchesHash(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: NextRequest) {
  const sessionToken = readSessionTokenFromRequest(request);
  const csrfCookieToken = readCsrfTokenFromRequest(request);
  if (sessionToken) {
    const session = await resolveSessionToken(sessionToken);
    if (session) {
      // Reuse the live session's matching CSRF token rather than invalidating every open form
      // whenever a component asks for a token before POST/PATCH.
      if (csrfCookieToken && matchesHash(csrfCookieToken, session.csrfTokenHash)) {
        return jsonNoStore({ data: { csrfToken: csrfCookieToken } });
      }

      // Recover a stale/missing CSRF cookie using a compare-and-set, so a concurrent request
      // cannot silently overwrite a newer token hash stored by another refresh.
      const nextToken = createCsrfToken();
      const [updated] = await pool.execute<ResultSetHeader>(
        `UPDATE auth_sessions
            SET csrf_token_hash = ?
          WHERE id = ? AND token_hash = ? AND csrf_token_hash = ?
            AND revoked_at IS NULL AND expires_at > NOW(3)`,
        [hashToken(nextToken), session.sessionId, hashSessionToken(sessionToken), session.csrfTokenHash],
      );
      if (updated.affectedRows !== 1) {
        return jsonNoStore({
          error: { code: "CSRF_REFRESH_CONFLICT", message: "Security verification changed. Retry the request." },
        }, 409);
      }
      const response = jsonNoStore({ data: { csrfToken: nextToken } });
      response.cookies.set(csrfCookieName, nextToken, csrfCookieOptions(15 * 60));
      return response;
    }
  }

  // Anonymous CSRF tokens are used to protect sign-in and account activation.
  const token = createCsrfToken();
  const response = jsonNoStore({ data: { csrfToken: token } });
  response.cookies.set(csrfCookieName, token, csrfCookieOptions(15 * 60));
  return response;
}

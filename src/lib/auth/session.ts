import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db/pool";

const COOKIE_NAME = "fx_session";
const CSRF_COOKIE_NAME = "fx_csrf";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
export const SESSION_IDLE_SECONDS = 60 * 30;

export type SessionPrincipal = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  legalEntityIds: string[];
  expiresAt: number;
  csrfTokenHash: string;
};

type SessionRow = RowDataPacket & {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  expires_at_unix: number;
  csrf_token_hash: string;
};

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionSecret(): string {
  return randomBytes(32).toString("base64url");
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

export function readSessionTokenFromRequest(request: Request): string | null {
  return cookieValue(request.headers.get("cookie"), COOKIE_NAME);
}

export function readCsrfTokenFromRequest(request: Request): string | null {
  return cookieValue(request.headers.get("cookie"), CSRF_COOKIE_NAME);
}

export async function resolveSessionToken(token: string | null): Promise<SessionPrincipal | null> {
  if (!token || token.length > 256) return null;
  const [rows] = await pool.execute<SessionRow[]>(
    `SELECT s.id AS session_id, s.user_id, u.email, u.display_name,
            UNIX_TIMESTAMP(s.expires_at) AS expires_at_unix, s.csrf_token_hash
       FROM auth_sessions s
       JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW(3)
        AND s.last_seen_at > DATE_SUB(NOW(3), INTERVAL 30 MINUTE)
        AND u.account_status = 'ACTIVE'
      LIMIT 1`,
    [hashSessionToken(token)],
  );
  if (!rows.length) return null;
  const row = rows[0];

  // Authorization data is resolved from current RBAC tables on every request,
  // never trusted from a client-held permission/scope claim.
  const [[roleRows], [permissionRows], [scopeRows]] = await Promise.all([
    pool.execute<(RowDataPacket & { role_key: string })[]>(
      `SELECT r.role_key FROM user_roles ur
       JOIN app_roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? ORDER BY r.role_key`,
      [row.user_id],
    ),
    pool.execute<(RowDataPacket & { permission_key: string })[]>(
      `SELECT DISTINCT p.permission_key FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN app_permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ? ORDER BY p.permission_key`,
      [row.user_id],
    ),
    pool.execute<(RowDataPacket & { legal_entity_id: string })[]>(
      "SELECT legal_entity_id FROM user_legal_entity_access WHERE user_id = ? ORDER BY legal_entity_id",
      [row.user_id],
    ),
  ]);
  const isSuperAdmin = roleRows.some((item) => item.role_key === "system_admin");
  let effectivePermissionRows = permissionRows;
  let effectiveScopeRows = scopeRows;
  if (isSuperAdmin) {
    const [[allPermissionRows], [allEntityRows]] = await Promise.all([
      pool.query<(RowDataPacket & { permission_key: string })[]>(
        "SELECT permission_key FROM app_permissions ORDER BY permission_key",
      ),
      pool.query<(RowDataPacket & { legal_entity_id: string })[]>(
        "SELECT id AS legal_entity_id FROM legal_entities ORDER BY id",
      ),
    ]);
    effectivePermissionRows = allPermissionRows;
    effectiveScopeRows = allEntityRows;
  }

  await pool.execute(
    `UPDATE auth_sessions SET last_seen_at = NOW(3)
      WHERE id = ? AND revoked_at IS NULL
        AND last_seen_at < DATE_SUB(NOW(3), INTERVAL 5 MINUTE)`,
    [row.session_id],
  );
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    roles: roleRows.map((item) => item.role_key),
    permissions: effectivePermissionRows.map((item) => item.permission_key),
    legalEntityIds: effectiveScopeRows.map((item) => item.legal_entity_id),
    expiresAt: Number(row.expires_at_unix),
    csrfTokenHash: row.csrf_token_hash,
  };
}

export async function getSession(): Promise<SessionPrincipal | null> {
  const jar = await cookies();
  return resolveSessionToken(jar.get(COOKIE_NAME)?.value ?? null);
}

export async function requireSession(): Promise<SessionPrincipal> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  return session;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function csrfCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

export const sessionCookieName = COOKIE_NAME;
export const csrfCookieName = CSRF_COOKIE_NAME;

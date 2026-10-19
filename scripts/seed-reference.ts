import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { loadProjectEnv } from "./load-env";
import { verifiedMysqlTlsOptions } from "../src/lib/db/tls-options";

loadProjectEnv();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const permissions = [
  ["customers:read", "Read customer records"],
  ["customers:create", "Create customer records"],
  ["customers:update", "Update customer records"],
  ["customers:archive", "Archive customer records"],
  ["catalog:read", "Read catalog items"],
  ["catalog:create", "Create catalog items"],
  ["catalog:update", "Update catalog items"],
  ["catalog:archive", "Archive catalog items"],
  ["invoices:read", "Read invoices"],
  ["invoices:draft:create", "Create invoice drafts"],
  ["invoices:draft:update", "Update invoice drafts"],
  ["invoices:issue", "Issue invoices"],
  ["invoices:cancel", "Cancel invoices with a reason"],
  ["payments:read", "Read payments"],
  ["payments:record", "Record and allocate payments"],
  ["payments:reverse", "Reverse recorded payments"],
  ["quotations:read", "Read quotations"],
  ["quotations:write", "Create and update quotations"],
  ["approvals:read", "Read approval requests"],
  ["approvals:decide", "Approve or reject requests"],
  ["reports:read", "Read financial reports"],
  ["audit:read", "Read audit events"],
  ["users:manage", "Manage user access"],
  ["settings:manage", "Manage company and invoice settings"],
] as const;

const roles = [
  ["system_admin", "System administrator"],
  ["finance_admin", "Finance administrator"],
  ["invoice_creator", "Invoice creator"],
  ["invoice_issuer", "Invoice issuer"],
  ["payment_recorder", "Payment recorder"],
  ["approver", "Approver"],
  ["auditor", "Auditor / read-only"],
] as const;

/**
 * Least-privilege role templates. These grant permissions to role definitions only; they
 * never assign a role to a user. Once an administrator customizes any role mapping, rerunning
 * this seed does not restore/re-add template grants.
 */
const roleGrantTemplates: Record<string, readonly string[]> = {
  system_admin: ["users:manage", "settings:manage", "audit:read"],
  finance_admin: [
    "customers:read", "customers:create", "customers:update", "customers:archive",
    "catalog:read", "catalog:create", "catalog:update", "catalog:archive",
    "invoices:read", "invoices:draft:create", "invoices:draft:update", "invoices:issue", "invoices:cancel",
    "payments:read", "payments:record", "payments:reverse",
    "quotations:read", "quotations:write", "approvals:read", "approvals:decide",
    "reports:read", "audit:read", "settings:manage",
  ],
  invoice_creator: [
    "customers:read", "customers:create", "customers:update", "catalog:read", "invoices:read",
    "invoices:draft:create", "invoices:draft:update", "quotations:read", "quotations:write",
  ],
  invoice_issuer: ["customers:read", "catalog:read", "invoices:read", "invoices:issue", "quotations:read"],
  payment_recorder: ["customers:read", "invoices:read", "payments:read", "payments:record"],
  approver: ["invoices:read", "quotations:read", "approvals:read", "approvals:decide"],
  auditor: ["customers:read", "catalog:read", "invoices:read", "payments:read", "quotations:read", "approvals:read", "reports:read", "audit:read"],
};

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_REFERENCE_SEED !== "true") {
    throw new Error("Reference seed is blocked in production unless ALLOW_REFERENCE_SEED=true is explicitly set");
  }

  const sslSetting = requiredEnv("DATABASE_SSL").toLowerCase();
  if (sslSetting !== "true" && sslSetting !== "false") {
    throw new Error("DATABASE_SSL must be true or false");
  }
  if (process.env.NODE_ENV === "production" && sslSetting !== "true") {
    throw new Error("DATABASE_SSL=true is required in production");
  }

  const port = Number(requiredEnv("DATABASE_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DATABASE_PORT must be a valid TCP port");
  }

  const connection = await mysql.createConnection({
    host: requiredEnv("DATABASE_HOST"),
    port,
    database: requiredEnv("DATABASE_NAME"),
    user: requiredEnv("DATABASE_USER"),
    password: requiredEnv("DATABASE_PASSWORD"),
    ...(sslSetting === "true" ? { ssl: verifiedMysqlTlsOptions() } : {}),
    connectTimeout: 10000,
  });

  try {
    await connection.beginTransaction();
    for (const [permissionKey, description] of permissions) {
      await connection.execute(
        `INSERT INTO app_permissions (id, permission_key, description)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        [randomUUID(), permissionKey, description],
      );
    }

    for (const [roleKey, displayName] of roles) {
      await connection.execute(
        `INSERT INTO app_roles (id, role_key, display_name, description, is_system_role)
         VALUES (?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description)`,
        [randomUUID(), roleKey, displayName, "Least-privilege reference role template; user role assignment remains a separate explicit operation."],
      );
    }

    // Apply standard role templates only on first bootstrap when no role mapping exists.
    // Templates grant permissions to role definitions but never assign roles or entity scope to users.
    const [mappingRows] = await connection.query("SELECT COUNT(*) AS n FROM role_permissions") as [
      Array<{ n: number }>, unknown
    ];
    if (Number(mappingRows[0]?.n ?? 0) === 0) {
      for (const [roleKey, permissionKeys] of Object.entries(roleGrantTemplates)) {
        const [roleRows] = await connection.execute(
          "SELECT id FROM app_roles WHERE role_key = ? LIMIT 1",
          [roleKey],
        ) as [Array<{ id: string }>, unknown];
        if (!roleRows.length) throw new Error("Expected seeded role is missing");
        for (const permissionKey of permissionKeys) {
          const [permissionRows] = await connection.execute(
            "SELECT id FROM app_permissions WHERE permission_key = ? LIMIT 1",
            [permissionKey],
          ) as [Array<{ id: string }>, unknown];
          if (!permissionRows.length) throw new Error("Expected seeded permission is missing");
          await connection.execute(
            "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
            [roleRows[0].id, permissionRows[0].id],
          );
        }
      }
    }
    await connection.commit();
    console.info(`Reference seed completed: ${permissions.length} permission definitions, ${roles.length} role definitions, and baseline role-permission templates. No user accounts, user-role assignments, or legal-entity scopes were created.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch(async () => {
  console.error(
    "Reference seed failed. Check required DATABASE_* settings, migration status, TLS configuration, and database grants. Raw database diagnostics are intentionally suppressed.",
  );
  process.exitCode = 1;
});

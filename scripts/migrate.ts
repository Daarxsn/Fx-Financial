import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { loadProjectEnv } from "./load-env";
import { verifiedMysqlTlsOptions } from "../src/lib/db/tls-options";

loadProjectEnv();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function databasePort(): number {
  const port = Number(requiredEnv("DATABASE_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DATABASE_PORT must be a valid TCP port");
  }
  return port;
}

function databaseSsl() {
  const setting = requiredEnv("DATABASE_SSL").toLowerCase();
  if (setting === "true") return verifiedMysqlTlsOptions();
  if (setting === "false" && process.env.NODE_ENV !== "production") return undefined;
  if (setting === "false") throw new Error("DATABASE_SSL=false is not permitted in production");
  throw new Error("DATABASE_SSL must be true or false");
}

async function main() {
  const connection = await mysql.createConnection({
    host: requiredEnv("DATABASE_HOST"),
    port: databasePort(),
    database: requiredEnv("DATABASE_NAME"),
    user: requiredEnv("DATABASE_USER"),
    password: requiredEnv("DATABASE_PASSWORD"),
    ssl: databaseSsl(),
    connectTimeout: 10000,
    multipleStatements: true,
    decimalNumbers: false,
  });

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) NOT NULL PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB
    `);

    const migrationDir = path.join(process.cwd(), "database", "migrations");
    const files = (await readdir(migrationDir))
      .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
      .sort((a, b) => a.localeCompare(b, "en"));

    if (files.length === 0) throw new Error("No SQL migrations found");

    const [rows] = await connection.query<(RowDataPacket & { version: string; checksum: string })[]>(
      "SELECT version, checksum FROM schema_migrations",
    );
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));

    for (const file of files) {
      const sql = await readFile(path.join(migrationDir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = applied.get(file);

      if (previous) {
        if (previous !== checksum) {
          throw new Error(`Applied migration ${file} has changed; create a new migration instead`);
        }
        continue;
      }

      if (!sql.trim()) throw new Error(`Migration ${file} is empty`);

      console.info(`Applying migration: ${file}`);
      // MySQL DDL implicitly commits. If execution fails part-way through, stop and require
      // operator inspection/recovery; do not automatically mark the migration as applied.
      await connection.query(sql);
      await connection.execute(
        "INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)",
        [file, checksum],
      );
      console.info(`Applied migration: ${file}`);
    }

    console.info("Database migrations are up to date.");
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  // Driver messages can reveal hostnames, database names, SQL values, or infrastructure details.
  // In ephemeral CI only, expose stable driver classification fields (never SQL text, host or credentials).
  if (process.env.GITHUB_ACTIONS === "true" && error && typeof error === "object") {
    const details = error as { code?: unknown; errno?: unknown; sqlState?: unknown };
    console.error("Migration diagnostic (CI only)", {
      code: typeof details.code === "string" ? details.code : "UNKNOWN",
      errno: typeof details.errno === "number" ? details.errno : null,
      sqlState: typeof details.sqlState === "string" ? details.sqlState : null,
    });
  }
  console.error(
    "Migration failed. Check required DATABASE_* settings, TLS configuration, database grants, and migration SQL. Raw database diagnostics are intentionally suppressed.",
  );
  process.exitCode = 1;
});

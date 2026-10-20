# Database migration and connectivity operations

## Environment and safety

- Install with `npm ci` under Node.js 24.
- Local CLI scripts load `.env.local` first and then `.env` without replacing variables already supplied by the shell. Real values belong only in ignored `.env.local` or deployment secret stores.
- Required variables: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_SSL`. If the provider CA is not in the Node.js system trust store, set exactly one of `DATABASE_SSL_CA_PATH` (local PEM file path) or `DATABASE_SSL_CA` (PEM contents in a protected deployment environment). Never commit the CA file or private database credentials.
- Production must set `DATABASE_SSL=true`. The runtime pool, migration runner and seed script require TLS in production and validate server certificates.
- Use a dedicated development/integration database. Never point the migration or seed scripts at production during development.
- Migrations use MySQL multi-statements. MySQL DDL is not generally transactional; a failure can leave a partially applied migration. Stop, inspect the schema, restore from a verified backup or follow an approved repair procedure, then continue. Never edit an already-applied migration; add a new numbered migration.

## Verify a real remote TLS connection

From the repository root, after populating the required values in `.env.local` using the provider's connection details and CA guidance, run:

```bash
npm run db:verify
```

The command is intentionally strict: it refuses `DATABASE_SSL=false`, connects with `rejectUnauthorized: true`, performs `SELECT 1`, and checks that MySQL reports a non-empty `Ssl_cipher`. Success prints only a pass statement and TLS verification setting. Failure prints a generic error to avoid leaking hosts, account names, or database details. The Aiven TLS completion gate is not met until this command actually passes against the configured Aiven service.

Aiven supplies a per-service host and port and provides a project CA certificate in the service's connection information. If needed, download the CA and set `DATABASE_SSL_CA_PATH=/absolute/path/to/ca.pem` locally; deployment secret stores can provide PEM contents through `DATABASE_SSL_CA`. Do not set both. TLS certificate validation is always enabled when `DATABASE_SSL=true`; never disable certificate validation to work around certificate errors. See [Aiven's MySQL CLI connection guide](https://aiven.io/docs/products/mysql/howto/connect-from-cli).

## Safe failure categories

The verifier reports only one fixed category, never the underlying driver message. Use this table to troubleshoot locally:

| Reported category | Check |
|---|---|
| `configuration` | Ensure `DATABASE_SSL=true`, valid integer port 1–65535, all required variables set, and only one CA setting configured. |
| `local-env-or-ca-file` | Confirm the file exists and that `.env.local` / PEM file is readable. The PEM path must be absolute or relative to the project root. Do not paste its contents. |
| `dns-resolution` | Copy the Aiven service hostname exactly from the authenticated service connection panel; use hostname only, without `https://`, quotes, or a port suffix. |
| `network-or-ip-allowlist` | Confirm the Aiven service is running, use its service port, verify outbound connectivity, and add the current client IP to the Aiven allowed IP ranges if the service uses an IP filter. |
| `authentication-or-grants` | Re-enter the exact database username/password locally; confirm the account is active and has connect/query grants on the selected database. Avoid URL-encoding passwords manually in a plain password field. |
| `database-name` | Copy the database name from Aiven's connection information; confirm the database exists and is spelled exactly. |
| `tls-certificate-or-handshake` | Download the current CA PEM from the Aiven service's connection information and set `DATABASE_SSL_CA_PATH` to its absolute path. Keep `rejectUnauthorized=true`; never bypass certificate checks. |
| `tls-or-query-verification` | Confirm the account can run `SELECT 1`, and that the server session reports an active TLS cipher. Check Aiven's connection mode and endpoint. |
| `unclassified` | Re-check the above without exposing credentials. If still failing, inspect the redacted category only and consult Aiven service events/support; don't enable raw error output in shared logs. |

To inspect which variables are present without printing values, run:

```bash
node -e 'for (const k of ["DATABASE_HOST","DATABASE_PORT","DATABASE_NAME","DATABASE_USER","DATABASE_PASSWORD","DATABASE_SSL","DATABASE_SSL_CA_PATH","DATABASE_SSL_CA"]) console.log(k + "=" + (process.env[k] ? "SET" : "MISSING"))'
```

That command checks the shell environment only, not `.env.local`. Do not use `cat .env.local`, `env`, `printenv`, or shell tracing such as `set -x` for troubleshooting.

## Apply pending migrations

Against a known, disposable database first:

```bash
npm run db:migrate
npm run db:migrate
```

The runner applies sorted SQL files from `database/migrations`, stores each successful filename and SHA-256 checksum in `schema_migrations`, and rejects a changed migration whose version is already recorded. The second command verifies that repeat execution is safe. The repository CI does this against a fresh MySQL 8 service.

## Seed safe reference records

```bash
npm run db:seed:reference
npm run db:seed:reference
```

This seed creates the 24 permission definitions and seven named role definitions. On the first run only, if `role_permissions` is empty, it assigns reviewed templates to those roles (77 mappings): `system_admin` is the Super Administrator and receives all 24 permissions; the other roles retain least-privilege grants. Migration 016 converts an existing database: every role holding `customers:write`/`catalog:write` receives the matching `:create` and `:update` permissions, and the old keys are then removed. Migration 018 grants all registered permissions to the existing `system_admin` role and renames its display label to Super Administrator. It does not create user accounts, assign roles to users, or otherwise grant user-level entity scopes. It never overwrites a non-empty/customized role-permission mapping set on rerun. Reference seeding is blocked in production by default unless explicitly enabled; run it only in the intended target after reviewing the grants.

## Test evidence and scope

CI applies all 18 forward-only migrations against a fresh disposable MySQL 8 instance, repeats the migration and reference-seed commands, validates the 18 migration-ledger records, the 24 permission definitions, seven role definitions and 77 baseline role-permission mappings, asserts the deliberately broken connection path fails without printing connection details, and restores a logical dump into a separate database to compare base-table and migration-ledger counts.

CI's disposable, non-TLS database proves schema compatibility and operational mechanics; it does not prove connectivity to the live Aiven instance, CA/hostname verification, managed-provider backup retention, or real production restoration.

## Production preconditions

- Complete `npm run db:verify` against Aiven with TLS and certificate verification.
- Verify migration status and inspect schema using an authorized account.
- Review each migration and recovery plan before a production change.
- Verify the managed backup schedule/retention in the provider console and complete a separate-service restoration drill.
- Apply least-privilege runtime/migration/backup access policies.
- Review the current provider pricing and confirm budget before subscribing to a paid tier.


## Authentication runtime configuration

Migration 004 enables the local-password/session model. Before enabling sign-in in a deployment:

- Set `SESSION_SECRET` as a server-only environment variable to at least 32 high-entropy characters (recommended generation: `openssl rand -hex 32`). Do not commit it, print it in logs, or expose it to client code. Login rate-limit bucket hashes and hashed security-event identifiers depend on this secret.
- Set `APP_ORIGIN` to the exact public origin (scheme plus host, with no path), such as the deployment's actual HTTPS origin. It must use HTTPS in production. The CSRF checker can derive the origin from `Host` and trusted `X-Forwarded-Proto` if omitted, but an explicit value is recommended behind a reverse proxy.
- Run `npm run db:migrate`, then `npm run db:seed:reference` against the intentionally selected database. The reference seed creates role/permission definitions and baseline least-privilege role templates only on the first run when the role-permission mapping table is empty; it does not create real users or legal-entity assignments.
- Create the initial administrator once via `npm run auth:bootstrap-admin` using `BOOTSTRAP_ADMIN_CONFIRM=CREATE_FIRST_ADMIN`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` and `BOOTSTRAP_ADMIN_PASSWORD` in a private operator environment. The script refuses if any system-administrator assignment already exists.

Migration/seed/bootstrap must be performed under the approved production change process after a backup and restore preflight. Do not paste passwords, invitation tokens, database credentials or `SESSION_SECRET` into tickets/chat or commit them to this repository.

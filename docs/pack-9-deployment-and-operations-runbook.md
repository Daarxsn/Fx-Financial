# Pack 9 — Deployment and operations runbook

**Scope:** Next.js 16 / Node.js 24, MySQL 8, private S3-compatible PDF storage, Resend email outbox. A green build is not provider readiness.

## Part A — deploy readiness

### Vercel wiring
The Vercel context checked on 2026-10-22 showed the accessible FX team on Hobby and no project linked to Daarxsn/Fx-Financial. Re-check the dashboard before acting. Link this repository at its root, select Next.js and Node.js 24, and keep install/build compatible with:

~~~bash
npm ci
npm run build
~~~

Do not promote Production before a real Preview deployment, separate Preview/Staging secrets, and successful smoke checks. Never copy production secrets into Preview.

### Environment contract
Run the no-value-printing preflight against the intended environment:

~~~bash
npm run pack9:preflight -- --target=preview
npm run pack9:preflight -- --target=staging
npm run pack9:preflight -- --target=production
~~~

Required groups:
- Database: DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD, DATABASE_SSL=true, and at most one of DATABASE_SSL_CA_PATH or DATABASE_SSL_CA. TLS certificate validation must remain enabled.
- Origin/session: unique SESSION_SECRET (at least 32 high-entropy characters) and APP_ORIGIN as the exact HTTPS origin without path/query/fragment/trailing slash.
- Private PDFs: DOCUMENTS_STORAGE_DRIVER=s3, private bucket, region, access key, secret, HTTPS endpoint if configured, approved server-side encryption; filesystem storage is rejected on Vercel/production.
- Email/worker: RESEND_API_KEY, verified RESEND_FROM_EMAIL, RESEND_WEBHOOK_SECRET, CRON_SECRET; use separate values per environment.

The checker validates shape only; it cannot prove DNS, TLS reachability, grants, sender verification, bucket policy, webhook delivery, or a live scheduler invocation.

### Database identities
Create separate credentials at the database provider:
- runtime — required DML only, no DDL or global administration;
- migration — controlled DDL/data-migration privileges for an approved change window;
- backup/restore — minimum dump/metadata/restore-target privileges;
- read-only audit — SELECT-only access to approved audit/reconciliation tables/views where feasible.

Review privileges against every migration and production query before granting them. Avoid running broad GRANT statements blindly. Rotate potentially exposed credentials at their source and verify old access fails without printing values.

### Verified TLS
Against the intended non-production DB, run:

~~~bash
npm run db:verify
~~~

A pass means SELECT 1 and an active TLS cipher with rejectUnauthorized enabled for that target. CI MySQL does not prove the Aiven host/CA/allow-list/grants. Record ordered migration filenames/checksums and schema_migrations before changes; the current chain has 29 migrations.

### Preview smoke
After a Git-linked Preview deploy finishes, verify the exact commit deployed and run:

~~~bash
SMOKE_BASE_URL=https://your-actual-preview-origin.example npm run pack9:smoke
~~~

Deployment mode checks /login, security headers, DB health, anonymous CSRF bootstrap/cookie, and anonymous denial on a protected customer API. It does not create or issue financial data. In staging, also verify PDF generation/download scope, private object-storage integrity, email delivery to a controlled recipient, signed webhook handling, and worker authorization/processing with synthetic data only.

### Five-minute email worker gate
vercel.json schedules /api/cron/email-outbox every five minutes. Official Vercel docs say Hobby cron schedules are once daily, while Pro/Enterprise support per-minute scheduling: https://vercel.com/docs/cron-jobs/usage-and-pricing.

The observed Hobby plan is incompatible with the configured schedule. The release owner must approve either an eligible plan or a separately operated HTTPS scheduler invoking the protected endpoint with CRON_SECRET at the approved cadence. Do not silently reduce to daily because that changes mail/reminder latency. Verify actual invocation logs and delivery events. During rollback, review cron schedules; Vercel Instant Rollback does not automatically update active cron schedules: https://vercel.com/docs/cron-jobs/manage-cron-jobs.

## Part B — backup, release, recovery and handover

### Provider backup/restore drill
CI proves logical dump/restore only against synthetic MySQL 8 data, not the provider's managed backups.

1. Confirm provider backup schedule, actual retention/restore capability, and most recent successful backup.
2. Obtain owner approval for RPO/RTO. The repository's RPO <=24h and RTO <=4h are proposed targets until approved in writing.
3. Export with a TLS-verifying client, private local directory, and backup identity. Enter the password through a protected prompt, not command arguments or shell history.
4. Encrypt the export and store it off-host in restricted private storage. Record timestamp/checksum/schema version, not customer rows.
5. Restore to a new isolated database/service, never over production. Compare migration ledger/checksums and table counts; run db:verify with TLS and synthetic smoke/reconciliation.
6. Record backup point, restore start/end, actual recovery time/data gap, result, operator and approver. Repeat monthly if that cadence is approved and after provider changes.

A successful dump or CI restore alone does not pass this gate.

### Production migration and deployment
Written approval must record target, release SHA, reviewer, migration/checksum list, verified backup, expected locks/downtime, execution window, validation queries and recovery/forward-fix plan.

During the approved window: verify target identity without printing values; confirm backup; apply reviewed migrations with the separate migration identity; verify schema_migrations/checksums and resulting schema; promote the exact tested Vercel commit only after owner approval; verify Production env scope and public HTTPS origin; run HTTPS smoke and approved synthetic invoice/PDF/email checks; record evidence.

MySQL DDL is not generally transactional. If a migration partially fails, stop, inspect state, restore to a new target or apply an approved forward fix. Never reverse migrations blindly or overwrite production during diagnosis.

### Rollback and incidents
- App-only failure: route traffic to a known-good Vercel deployment, confirm alias, smoke-test, inspect cron settings.
- Schema/data failure: application rollback does not undo migrations. Isolate traffic if needed, restore into a separate target, reconcile, then use an approved forward repair/cutover.
- Credential exposure: revoke/rotate at source, update intended environment, verify old key fails, inspect logs, preserve evidence and document impact.
- Email/storage failure: diagnose outbox attempts, provider events, immutable attachment reference/checksum and bucket access. Retry via the authenticated worker; never duplicate financial documents or treat queued email as delivered.

### Monitoring and handover
Activate/test actual provider alerts:
- Vercel: deployment failures, repeated 5xx, function timeouts/latency, cron failures, spend/usage thresholds.
- DB: availability, CPU/memory, connections, disk, TLS failures, backup freshness and restore availability.
- Email: bounces/rejections, webhook signature failure, retries, aging pending outbox rows, worker failures and sender verification drift.
- Storage: bucket availability/denials, growth/cost and integrity errors.
- App: request IDs and redacted error categories; never log secrets, raw DB errors, sensitive invoice bodies or document contents.

Name primary/backup operators, alert recipients, cost ceiling and escalation path. Prove a non-customer staging alert arrives. A second operator must rehearse deployment/smoke, migration identity, restore into a new target, app rollback without schema rollback, credential incident response, and email/storage/database recovery. Record date, evidence, issues and follow-up owner. An untested runbook is prepared, not proven.

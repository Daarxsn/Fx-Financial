# Pack 9 — Readiness and acceptance ledger

**Snapshot:** 2026-10-22 · **Repository:** Daarxsn/Fx-Financial / main

This ledger separates source-code evidence from provider and operations proof. A successful build is not production acceptance.

## Part A — engineering evidence

| ID | Work | Status |
|---|---|---|
| 9.1 | CI includes Node 24/npm ci, dependency audit, history secret scan, disposable MySQL migrations/seed/query plans/restore, API/auth, calculations, PDF/storage, UI, Pack 7/8, lint, types, build, production headers and Playwright. Pack 9 adds integration checks. | Await exact-commit CI |
| 9.2 | Disposable-MySQL browser acceptance covers login, Settings readiness, customer/catalog, invoice issue, private PDF generation/download, payment, correction, reports and audit; server tests cover document/storage/email contracts. | Code coverage exists; latest commit CI pending |
| 9.3 | Next.js deployment configuration and smoke command are checked; no Vercel project is linked to this repo in the accessible team. | Project/preview pending |
| 9.4 | Placeholder-only environment example and preflight cover origin, TLS, session, private storage, mail/webhook/scheduler; synthetic preflight tests cover valid and unsafe configurations. | Implemented; real values unverified |
| 9.5 | Runtime/migrator/backup/read-only identities documented. | Provider grants/credential rotation pending |
| 9.6 | Runtime requires production TLS; db:verify checks SELECT 1 and active TLS cipher. | Intended Aiven target unverified |
| 9.7 | CI logical restore tested; provider restore procedure documented. | Managed restore and approved RPO/RTO pending |
| 9.8 | Migration inventory, backup point, locks, validation and recovery procedure documented. | Change approval pending |
| 9.9 | No production migration was executed during this source task. | Approval and verified backup pending |
| 9.10 | Deployment smoke and release procedure added. | Vercel project/domain/env/preview pending |
| 9.11 | Monitoring and alert drill requirements documented. | Actual alerts/delivery unverified |
| 9.12 | Deployment/rollback/database/email/storage/credential/restore runbooks written. | Second-operator drill pending |

## Part B — external release gates

### Blockers observed on 2026-10-22

1. Accessible Vercel context showed Hobby and no linked project for Daarxsn/Fx-Financial. The application schedule runs every five minutes. Official docs say Hobby cron is daily-only, while Pro/Enterprise support per-minute schedules: https://vercel.com/docs/cron-jobs/usage-and-pricing. The owner must approve a compatible plan or separately operated scheduler. Do not silently degrade mail/reminder cadence.
2. Actual Preview/Staging/Production values, Aiven network/CA/grants, private bucket policy, verified sender/webhook, scheduler, domain, backups and alerting require provider-console verification.
3. Provider restore into a separate service, measured RPO/RTO and a second-operator recovery drill remain outstanding.
4. Pack 8's dependency advisory exception still needs an explicit release-owner accept/reject before production promotion.
5. Business/finance/tax decisions and production migration/release approvals are separate from engineering acceptance.

## Gate decision

**Pack 9 is not a green release gate until each applicable external item has dated evidence against the exact release SHA.** This implementation adds repeatable source checks and operator procedures; it does not claim a production deploy, configured provider credentials, provider restore, or alert delivery.

To close Pack 9, attach exact SHA/green CI URL, Preview deployment and passing smoke, staging db:verify evidence, provider grant review, email/private-storage integration proof, managed-backup restore with measured RPO/RTO, alert delivery/second-operator drill, and migration/finance/tax/dependency-exception approval.

Only after the ledger is updated and signed by responsible owners should Pack 10 UAT begin.

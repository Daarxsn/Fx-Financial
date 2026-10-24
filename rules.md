# Engineering Rules — Fx Financial

These rules are mandatory for all implementation and agent work.

## Repository workflow

1. Work **directly on `main` only**. Never create branches, worktrees or PRs unless the owner explicitly changes this rule.
2. Fetch/inspect the latest `main` and the target file's current contents before editing. Never overwrite a newer revision with stale content.
3. Keep changes focused and coherent. Prefer a small vertical slice with implementation, tests and documentation together.
4. Inspect `git status` and the diff before committing; preserve unrelated changes and untracked files.
5. Do not force-push, rewrite shared history or use destructive reset/clean commands to make the tree convenient.
6. Commit with a specific message only after reviewing the changed files. Wait for and inspect CI for the exact commit before calling the slice complete.
7. Update the relevant phase tracker and evidence notes. Documentation must distinguish implemented, tested, externally verified, approved and released.

## Required validation

Run the smallest relevant test first, then applicable project gates. Common gates:

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm run api:validate
npm run pack7:validate
npm run pack8:validate
npm run pack9:validate
npm run pack9:test
npm run pack9:smoke-test
npm run pack10:validate
npm run pack10:gate-test
```

Run only commands relevant to the change where time/environment is constrained, but state exactly what ran and what did not. Use the project's existing package scripts; do not invent scripts without adding and testing them. Some integration checks require a disposable MySQL instance or configured non-production services.

## Security and privacy

- Never commit or print secrets, `.env.local`, tokens, session cookies, private keys, database dumps, real invoices or customer/financial exports.
- Use synthetic fixtures in tests; never point test/import/cleanup commands at production.
- Keep TLS certificate verification enabled. Never disable certificate checks to work around DNS/TLS failures.
- Validate every input on the server and use parameterized SQL.
- Enforce authentication, permission and legal-entity scope on every protected API, not only in the UI.
- Keep runtime DB grants least-privileged; keep migration credentials separate.
- Do not log sensitive customer/tax/bank/financial values or raw driver/provider diagnostics.
- Keep PDFs and attachments private; verify access before downloads.
- Verify signed webhooks, worker secrets and provider idempotency.

## Financial integrity

- Server calculations are authoritative. Never trust client totals.
- Use exact decimal/scaled-integer arithmetic; no JavaScript floating-point money math.
- Respect currency boundaries; never aggregate unlike currencies without an explicit conversion model.
- Use transactions and row locking/optimistic concurrency where needed to prevent duplicate numbering, race conditions and overpayments.
- Preserve immutable issued-document snapshots and append-only audit/event history.
- Use explicit, audited correction/cancellation/reversal flows. Never silently rewrite issued documents or payment history.
- Retryable operations must be idempotent; a timeout must not create duplicate financial effects.
- Never invent issuer details, tax rates, legal treatment, bank data, numbering rules, payment terms or approval evidence.

## Database and deployment safety

- Migrations are forward-only. Never modify an already-applied migration; add a new migration.
- Review migration impact and rollback/recovery plan before shared-environment changes.
- Never run destructive operations or production migrations without explicit approval and a verified backup/recovery procedure.
- Never treat CI's disposable MySQL restore as proof of provider-managed backup restoration.
- Do not deploy/promote production without Preview/Staging smoke evidence and the applicable Pack 9/10 gates.
- A green build is not equivalent to operational readiness or business approval.

## Product and UI

- Preserve Next.js App Router, React, TypeScript, MySQL/mysql2 and the existing service boundaries. No Vite.
- Keep UI changes responsive, accessible and consistent with existing brand tokens/assets.
- Provide loading, empty, error, disabled and success states for meaningful workflows.
- Do not claim success before the server confirms the action; distinguish saved, issued, queued, accepted and delivered states.
- Never silently select the first customer or brand when the workflow requires an explicit choice.
- Do not expose internal notes in customer-facing PDFs/emails by default.
- Do not mark work complete because a page, route, migration or mock exists.

## When blocked

Record the exact blocker, evidence needed, safe next action and responsible approver. Do not bypass a failed security/financial check, lower test standards silently, or replace unknown real-world values with guesses.

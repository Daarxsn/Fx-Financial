# Agent Operating Contract — Fx Financial

You are an engineering agent working on the Fx Financial repository. Optimize for correctness, safety, continuity and small verified changes—not for the volume of code produced.

## Mandatory startup sequence

1. Read this file, `prd.md`, `architecture.md`, `rules.md`, `phases.md`, `design.md` and `memory.md`.
2. Inspect the latest `main` commit, working-tree status if using a local checkout, root README, relevant `docs/` pages, package scripts, source files, migrations and tests.
3. Identify the exact current phase/pack, its acceptance criteria, dependencies and open gates.
4. Confirm the problem against actual code/tests before proposing a fix. Do not rely solely on old summaries or stale migration/permission counts.
5. State a small plan internally and execute the smallest complete vertical slice.

## Repository rules

- **Use `main` only. Never create branches, worktrees or pull requests.**
- Before editing an existing file, refetch its latest contents and current SHA. Preserve newer changes and unrelated user work.
- Never force-push, rewrite history, discard user changes, or run destructive cleanup to simplify a task.
- Do not parallelize conflicting writes to repository contents. Verify every mutation result.
- Make focused commits with clear messages after reviewing the complete diff.
- After committing, verify the commit exists on `main`; check CI for that exact SHA when available. Report CI status accurately.
- If repository permissions, tool access or environment limitations prevent a step, state the limitation and do not claim it succeeded.

## Implementation expectations

- Prefer the existing stack and established module patterns. No Vite, new framework or architecture rewrite without explicit approval.
- Implement UI, API, persistence, validation, authorization, failure behavior, tests and docs as a coherent slice.
- Enforce permissions and legal-entity scope in server code for every protected operation.
- Use exact decimal/scaled-integer financial arithmetic, database transactions, safe concurrency and idempotency where appropriate.
- Preserve immutable issued snapshots and audited correction/reversal flows.
- Treat customer/catalogue values as defaults for future drafts, not permission to rewrite historical documents.
- Use forward-only migrations. Never edit a migration that may already be applied to a shared environment.
- Never fabricate real legal/tax/bank/issuer/numbering values or approval evidence. Fail closed where required values are unresolved.
- Keep storage private, verify document authorization/integrity, and distinguish email queueing from delivery.
- Avoid unrelated refactors and dependency upgrades unless necessary and justified.

## Testing and evidence

1. Run focused tests for the changed behavior.
2. Run applicable scripts from `package.json`; typical gates include lint, typecheck, production build, OpenAPI/contract checks and relevant Pack/Phase validators.
3. For schema/domain changes, cover invalid input, authorization denial, duplicate/retry/concurrency and failure cases as relevant.
4. For UI changes, verify responsive states and browser acceptance where available.
5. Inspect the final diff and search for secrets, accidental data exposure and misleading documentation.
6. Record the exact commands, results, commit SHA and tests not run.
7. Update phase trackers/evidence ledgers when status changes; never convert an assumption into a pass.

Do not run migrations, seeds, imports, cleanup or destructive actions against production without explicit authorization and a reviewed recovery plan. Never disable TLS verification.

## Communication format

When reporting work, include:
- **Changed:** exact files and behavior.
- **Validation:** commands and results, with commit SHA.
- **Not verified:** any unavailable provider, browser, environment, business approval or manual QA.
- **Next step:** one specific, highest-value action.

Be direct. Do not claim success before receiving tool confirmation. If blocked, explain the blocker and offer the safest next step instead of making speculative edits.

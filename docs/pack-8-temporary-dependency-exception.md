# Pack 8 — Temporary dependency advisory exception

**Record date:** 23 October 2026  
**Advisory:** [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) / CVE-2026-93687  
**Severity:** High (availability / stack exhaustion)  
**Status:** Time-boxed engineering exception; review required before expiry  
**Review expiry:** **5 November 2026, 23:59:59 UTC**  
**Owner:** Falchion Invoice repository engineering/release owner

## Finding and scope

**23 October 2026 security follow-up:** the main-branch production dependency audit failed on a critical Next.js advisory while `next@16.4.0` was pinned. The manifest has now been upgraded to `next@16.4.2` and `eslint-config-next@16.4.2` based on the current audit's remediation suggestion. Upstream advisories identify 16.4.1 as patched for the October critical issues, while the CI audit recommended 16.4.2. The package lock and full CI still need to validate the new resolved graph; this edit alone does not clear the production gate. References: [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw), [current Next.js changelog](https://nextjs-changelog.vercel.app/).

The current lockfile resolves `braces@3.0.3` through this development-toolchain path:

`eslint-config-next@16.4.2 → @next/eslint-plugin-next@16.4.2 → fast-glob → micromatch → braces@3.0.3` (the exact resolved transitive versions and development-only markers are re-checked in CI after the lockfile refresh)..

The lockfile marks these nodes as development dependencies. The reviewed GitHub advisory lists versions through 3.0.3 as affected and does not list a patched release as of this record. The npm suggested forced remediation downgrades `eslint-config-next` to 14.2.35, which is an incompatible major downgrade for this Next.js 16.4.x application; it is not accepted.

This is a real high-severity dependency advisory, not marked “false positive.” The current evidence puts the affected package in developer/CI tooling, not the production dependency set. No claim is made that all indirect uses are universally unreachable; the exception is deliberately narrow and expires.

## Compensating controls

1. CI runs `npm audit --omit=dev --audit-level=high` and fails on any high/critical production-dependency advisory.
2. CI separately audits the full dependency tree. Its exception permits only this exact high-severity advisory chain with these reviewed versions and only while all chain nodes remain marked development-only in the lockfile.
3. Any new high/critical finding, chain/path/version change, production dependency exposure, loss of the exact advisory identifier, or expiry fails CI.
4. No blanket `npm audit` suppression and no broad `npm audit fix --force` downgrade is permitted by this record.
5. On or before 5 November 2026, re-check the upstream advisory and current npm metadata. Remove the exception immediately when a safe compatible patched release is available. If not, renew only after a fresh reachability assessment and explicit release-owner decision.

## Approval boundary

This file records an engineering exception to keep the checks precise while no compatible upstream patch is listed. **It is not a business, finance, legal, or production go-live approval.** Pack 9 must still verify the actual production dependency install and deployment scope; the designated release owner must explicitly accept or reject this residual development-tooling risk before a production go-live decision.

## Gate outcome

Runtime high/critical dependency audit: must pass without exceptions.  
Full tree high/critical audit: may pass only for this exact, unexpired development-tooling exception.  
Unknown or additional high/critical findings: fail closed.

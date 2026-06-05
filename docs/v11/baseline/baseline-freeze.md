# V11.0 — Baseline Freeze and Reproducibility

**Date:** 2026-06-05
**Baseline commit:** `db32b338a983c60f42ef8a33581b644c44b0a72b` (main)
**Baseline tag:** `v10-phase2-baseline`
**Purpose:** Freeze a known, reproducible starting point so all V11 hardening work
is measured against a fixed baseline, and so no V11 change is performed against an
uncertain production state.

---

## 1. What was recorded

| Requirement (spec §8 / V11.0) | Status | Evidence |
|---|---|---|
| Tag the V10 baseline commit | DONE | tag `v10-phase2-baseline` → `db32b33` |
| Record every migration filename + checksum | DONE | [migrations-manifest.md](migrations-manifest.md) |
| Compare local / preview / production migration sets | PARTIAL | local = EXACT; preview/prod = NOT VERIFIED (no creds) |
| Export schema-only snapshot | DONE | [schema-public.snapshot.sql](schema-public.snapshot.sql) (public schema, 4062 lines) |
| Record production project identifiers (no secrets) | BLOCKED | prod URL empty in tracked env files — see §5 |
| Sanitized review-bundle script | DONE | `scripts/audit-bundle.mjs`, `pnpm audit:bundle` |
| Run + archive full test suite before changing code | DONE | [test-report.txt](test-report.txt) — 254/254 pass |
| Temporary release freeze | DONE | see §4 and `docs/v11/README.md` |

## 2. Baseline test + typecheck results

- **Unit tests (vitest):** 37 files, **254 passed, 0 failed**. Full log archived in
  `test-report.txt`.
- **Typecheck (`tsc --noEmit`):** exit 0, clean.
- **e2e (Playwright):** NOT re-run in this environment (requires built app + running
  stack on the project's non-default port). Prior project records: 106 e2e green.
  Re-running e2e is a required gate before declaring any V11 phase shippable.

These results establish the green baseline. They do **not** discharge the V11
adversarial security/concurrency findings — those tests are added per phase.

## 3. Migration parity

See [migrations-manifest.md](migrations-manifest.md). Repository and the local
Supabase stack agree exactly on all 16 migrations. Production parity is unverified
and is a launch blocker until checked by the operator.

## 4. Release freeze (temporary)

Until **V11.1 (Emergency Public Security Boundary)** lands with all its adversarial
tests passing, no non-P0 feature work may be merged to `main`. The only permitted
changes are:

- V11.0 governance/baseline artefacts (this folder);
- V11.1 public-order-access security work and its tests;
- P0 hotfixes for the findings in spec Appendix A.

Rationale: the public order-access model (sequential refs used as access
credentials) is an active, exploitable defect. Adding features on top widens the
blast radius and delays the fix.

## 5. Production actions required (carried forward)

These could not be completed in the review/dev environment and are explicit
prerequisites before any V11 production deploy:

1. **Populate production identifiers safely.** `NEXT_PUBLIC_SUPABASE_URL` is empty
   in the tracked production env files. Record the production project ref in the
   deployment platform (Vercel/Supabase), never in the repo.
2. **Verify production migration parity** with
   `MIGRATION_DRIFT_CHECK_MODE=release node scripts/check-migrations.mjs` against the
   linked project, and archive the result.
3. **Rotate any credentials** that may have been included in unsanitised archives
   shared outside a trusted boundary (spec §11.1).
4. **Confirm no `*.test` / bootstrap accounts** exist in production (spec §11.1 —
   enforced as a gate in a later phase).

## 6. How to reproduce this freeze

```bash
git checkout db32b338a983c60f42ef8a33581b644c44b0a72b
node_modules/.bin/vitest run            # expect 254 passed
node_modules/.bin/tsc --noEmit          # expect exit 0
pnpm audit:bundle --dry-run             # expect "secret scan: CLEAN"
```

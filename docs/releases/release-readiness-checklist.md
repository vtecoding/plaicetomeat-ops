# Release Readiness Checklist

Last reviewed: 2026-06-08 (V13.4)
Purpose: the gate to clear before promoting PlaiceToMeat to production. Run top to
bottom; every item must be checked or have a recorded, accepted exception.

How to read the commands: run from the repo root. "strict/prod" means run with the
production environment loaded (and `PRODUCTION_READINESS_MODE=strict`).

## 1. Build & quality gate

- [ ] `npx tsc --noEmit` — PASS
- [ ] `npx eslint` — PASS (pre-existing warnings only)
- [ ] `npx vitest run` — all PASS
- [ ] `npx next build` — PASS

## 2. Migrations

- [ ] All repository migrations applied to the production DB.
      V13.3 drill found `pricing_validations` (V13.1) and other V13 tables absent.
      Apply with: `supabase db push --project-ref <ref>` or via Supabase management API.
- [ ] `node scripts/check-migrations.mjs` (release mode) — PASS, no drift.
- [ ] `verify-production-readiness.mjs` migration parity — PASS (strict/prod).

## 3. Health

- [ ] `GET /api/health` on production returns `state: HEALTHY`
      (or `DEGRADED` with a known, accepted cause and migration parity OK).
- [ ] `node scripts/verify-health.mjs` with `HEALTH_BASE_URL=<prod>` — PASS.

## 4. Auth & secrets

- [ ] `PRODUCTION_READINESS_MODE=strict node scripts/verify-production-readiness.mjs`
      — all required secrets present and valid; hygiene flags off.
- [ ] `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_ACCESS_SECRET` (>=32),
      `STAFF_SESSION_SECRET` (or valid fallback), public URL/anon,
      `CANONICAL_BRANCH_ID` set in Vercel.
- [ ] `node scripts/verify-audit-authenticity.mjs` — PASS (audit non-forgeable).
- [ ] `node scripts/verify-audit-coverage.mjs` — PASS (security events emit, PII-free).
- [ ] Staff login + unauthorised-route handling spot-checked.

## 5. Checkout

- [ ] `node scripts/verify-checkout-integrity.mjs` — PASS (price authority,
      dup-SKU merge, capacity lock, idempotency, anon RPC seal).
- [ ] `CHECKOUT_TEST_MODE_ENABLED` / `NEXT_PUBLIC_CHECKOUT_TEST_MODE` OFF in prod.
- [ ] A real (non-test) checkout placed and visible at the counter.

## 6. Inventory

- [ ] `node scripts/verify-inventory-integrity.mjs` — PASS (atomic, non-negative,
      stale stock-count CAS guard).
- [ ] `node scripts/verify-ops-capture.mjs` — PASS.

## 7. Audit

- [ ] Audit rows are written and non-forgeable (covered by §4 scripts).
- [ ] `security_event` emission observed for a failed login attempt.

## 8. Backups (V13.4 free-tier system)

> V13.3 drill (2026-06-08) found: Supabase Free Plan has no automated backups.
> V13.4 builds a free-tier backup system via GitHub Actions.
> See `docs/runbooks/free-tier-backups.md`.

- [ ] GitHub Actions secrets set: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `BACKUP_ENCRYPTION_KEY`, `CANONICAL_BRANCH_ID`
      (repo → Settings → Secrets and variables → Actions).
- [ ] `.github/workflows/production-backup.yml` enabled and at least one successful
      daily run confirmed (Actions tab → Production Backup → green tick).
- [ ] `BACKUP_ENCRYPTION_KEY` saved in team password manager (without it, no restore is possible).
- [ ] Latest backup verified: `BACKUP_ENVIRONMENT=PRODUCTION STRICT=1 BACKUP_ENCRYPTION_KEY=<key>
      node scripts/verify-latest-backup.mjs` — `BACKUP_CERTIFIED`.
- [ ] Production secrets recorded in the team password manager
      (`SUPABASE_SERVICE_ROLE_KEY`, `ORDER_ACCESS_SECRET`, `STAFF_SESSION_SECRET`,
      `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CANONICAL_BRANCH_ID`).
- [ ] Quarterly restore drill PASSED:
      `node scripts/restore-backup-local.mjs` → `node scripts/verify-disaster-recovery.mjs`
      — verdict `RECOVERY_CERTIFIED`, dated within this quarter.
      Report at `docs/reports/disaster-recovery-certification.md`
      (must begin `REAL PRODUCTION RECOVERY DRILL`, not `RECOVERY DRILL BLOCKED`).

## 9. Observability

- [ ] `ALERT_WEBHOOK_URL` configured if alerting is desired (optional).
- [ ] Operator knows `/api/health` and the structured-log categories/metrics
      surfaced in V12.8.

## 10. Sign-off

- [ ] All above checked or exceptions recorded with owner + reason.
- [ ] Release version / commit recorded.
- [ ] Go / No-Go decision logged by the deployment admin.

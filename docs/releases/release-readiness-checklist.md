# Release Readiness Checklist

Last reviewed: 2026-06-07 (V12.9)
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

- [ ] All repository migrations applied to the production DB
      (`supabase db push` completed for any new V12.x migrations).
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

## 8. Backups

> **BLOCKER (2026-06-08):** Supabase Free Plan has no automated backups.
> Current drill verdict: RECOVERY_BLOCKED. Must be resolved before launch.
> See `docs/reports/disaster-recovery-certification.md` for full findings.
> Options: (A) upgrade to Supabase Pro, or (B) implement pg_dump backup pipeline.

- [ ] **BLOCKER** Supabase automated backups enabled (Pro plan or pg_dump pipeline).
      Free Plan confirmed NOT sufficient — no backup = no recovery.
- [ ] Latest backup confirmed < 24h old (`backup.md`).
- [ ] PITR status known and recorded (Pro plan only).
- [ ] Production secrets recorded in the team password manager.
- [ ] All repository migrations applied to the production project
      (`supabase db push` — `pricing_validations` and other V13 tables confirmed absent
      from cloud project as of 2026-06-08).
- [ ] Restore drill performed this quarter into a throwaway project (`restore.md`).
- [ ] Latest restore drill PASSED: `RECOVERY_ENVIRONMENT=PRODUCTION STRICT=1
      node scripts/verify-disaster-recovery.mjs` — verdict `RECOVERY_CERTIFIED`,
      dated within this quarter. Report at `docs/reports/disaster-recovery-certification.md`
      (must begin `REAL PRODUCTION RECOVERY DRILL`, not `RECOVERY DRILL BLOCKED`).

## 9. Observability

- [ ] `ALERT_WEBHOOK_URL` configured if alerting is desired (optional).
- [ ] Operator knows `/api/health` and the structured-log categories/metrics
      surfaced in V12.8.

## 10. Sign-off

- [ ] All above checked or exceptions recorded with owner + reason.
- [ ] Release version / commit recorded.
- [ ] Go / No-Go decision logged by the deployment admin.

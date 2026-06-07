# Compliance Temperature Capture — Validation Report

Date: 2026-06-07
Type: post-V12.10 remediation (pre-PR hardening audit finding).
State: implemented and validated locally.

## 1. Why

The pre-PR hardening audit found that `/counter/compliance` — linked as "Food
safety" in the staff nav — rendered **hardcoded demo temperature readings** as
"Recorded today" with inert "Add reading"/"Mark completed" buttons. For a butcher,
fridge/freezer temperature logs are legal food-safety evidence; a screen that
fabricates them (and silently captures nothing) is a launch hazard. This change
makes the screen real and hardened.

## 2. What changed

New:
- `supabase/migrations/202606071800_compliance_temperature_capture.sql` — two
  SECURITY DEFINER RPCs (`record_compliance_reading`, `complete_compliance_log`)
  that derive the actor from `auth.uid()`, authorise the branch (`is_branch_staff`),
  validate inputs, and emit audit evidence in-transaction; drops the forgeable
  direct INSERT/UPDATE RLS policies and revokes client write privileges on
  `compliance_logs` / `compliance_readings` (mirrors V11.2), with a self-check.
- `src/lib/validation/compliance.ts` (+ test) — zod schemas + temp bounds.
- `src/lib/server/compliance.ts` — `getComplianceDayResult` (honest DataResult; no
  demo fallback).
- `src/app/actions/compliance.ts` — `recordComplianceReading` /
  `completeComplianceDay`, branch-scoped staff authority, structured logging.
- `src/components/compliance-client.tsx` — real capture form + today's readings.
- `scripts/verify-compliance-integrity.mjs` — 14 adversarial checks.

Modified:
- `src/app/counter/compliance/page.tsx` — server component loading real data with
  honest unavailable state; **all demo imports removed**.
- `src/lib/server/audit.ts` — added `compliance_reading_recorded` /
  `compliance_log_completed` to `AUDIT_EVENT_TYPES`.

## 3. Security model

- Writes flow ONLY through the SECURITY DEFINER RPCs (auth + branch authorisation +
  input validation + in-transaction audit). Direct client INSERT/UPDATE on the
  compliance tables is revoked and policy-dropped; SELECT (RLS) retained for reads.
- Temperature bounds are physical-sanity only (-50..50C): an out-of-safe-range
  reading is still recordable so a genuine breach can be logged honestly.
- Completion is validated server-side: requires both an opening and a closing
  reading and all three daily checks before the log is marked completed; idempotent.

## 4. Validation evidence (local)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npx eslint` | PASS, 4 pre-existing warnings |
| `npx vitest run` | PASS, 371 tests / 51 files (+7 compliance validation) |
| `npx next build` | PASS, `/counter/compliance` dynamic |
| `node scripts/verify-compliance-integrity.mjs` | PASS, 14/14 adversarial checks |
| all prior verify scripts (public-access, audit-authenticity, audit-coverage, ops-capture, checkout-integrity, inventory-integrity, checklist-integrity, operational-truth, health, production-readiness) | PASS |
| `node scripts/audit-bundle.mjs --dry-run` | PASS, secret scan CLEAN |

The new audit event types did not regress `verify-audit-authenticity` /
`verify-audit-coverage`.

## 5. Migration / certification note

This adds a 24th migration (`202606071800`). It was applied to the local dev DB and
registered in `schema_migrations`. The V12 launch-certification and final-rollup are
unchanged in substance; the migration count is reconciled from 23 to 24 and this
remediation is recorded as closing the fabricated-compliance-evidence hazard found
in the pre-PR audit. The production prerequisite is unchanged: `supabase db push`
applies this migration before go-live.

## 6. Remaining notes

- The compliance day key uses the DB `current_date`; in a non-UTC deployment confirm
  the server timezone matches the shop's business day (consistent with existing
  ops-capture behaviour).
- `demoComplianceLog` / `demoComplianceReadings` remain in `src/lib/data/demo.ts` as
  dev fixtures but are no longer imported by any production surface.

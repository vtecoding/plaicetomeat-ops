# V13 — Reality Proof & Commercial Validation — Discovery Report

_Date: 2026-06-07. Branch: `v13-reality-proof`. Status at start: V12 finalised & certified
(GO-conditional) on `v12.4-audit-coverage`; post-cert compliance-capture remediation landed
(`c895596`)._

## Mission

V1–V12 **built** the system. V13 **validates the assumptions** behind it. No new customer
features, no redesigns, no AI, no dashboards — only reality validation that turns launch
blockers from assumptions into evidence.

## The honest nature of V13 (what code can and cannot do)

Unlike prior versions, most of V13's value is produced **outside the codebase** by real people
performing real acts: a butcher signing off yields, an actual backup/restore drill, Dad
operating a tablet unaided, a rehearsed trading day. Software cannot perform those acts, and —
per this project's "no fabricated evidence" ethos (see the compliance-capture remediation
`202606071800`) — it must not pretend to.

What V13 **builds** is therefore the *tooling + hardened, tamper-evident evidence capture +
report generators* that make each validation real and recordable. The operator (and a butcher,
and Dad) then supply the real-world inputs, and the system produces the certification artifacts.

| Phase | Build (in-repo) | Real-world act (operator / butcher / Dad) |
|---|---|---|
| 13.1 Butcher economics | `/admin/validation/pricing` (manager-only) + capture table + hardened RPC + `docs/reports/butcher-signoff-report.md` generator | A real butcher reviews yields/trim/wastage/margins and signs APPROVED / CHANGES REQUIRED |
| 13.2 Disaster recovery | `pnpm verify:disaster-recovery` (backup → restore to clean DB → row-count parity) + cert generator | Run it against a production backup |
| 13.3 Day-in-life | Simulation driving the real RPCs through a full trading day + report scaffold | Walk the day, capture friction notes |
| 13.4 Dad mode | Task protocol + capture schema for timings/errors/help-asks | Hand Dad the tablet, zero assistance |
| 13.5 Launch gate | `launch-readiness-v13.md` evidence aggregator + pass/fail | Final review |

## Existing foundations V13 reuses (no re-build)

- **Pricing/yield engine** — `src/lib/butchery/carcass-breakdown.ts` + `cut-sheets.ts` already
  model species → cuts → yield% → blended saleable cost → margin → suggested price. V13.1 layers
  a *validation capture* over this engine; it does not re-implement pricing.
- **Hardened-capture pattern** — compliance (`202606071800`) and checklist evidence
  (`202606071700`) establish the template: writes flow only through `SECURITY DEFINER` RPCs that
  derive the actor from `auth.uid()`, authorise via `is_branch_manager` / `is_branch_staff`,
  validate inputs, emit an in-transaction `audit_logs` row, and the forgeable direct-write RLS
  policies are dropped + client write grants revoked, with a self-enforcing invariant `DO` block.
- **Authority path** — `requireStaffContext("manager", { branchScoped: true })` (pages) /
  `resolveStaffContext` (server actions) is the single manager gate. Route `/admin/**` is already
  manager-gated by `route-access.ts`; `/admin/releases` + `/admin/audit` are owner-only.
- **Verify-script idiom** — `scripts/verify-*.mjs` run adversarial checks against the LOCAL
  Supabase stack (anon/cross-branch/forged-write denied, happy path allowed, audit row emitted),
  exiting non-zero on any unmet expectation.
- **Test users** (`scripts/seed-dev.mjs`): `owner@`, `manager@` (BRANCH_A), `staff@` (BRANCH_A),
  `staff.b@` (BRANCH_B) — all password `PlaiceTest123!`. Branch A = `…0001`, Branch B = `…0002`.

## V13.1 design (this phase)

**Goal:** capture a real butcher's verdict on the system's pricing assumptions, cut by cut, as
hardened evidence, and emit `docs/reports/butcher-signoff-report.md`.

1. **Migration `202606081000_v13_1_pricing_validation.sql`** — `pricing_validations` table
   (one row per branch × species × cut), RLS select-only for managers, `SECURITY DEFINER`
   `record_pricing_validation(...)` RPC (manager-gated, computes price variance server-side,
   upserts, emits `pricing_validation_recorded` audit), direct-write hole closed + invariant block.
2. **Domain `src/lib/butchery/pricing-validation.ts`** (pure, tested) — builds the *system
   recommendation* rows for a species from the carcass breakdown, classifies variance, and
   summarises captured decisions into an overall verdict (APPROVED / CHANGES REQUIRED / INCOMPLETE).
3. **Loader `src/lib/server/pricing-validation.ts`** — reads saved validations as a `DataResult`.
4. **Server action `src/app/actions/pricing-validation.ts`** — manager-gated `recordPricingValidation`.
5. **Page `/admin/validation/pricing` + client** — system vs butcher side-by-side, live variance,
   per-cut decision capture, overall sign-off banner.
6. **Verify `scripts/verify-pricing-validation-integrity.mjs`** — adversarial integrity checks.
7. **Report `scripts/butcher-signoff-report.mjs`** → `docs/reports/butcher-signoff-report.md`.

**Pass criteria for V13.1:** a butcher can record APPROVED / CHANGES REQUIRED per cut with notes;
evidence is tamper-evident (no forgeable writes, audit-logged); the report renders the verdict.
A FAIL verdict (butcher rejects assumptions) is an explicit, honest output — not something the
software can paper over.

## Failure conditions (programme-level, from spec)

Immediate FAIL if: backup/restore fails · butcher rejects pricing assumptions · Dad cannot operate
critical workflows · day simulation uncovers an order-loss path · compliance evidence can be bypassed.

## Out of scope (V13 may NOT)

Redesign architecture · add SaaS/customer-facing features · add speculative intelligence ·
online payments · loyalty · multi-shop · mobile apps · AI forecasting · new analytics/dashboards.

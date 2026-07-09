# PTM Invariants — what must never break (and what guards it)

Read this before touching stock, orders, money, auth, or compliance code.
Full architecture: `docs/architecture/ptm-production-architecture.md`.

## Truth tables are read + RPC-only for app roles
`orders`, `order_items`, `inventory_batches` (phase0 `202606290900`), `products`,
`inventory_waste_events`, `order_status_events` (phase3 `202607101200`),
`inventory_movements` (V14.1-H), `audit_logs` (V11.2), `compliance_logs/readings`.
Never add an RLS write policy or client-role grant to these. Add a SECURITY DEFINER
RPC that validates + audits instead. Guard: `verify:truth-table-lock` (db tier).

## Every new table MUST enable RLS in the same migration
`202607011300` auto-grants SELECT to anon/authenticated on future tables via
DEFAULT PRIVILEGES. A table without RLS is publicly readable. Guard:
`verify:rls-coverage` (static tier, runs on every PR).

## Order lifecycle
Status only via `transition_order_status` (DEFINER — flipped in phase0; keep it so).
Depletion happens on collected; FEFO; shortfall -> owner alert, never hidden.
Operator serve retries must go through `repairMissingItems` (serve.ts) — a
header-only order is repaired or escalated, never collected. Money is never
silently changed on retry (`serveRepairDecision`, unit-tested).

## Owner visibility derives from state, not events
Reconcile tray self-heals cost-pending alerts from batch state
(`healMissingCostAlerts`). If you add a new "operator did X, owner must follow up"
flow, make the follow-up discoverable from the DATA, not just from one alert insert.

## Operator surface rules
Four tiles; plain language (`verify:operator-language`); no analytics vocabulary
(`verify:operator-firewall`); no route into /admin (middleware + live
`verify:operator-route-lock`). Failure surfaces are pinned by
`src/app/failure-surfaces.test.ts` — error pages must never show
error.message/stack and must always give a next step.

## Owner surface rules
DO_NOW_MAX = 3, never raised. No %/score/confidence/priority on strict surfaces.
Guards: `verify:owner-brain-compliance`, `verify:intelligence-firewall`,
`verify:action-compression` (live). Briefing ≤ 100 words.

## Compliance evidence
Required numeric steps (fridge temps, float) block `ops_complete_session` unless
their latest state is `done` with an in-range value (phase1 `202606291000`).
Both `verify:required-compliance` (ops-checklist path) and
`verify:compliance-integrity` (compliance_logs path, 14 checks) run in the db tier.
The daily log keys off the DATABASE's UTC date — scripts must use UTC dates, not
runner-local dates (a local-date bug made compliance-integrity flake pre-2026-07-10).

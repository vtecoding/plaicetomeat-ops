# PTM Production Architecture

Status: living document, tied to the code on `main` as of 2026-07-10.
Every claim below is either enforced by code/migrations/gates named here, or is
explicitly marked **GAP**. If you change a named enforcement point, change this file.

## 1. Summary

PTM is a butcher-shop operations system with three faces over one database:

- a public storefront (browse, basket, checkout, order status),
- a counter/admin surface for the owner (TODAY OS, inventory, purchasing, compliance,
  reconcile, audit),
- Operator Mode (`/operator`): four big tiles (Open Shop, Serve Customer,
  Stock/Delivery, Waste) plus Help/Call-owner, built for a rushed, low-computer-literacy
  operator.

The design centre: **maximum technicality, minimum operator skill**. The operator sees
simple, forgiving flows; the database underneath is strict, append-only where it
matters, and closed to any write path that skips validation or audit.

## 2. Goals

- Stock, money, and audit state can only change through controlled, audited paths.
- Every material change is explainable after the fact (who, what, when, why, how much).
- Failures are visible — to the operator as plain next steps, to the owner as alerts,
  to developers as audit/security events.
- The owner can run mornings/evenings from one compressed surface (TODAY) without
  reading raw tables.

## 3. Non-goals

- Multi-tenant SaaS generality. One business, branch-scoped.
- Real-time analytics dashboards. Intelligence flows through the action pipeline
  (Owner Brain), never as raw metric panels (enforced: `verify:owner-brain-compliance`,
  `verify:intelligence-firewall`).
- Offline-first operation. The shop needs connectivity; failures degrade honestly
  (truth states) rather than pretending.

## 4. Core invariants (and where each is enforced)

| Invariant | Enforcement |
|---|---|
| Stock changes only via ledger RPCs | phase0 migration `202606290900` (inventory_batches/orders/order_items read+RPC-only) + `202607101200` (products, waste events, status events); guard `verify:truth-table-lock` (12 adversarial checks, db tier) |
| inventory_movements is append-only | V14.1-H trigger + revoked grants; movement rows signed/balanced |
| Sale depletion is FEFO, exactly-once, never negative | `deplete_order_inventory` (unique keys, CHECK + floor, shortfall flagged) |
| Reversals are exactly-once, compensating | `admin_reverse_order_inventory` (one group per order+reason) |
| Order status moves only through the state machine | `transition_order_status` (SECURITY DEFINER, valid-transition graph); direct PATCH revoked |
| Audit rows cannot be forged | V11.2: insert policies dropped, only fail-closed `emit_audit_log` writes; grants re-revoked in `202607011300` |
| Required temperature evidence cannot be skipped | `ops_complete_session` (phase1 `202606291000`: latest state of required numeric steps must be `done`); guards `verify:required-compliance`, `verify:compliance-integrity` |
| Compliance evidence cannot be fabricated | compliance tables write-locked; `record_compliance_reading`/`complete_compliance_log` DEFINER RPCs; guard `verify:compliance-integrity` (14 checks) |
| Every table has RLS | all 48 tables enabled; guard `verify:rls-coverage` (static, fails CI on a new table without RLS) |
| Operator cannot reach admin | middleware (`src/middleware.ts`): getUser → signed session envelope → profiles.role/operator_mode → `canAccessStaffPath`; guard `verify:operator-route-lock` (live) |
| Money totals derive from lines, cancelled orders never count as sales | serve/checkout compute server-side; all aggregations filter `status !== "cancelled" && !is_test` (dashboard, operations-intelligence, owner-away, shop-intelligence) |
| A retry can never collect a header-only order | `repairMissingItems` in `src/app/actions/operator/serve.ts` + `serveRepairDecision` (unit-tested): items verified before collection; different-money retries escalate to owner |
| Cost gaps are owner-visible from state, not events | `healMissingCostAlerts` in `src/lib/server/reconciliation.ts`: cost-0 operator batches recreate their missing alert at tray read |
| UI success only after persisted success | operator actions return only after RPC/insert confirmation; `readCompletedRun`/idempotency keys make retries safe |

## 5. Domain model (summary)

- **Catalog**: `products` (kg/each/box, price_per_unit, cost), `product_categories`,
  `suppliers`. Product mutations via `admin_*` DEFINER RPCs that emit
  `price_changed`/`cost_changed`/`product_changed` audit events.
- **Orders**: `orders` (+ `order_items`, `order_status_events`, `order_notes`).
  State machine: incoming → prepping → ready → collected; cancellable pre-collection.
  Money: `numeric(10,2)`, subtotal persisted at creation, computed from lines.
- **Inventory truth**: `inventory_batches` (received/remaining kg, expiry, cost) +
  `inventory_movements` (signed append-only ledger of record) +
  `order_inventory_depletions`, `inventory_reversal_groups`,
  `inventory_reconciliation_monitor`. Remaining weight is a verifiable cache of the
  ledger.
- **Compliance evidence**: `compliance_logs`/`compliance_readings` (temperatures),
  `ops_checklist_sessions`/`ops_checklist_events` (open/close, append-only events),
  `inventory_waste_events`, `operator_evidence` (photos), certificates.
- **Operator adapter**: `operator_workflow_runs` (runId idempotency + resume),
  `owner_alerts` (escalations, CAS-resolved).
- **Audit**: `audit_logs` (allowlisted event types, fail-closed emitter),
  security events for denied access.

## 6. Role model

- `owner` / `manager` — full staff surfaces; branch-scoped by `is_branch_manager`.
- `staff` — counter surfaces; `is_branch_staff`.
- `profiles.operator_mode = true` — locks the account to `/operator` only (middleware
  redirects staff paths to `/operator`; DB role stays staff/manager because operator
  actions run through the same audited RPCs).
- Anonymous — storefront reads (RLS: active products, own order via signed public
  access id) and hardened checkout.

Client-side checks are UX only. Enforcement order: DB constraints/RPCs → RLS →
server actions (`resolveStaffContext`) → middleware → UI.

## 7. Route/module map

- `/` `/shop` `/product/[slug]` `/basket` `/checkout` `/order/*` — public.
- `/login` `/auth/update-password` `/unauthorised` — auth edges.
- `/operator/*` — four tiles + help/certificate; own `error.tsx`.
- `/counter/*` — staff order handling + compliance capture; own `error.tsx`.
- `/admin/*` — owner: `today` (TODAY OS + morning briefing + Do Now ≤ 3),
  `reconcile`, `inventory`, `purchasing`, `stock-count`, `compliance`, `evidence`,
  `away`, `audit`, settings-class pages; own `error.tsx`.
- Server actions in `src/app/actions/**` (operator adapter in `actions/operator/*`);
  domain logic in `src/lib/domain` (pure) and `src/lib/server` (server-only).
- `src/app/api/checkout` (hardened public POST), `src/app/api/health`.

## 8. Data ownership rules

- Truth tables (orders, order_items, inventory_batches, inventory_movements,
  products, inventory_waste_events, order_status_events, compliance_*, audit_logs)
  are **read + RPC-only** for app roles. Service role is server-only
  (`src/lib/supabase/server.ts`, `server-only` import; `audit-imports.test.ts`
  proves it can't reach the client bundle).
- Config tables (suppliers, pickup_windows, product_categories, shop_closures,
  sms_templates, branch_settings, branches, release_*) remain direct-writable by
  managers/owners through RLS. **Accepted trade-off** — they are not stock/money/audit
  truth; audit coverage there is partial (see §20).

## 9. Inventory truth model

Receipt (`admin_create_inventory_batch` / carcass intake, idempotency-keyed) creates
batch + `BATCH_RECEIVE` movement. Sale collection depletes FEFO with row locks;
shortfall completes with `completed_with_shortfall` + owner alert (oversell is never
hidden). Waste (`admin_record_inventory_waste`) writes event + movement. Stock count
corrections go through `ops_apply_stock_count_line` with a stale-count guard (refuses
if stock moved since counting). Reversals append compensating rows. The
`inventory_reconciliation_monitor` cross-checks cache vs ledger.

Operator deliveries land at cost 0, stamped cost-pending; the reconcile tray
self-heals missing alerts from batch state (§4).

## 10. Order/payment model

Storefront + API share one hardened checkout service (body cap, zod schema, duplicate
SKU merge, rate limit, idempotency key + fingerprint, server-only test gate, RPC).
Operator serve creates the order via service role with runId idempotency, then walks
the state machine to collected under the operator's own JWT (audit attribution).
Payment method cash/card is explicit on counter sales. Counter sales have no phantom
customer identity (phase2 migration dropped the fiction).

## 11. Audit model

`audit_logs`: system-generated only; allowlisted event types (mirrored in
`src/lib/server/audit.ts` as a TS union so a typo is a compile error); actor, branch,
target, metadata, reason. Denied access and session anomalies land in security events
via middleware fire-and-forget (never slows a denial). Guard: `verify:audit-authenticity`
(CI database-security workflow).

## 12. Owner alert model

`owner_alerts(branch, severity warning|critical, kind, summary, entity_ref unique-ish,
created_by, resolved_at)`. Created by operator escalations (dedup on open entity_ref),
depletion shortfalls, away-mode fridge escalation (critical), reconcile self-heal.
Resolution is CAS on `resolved_at` (never deleted) and audited. Warning-class alerts
feed the reconcile tray; critical alerts surface on TODAY.

## 13. Operator UX model

Four tiles only; every flow is linear with big buttons, resume via
`operator_workflow_runs`, double-submit protection (busy state client-side, runId
idempotency server-side). Every failure message says what to do next in plain words;
"I can't do this — tell owner" exists at each decision point and creates a real
alert. No admin leakage (route lock + `verify:operator-firewall` vocabulary guard +
`verify:operator-language`). Failure surfaces: `operator/error.tsx`, root
`error.tsx`, `not-found.tsx`, `global-error.tsx` — all pinned by
`failure-surfaces.test.ts` (exist, plain copy, no error.message/stack).

## 14. Security/RLS strategy

All 48 tables RLS-enabled (static-guarded). Explicit grants: anon/authenticated get
SELECT (policy-gated) + INSERT on order_notes only; legacy TRUNCATE/REFERENCES/TRIGGER
swept (`202607101200`). Default privileges auto-grant SELECT on future tables — the
`verify:rls-coverage` gate exists precisely because of that fail-open default.
Session: Supabase JWT re-validated server-side + signed staff-session envelope
(idle + absolute windows, user-bound, tamper → /unauthorised + security event).
Missing secrets fail closed (middleware denies staff paths). Service keys never in
client bundles (build-error guard).

## 15. Reliability strategy

Idempotency: checkout (key + fingerprint), operator runs (runId), batch intake
(intake key), depletion (unique keys), alert dedup (open entity_ref). Retries are
bounded (single-shot actions; the serve retry path repairs or escalates, never loops).
Partial-failure handling: serve repairs missing items before collection; reconcile
claims alerts CAS-first and rolls the claim back if the follow-on write fails; the
tray self-heals from state.

## 16. Observability strategy

Owner: TODAY (Do Now ≤ 3 + briefing ≤ 100 words), reconcile tray, away-mode summary,
alerts. Operator: explicit saved/failed/pending messages. Developer: audit_logs,
security events, `verify:*` guards, `/api/health`. Data loaders return typed truth
states (HEALTHY / NO_DATA / DEGRADED / UNAVAILABLE / CONFIGURATION_REQUIRED) so a
failure can never render as a fake empty state (guard: `verify:operational-truth`,
static tier).

**GAP (known, blocked)**: no external telemetry sink — production runtime errors are
only visible in Vercel logs. V16 Stream C (observability) is blocked on the
telemetry-sink decision (owner input).

## 17. Failure model

Assume: network drops mid-submit, double taps, two tabs, stale pages, auth expiry,
missing env, partial writes. Answers: idempotency everywhere critical, CAS on
mutation of shared state, stale-count guard, fail-closed env checks, honest truth
states, friendly failure surfaces, owner alerts for anything the operator couldn't
finish.

## 18. Validation strategy

Tiered constitution runner `scripts/architecture-check.mjs`:

- **static** (CI quality.yml): owner-brain-compliance, intelligence-firewall,
  operator-firewall, surface-convergence, operator-language, rls-coverage,
  operational-truth — 7 guards.
- **db** (CI database-security.yml on ephemeral Supabase): truth-table-lock (12
  adversarial), required-compliance, compliance-integrity (14 adversarial),
  pricing-validation-integrity, disaster-recovery ×2 — 6 guards.
- **live** (CI application-e2e.yml / local): operator-route-lock, operator-journeys,
  action-compression, today-os, one-tap-actions, morning-briefing, customer-winback.

Plus: vitest unit suite (~620 tests), Playwright e2e sets, `verify:seeded-logins`,
migration drift check, release-report roll-up.

## 19. Release gates

A change is releasable when: typecheck + lint + unit + build green; static tier 7/7;
db tier 6/6 on a fresh migrated DB; live tier green against a seeded running app;
migration list clean against the target environment. Production DB pushes follow the
runbook in `docs/agent-memory/` (repair-before-push history exists — see memory).

## 20. Known trade-offs

- Config tables stay direct-writable by managers (speed over uniform audit).
- Operator serve is weight-only; each/box products deliberately escalate to owner.
- Operator deliveries capture no cost at the door (speed for the operator; cost gap
  is state-derived owner work).
- `admin_set_delivery_cost` can rewrite any batch cost (audited via `cost_changed`).
- Counter sales carry no customer identity by design.

## 21. Open risks

- **Multi-step order creation is not one transaction** (order → items → events →
  collect). Mitigated by repair-on-retry + idempotency, not eliminated. A single
  `create_counter_sale` DEFINER RPC would be the stronger end-state.
- No DB-level constraint that `orders.subtotal = Σ order_items.line_total`
  (writers compute it; nothing re-checks continuously).
- No external telemetry sink (see §16).
- `production-backup.yml` needs repo secrets (BACKUP_ENCRYPTION_KEY,
  SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, CANONICAL_BRANCH_ID) — until
  set, scheduled backups don't run from CI.
- Public storefront pages still carry pre-redesign styling (cosmetic only).

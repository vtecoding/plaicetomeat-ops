# PTM Production Architecture

Status: living document, tied to the V18 Phase-A implementation as of 2026-07-14.
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
| Every application table has RLS | guard `verify:rls-coverage` fails CI on a new table without RLS |
| Operator cannot reach admin | middleware (`src/middleware.ts`): getUser → signed session envelope → profiles.role/operator_mode → `canAccessStaffPath`; guard `verify:operator-route-lock` (live) |
| Realised money derives from append-only tender/refund facts | `payment_events` is the realised-sales source; collection/refund RPCs stamp branch-local `business_date`; amended line truth comes only from `get_effective_order_lines_v18` at the frozen sequence |
| Operator Serve cannot expose a partial sale | `create_operator_serve_order_v18` prices lines, creates the order graph, advances status, tenders, depletes, creates required owner work and completes the run in one PostgreSQL transaction |
| Untracked products can never leak into kg stock truth | `products.inventory_policy` unit/policy CHECK + batch-write trigger; canonical readers, expiry/depletion and purchasing filters; guard `verify:untracked-isolation` |
| Cost gaps are owner-visible and recoverable | operator delivery commits its zero-cost batch and required cost job together; tray reconciliation also heals historical missing jobs from batch state |
| UI success only follows a complete durable receipt | operator business RPCs fence by run id + canonical request fingerprint, reject conflicting replays, and return immutable completion receipts; completed/abandoned runs are database-terminal |

## 5. Domain model (summary)

- **Catalog**: `products` (kg/each/box, `inventory_policy`, price_per_unit, cost), `product_categories`,
  `suppliers`. Product mutations via `admin_*` DEFINER RPCs that emit
  `price_changed`/`cost_changed`/`product_changed` audit events.
- **Orders**: immutable `order_items` snapshots plus append-only `order_amendments`;
  `get_effective_order_lines_v18` is the authoritative ordered fold used by manager,
  customer, tender and depletion reads. `order_status_events` and `order_notes` retain
  lifecycle/history detail.
  State machine: incoming → prepping → ready → collected; cancellable pre-collection.
  Money: append-only `payment_events`; collection derives the final folded subtotal.
- **Refunds**: append-only `refund_operations` + `refund_line_outcomes`, compensating
  `payment_events`, exact allocation-linked inventory reversals and attributed waste.
- **Inventory truth**: `inventory_batches` (received/remaining kg, expiry, cost) +
  `inventory_movements` (signed append-only ledger of record) +
  `order_inventory_depletions`, `inventory_reversal_groups`,
  `inventory_reconciliation_monitor`. Remaining weight is a verifiable cache of the
  ledger.
- **Compliance evidence**: `compliance_logs`/`compliance_readings` (temperatures),
  `ops_checklist_sessions`/`ops_checklist_events` (open/close, append-only events),
  `inventory_waste_events`, `operator_evidence` (photos), certificates.
- **Operator adapter**: `operator_workflow_runs` (draft/resume state plus terminal run-id,
  request-fingerprint and receipt fencing), `operator_evidence`, and `owner_alerts`
  (registry-driven jobs with claim, lifecycle and dispatch state).
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

`products.inventory_policy` separates sale truth from stock truth. `kg_batch`
products participate in batch quantity, value, expiry, cover and depletion;
`untracked_manual` products remain fully sellable and included in money/performance
reporting but never enter those stock calculations. Each/box products are constrained
to `untracked_manual`; a deliberately manual kg product is also allowed. Public
availability for an untracked product remains the owner's manual `is_available` and
`stock_status`. Stock surfaces use the exact label **Stock not counted**.

Operator deliveries land at cost 0, stamped cost-pending; the reconcile tray
self-heals missing alerts from batch state (§4).

## 10. Order/payment model

Storefront + API share one hardened checkout service (body cap, zod schema, duplicate
SKU merge, rate limit, idempotency key + fingerprint, server-only test gate, RPC).
Operator serve calls one authenticated `create_operator_serve_order_v18` transaction.
The database resolves catalogue truth, creates header/items/status events, walks the
existing state machine, records tender and depletion, creates any mandatory owner job,
and only then stores the completed run receipt.
Payment method cash/card is explicit on counter sales. Counter sales have no phantom
customer identity (phase2 migration dropped the fiction). Catalogue kg lines are
priced by weight; each/box lines require an integer count from 1 to 99 and are priced
count × current catalogue price. The browser shows approximate preset prices and a
review total, but the server resolves current prices again. The saved subtotal is
returned to the done screen; a changed total is explicitly labelled **Price updated**.

Ready orders may be adjusted at handover without mutating their item snapshots.
Substitution, weight adjustment and removal events are folded in sequence. Collection
freezes one amendment sequence and uses that same projection for the tender amount and
kg depletion. An advisory transaction lock makes a genuinely overlapping adjustment
and collection fail one side cleanly; the order row remains the serialisation point.

Collected-order refunds are manager-only compensating transactions. The RPC derives
the method from the original sale, caps each method and line by remaining paid/depleted
truth, and commits money, stock disposition and audit together. `customer_kept` moves no
stock; `returned_restockable` reverses the exact original batch allocations;
`returned_discarded` performs that reversal and then records attributed waste, leaving
net stock unchanged. The client cannot choose a refund method.
The configured threshold owner job commits in that same RPC and is unique by refund
operation, so neither a crash boundary nor an idempotent replay can lose or duplicate it.

## 11. Audit model

`audit_logs`: system-generated only; allowlisted event types (mirrored in
`src/lib/server/audit.ts` as a TS union so a typo is a compile error); actor, branch,
target, metadata, reason. Denied access and session anomalies land in security events
via middleware fire-and-forget (never slows a denial). Guard: `verify:audit-authenticity`
(CI database-security workflow).

## 12. Owner alert model

`owner_alerts` is the single owner-job registry: kind-specific action, seen/claimed/
resolved lifecycle, note or truth-backed resolution, and append-only transition audit.
Critical inserts atomically create an `alert_dispatches` outbox obligation; the bounded
worker claims with a lease, sends or records an honest skipped/failed state, and stamps
delivery only after confirmed send. Daily and Owner-Away digests use stable business-day
keys. `/admin/reconcile` renders the registry; Today/Away link to it instead of owning a
second job model.

## 13. Operator UX model

Four tiles only; every flow is linear with big buttons. Serve, delivery and waste
persist the last completed mode transition in `operator_workflow_runs`: draft writes
are debounced, serial and awaited, and the UI distinguishes saving, saved and failed
recovery state. The newest same-day run is resumable; starting fresh first abandons
the old run. A status-fenced write prevents a late draft from reopening a completed
run. Draft health never gates the business commit, which retains double-submit
protection (busy state client-side, runId idempotency server-side). Every failure message says what to do next in plain words;
"I can't do this — tell owner" exists at each decision point and creates a real
alert. No admin leakage (route lock + `verify:operator-firewall` vocabulary guard +
`verify:operator-language`). Failure surfaces: `operator/error.tsx`, root
`error.tsx`, `not-found.tsx`, `global-error.tsx` — all pinned by
`failure-surfaces.test.ts` (exist, plain copy, no error.message/stack).

## 14. Security/RLS strategy

All application tables are RLS-enabled (static-guarded). Explicit grants: anon/authenticated get
SELECT (policy-gated) + INSERT on order_notes only; legacy TRUNCATE/REFERENCES/TRIGGER
swept (`202607101200`). Default privileges auto-grant SELECT on future tables — the
`verify:rls-coverage` gate exists precisely because of that fail-open default.
Session: Supabase JWT re-validated server-side + signed staff-session envelope
(idle + absolute windows, user-bound, tamper → /unauthorised + security event).
Missing secrets fail closed (middleware denies staff paths). Service keys never in
client bundles (build-error guard).

## 15. Reliability strategy

Idempotency: checkout (key + fingerprint), operator completion (run id + canonical
fingerprint + receipt), batch intake (stable run key), depletion (unique keys),
amendments and refunds (operation id + canonical request fingerprint), owner jobs and
dispatch (stable entity/provider keys). Conflicting payload reuse is refused. Serve,
delivery, waste, refund, amendment, delivery-cost resolution and Owner-Away activation
compose their coupled database facts inside transactions. Evidence upload is the one
external storage boundary; deterministic operation paths make concurrent certificate
submits converge before the database completion transaction.

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
- **db** (CI database-security.yml on ephemeral Supabase): the constitutional DB
  tier plus V18 payment, inventory-policy, refund, amendment, atomic-serve,
  run-completion, alert-dispatch and owner-job fault/concurrency batteries.
- **live** (CI application-e2e.yml / local): operator-route-lock, operator-journeys,
  action-compression, today-os, one-tap-actions, morning-briefing, customer-winback.

Plus: the unit suite, V18 two-connection/fault-injection database batteries, dedicated
V18 Playwright journeys, `verify:seeded-logins`, migration drift check and release-report
roll-up. Pull-request workflows run the V18 gates so the invariants are regression-protected.

## 19. Release gates

A change is releasable when: typecheck + lint + unit + build green; static tier green;
the constitutional and V18 DB suites pass on a fresh migrated DB; live tier is green against a seeded running app;
migration list clean against the target environment. Production DB pushes follow the
runbook in `docs/agent-memory/` (repair-before-push history exists — see memory).

## 20. Known trade-offs

- Config tables stay direct-writable by managers (speed over uniform audit).
- Each/box stock is intentionally not quantity-tracked: sales and tenders are exact,
  while stock availability remains a manual catalogue decision until a count ledger
  is justified by shop evidence.
- Operator deliveries capture no cost at the door (speed for the operator; cost gap
  is state-derived owner work).
- `admin_set_delivery_cost` can rewrite any batch cost (audited via `cost_changed`).
- Counter sales carry no customer identity by design.

## 21. Open risks

- No DB-level constraint that `orders.subtotal = Σ order_items.line_total`
  (controlled writers compute it; collection independently freezes and tenders the
  authoritative folded projection).
- No external telemetry sink (see §16).
- External owner-alert delivery still requires the configured provider/number and a
  real-phone field gate. Twilio outbound Messages has no documented request
  idempotency key, so ambiguous transport/provider outcomes are terminal-visible and
  never blindly retried; activation requires explicit acceptance of that trade-off.
- Phase-A shop reconciliation, timed Gul rehearsal, real refund/amendment day, tray
  usability and staged Owner-Away trials remain field evidence, not code claims.
- Public storefront pages still carry pre-redesign styling (cosmetic only).

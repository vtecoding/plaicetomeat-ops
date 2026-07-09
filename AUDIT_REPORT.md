# PTM Full System Audit

**System:** PlaiceToMeat Ops — butcher-shop operating system (Next.js 15 App Router,
React 19, Supabase/Postgres + RLS, Vercel).
**Audited against a live seeded local stack** (Docker → Supabase → `seed-dev.mjs` →
dev server), owner + manager + staff + operator logins, a 3-viewport screenshot pass
of every route (149 PNGs), an auth-matrix probe, a live RLS-mutation probe, and the
full unit suite. Date: 2026-06-29.

Companion files: [`ROUTE_MAP.md`](ROUTE_MAP.md), [`CRITICAL_ISSUES.md`](CRITICAL_ISSUES.md),
[`RECOMMENDED_FIX_PLAN.md`](RECOMMENDED_FIX_PLAN.md),
[`audit-screenshots/SCREENSHOT_INDEX.md`](audit-screenshots/SCREENSHOT_INDEX.md),
and the deliverable ZIP **`ptm-route-screenshots.zip`** (151 entries).

---

## Executive Summary

This is a **mature, seriously engineered system**, not a prototype. The hard part of a
butcher OS — making stock, money and audit *trustworthy* — has been designed correctly:
an append-only inventory ledger, sale-driven depletion on collection (FEFO, idempotent,
never-negative, shortfall-flagged), exactly-once reversals, a stale-count guard, a
hardened append-only audit log with secret redaction, and server-enforced role auth
with a genuine session envelope. 560 unit tests pass; the auth matrix shows no route
bypass. The new V17 "Operator Mode" (the low-tech front door for Uncle Gul) is a
thoughtful, calm, large-target surface that *reuses* the proven backend rather than
forking a second one.

**But** the audit found one **verified Critical**: the Row-Level-Security policies
grant managers/owners (and staff, for orders) **direct write access to the truth tables
themselves** — `inventory_batches`, `orders`, `order_items` — *beside* the ledger RPCs.
I proved it live: as a manager I changed a batch's remaining weight via a plain
PostgREST update with **zero ledger rows and zero audit written**. The engine that
guarantees "why/when/who/how-much" can simply be walked around. That single hole
undercuts the system's central invariant and must be closed before real use. A second
Critical is the absence of any friendly error/404 surface (raw Next.js error screens
for a non-technical operator), plus High-severity money/compliance gaps in the new
Operator Mode (custom counter items recorded at £0; required temperature steps
skippable; operator deliveries booked at £0 cost).

None of these require redesign — the fixes are RLS tightening + a few guard rails on
the new operator flows. The foundations are strong enough that the path from "unsafe"
to "controlled pilot" is short and well-defined (see fix plan Phase 0/1).

## Current System Health

**7 / 10.**

The core domain engine alone would score ~9 — it is better than most production
retail systems. It is pulled down by C1 (a verified, exploitable bypass of the very
invariant the system is built to protect), the lack of a failure surface for the target
persona, and money-truth gaps in the headline Operator Mode feature. After Phase 0 +
Phase 1 fixes this realistically becomes a 9.

## Critical Issues (must fix before real shop use)

Full detail + proof in [`CRITICAL_ISSUES.md`](CRITICAL_ISSUES.md).

- **C1 (verified):** RLS `FOR ALL`/`FOR UPDATE` policies let app roles write
  `inventory_batches`, `orders`, `order_items` directly, bypassing the SECURITY DEFINER
  ledger/state-machine RPCs. Stock/money/order-status can change with **no movement, no
  audit, no reason**. A direct `orders.status='collected'` also skips depletion entirely.
- **C2:** No `error.tsx` / `not-found.tsx` / `global-error.tsx` — operators hit raw,
  unstyled Next.js failure pages with no way back.

## High Priority Issues (should fix before pilot)

- **H1:** Operator "Serve Customer" records custom/"Other" items at **£0** → takings
  under-counted until manual reconciliation.
- **H2:** Serve flow treats all products as weight; each/box products mis-priced and
  not depleted.
- **H3:** Operator deliveries booked with **cost = 0** → wrong COGS/margin/waste-loss.
- **H4:** Required compliance steps (fridge temperature) are **skippable**; a day can
  open/close with no reading (out-of-range *is* rejected, which is good).
- **H5:** `/admin` duplicate-React-key warning (hub can mis-render a card);
  `/admin/briefing` hydration mismatch on redirect.

## Medium Priority Issues (can fix after pilot)

- Compliance/waste evidence tables (`compliance_logs`, `compliance_readings`,
  `inventory_waste_events`) still allow direct staff INSERT/UPDATE via RLS — same class
  as C1 but evidence rather than core stock (a hardened RPC already exists for temps).
- No `loading.tsx` on heavy routes — slow first render looks frozen on a counter tablet.
- Counter sales reuse `customer_name="Shop sale"` / phone sentinel on real orders; no
  dedicated counter-sale flag for clean reporting.
- Public storefront pages still carry pre-redesign styling (`font-black`) vs the
  "craft butcher" system applied to admin/operator.

## Route Map

48 routes enumerated and exercised. See [`ROUTE_MAP.md`](ROUTE_MAP.md) for the full
table with role, status and notes. Summary: 15 public/customer, 2 API, 3 counter,
8 operator, 24 admin (3 owner-only). All returned 200 or an intended redirect; no 5xx.
**No custom error/404 routes exist.**

## Screenshot Summary

`scripts/ptm-route-audit.mjs` logged in once as the branch-global owner, resolved
dynamic params from list pages, and captured **every route at 375 px (mobile),
768 px (tablet) and 1440 px (desktop)**, plus the operator Serve flow states
(what-bought → how-much → add-more → how-paid) at mobile and tablet, and the counter
order-detail screen. **149 PNGs + `SCREENSHOT_INDEX.md` + `_runtime.json`**, zipped as
`ptm-route-screenshots.zip`. The index records route, viewport, state, filename, HTTP
status, redirect target and any console/page error per capture. Two dynamic detail
routes weren't auto-captured: `/admin/today/[id]` (only resolves when the Owner Brain
has a live action; otherwise redirects to `/admin/today` by design) and the generic
`/order/status/[publicAccessId]` (needs a live signed token).

## Operator Flow Findings

- **Open shop:** ✅ guided one-question-at-a-time checklist, same ops-capture backend as
  the owner's. Opening "twice" safely **resumes** the same daily session (idempotent).
  Owner sees status (Operator home + admin). Temperature input present.
- **Serve customer:** ⚠️ fast, big-target, idempotent (per-run UUID), empty sale blocked
  ("What did they buy?"), negatives blocked (`>0 && <=50`), duplicates handled as added
  lines, pay type saved, **and stock truly depletes** via the collected→`deplete_order_
  inventory` path. **But** custom items record £0 (H1) and everything is weight-based (H2).
  Failed depletion rolls back inside the transition (good); failed item insert aborts.
- **Receive stock:** ✅ supplier/product/qty/expiry/storage handled, creates real batch +
  `RECEIVED` movement, idempotent (`operator-delivery:<run>:…`), unknown product/supplier
  or non-kg escalates to owner. Expired/missing expiry handled via choice + owner check.
  **Cost not captured (H3).**
- **Waste:** ✅ reduces stock via hardened RPC, **cannot exceed batch stock** (escalates
  if no batch large enough), reason captured, optional photo evidence, owner sees it
  immediately; "review" reason flags owner.
- **Close shop:** 🔶 completes/closes the day, but the required temperature step is
  skippable (H4).

## Owner / Admin Findings

Owner dashboard (`/admin`, `/admin/today`) loads and presents a deliberately compressed
"Do now / Later" decision view (the "Owner Brain"), money impact, low-stock, waste,
open/close status and alerts — all built over the same data layer, no raw-metrics dump
(by design/"firewall"). Product/supplier/category management, audit trail (owner-only),
inventory truth view with cache-vs-ledger reconciliation signals, purchasing,
compliance and pricing-validation are all present and render at all viewports. **Owner
actions are *intended* to flow through audited RPCs — but C1 means a determined
manager can still mutate stock/orders off-ledger via the API.** `/admin` has a
duplicate-key render warning (H5).

## Inventory Truth Findings

**The strongest part of the system.** Verified by reading the migrations and probing live:
- `inventory_movements` is **append-only** — BEFORE UPDATE/DELETE/TRUNCATE trigger
  raises, and UPDATE/DELETE/TRUNCATE are revoked from app roles (V14.1-H). Every change
  writes a signed (`delta_kg`), balanced (`balance_before/after_kg`) row with
  `source_event`, `reason`, `created_by`, `idempotency_key` — fully reconstructable.
- Sale depletion on `collected`: FEFO, locks batches in deterministic order, idempotent
  via unique keys, floors at 0 with an explicit shortfall record (never negative; CHECK
  `balance_after >= 0`).
- Corrections, waste, intake reconciliation, count reconciliation and reversals all
  append movements with reasons; reversals are exactly-once per (order, reason).
- `remaining_weight_kg` on a batch is an explicit **cache**; `inventory_reconciliation_
  monitor` detects cache↔ledger drift.
- **The one breach is C1** — the cache table is directly writable, so the ledger can be
  bypassed. Fixing C1 makes the inventory-truth story airtight.

## Database Findings

- Clear naming; FKs throughout (`ON DELETE CASCADE`/`SET NULL`/`RESTRICT` chosen
  deliberately — e.g. `products … ON DELETE RESTRICT` so sold products can't orphan
  history; `inventory_movements.batch_id … CASCADE` but protected by the append-only
  trigger).
- **Money = `numeric(10,2)`** (fixed-point) everywhere for prices/subtotals/line totals
  — no floats. Weights = `numeric(8,3)`/`numeric(10,3)` kg; `unit_type` enum
  (`kg`/`each`/`box`) makes units explicit.
- Status/enum columns use `CHECK` constraints (order status, batch status, movement
  type, waste reason, checklist input kind with min/max).
- Timestamps on all tables; audit rows actor-bound; RLS enabled on sensitive tables.
- Indexes for the common access paths (branch+expiry, batch+created, order, idempotency).
- **Schema risk = the RLS write surface (C1), not the table design.** Table design is sound.

## Auth / Security Findings

- Role auth is **server-side**, not client-only: middleware re-validates the Supabase
  JWT, verifies a signed user-bound session envelope (idle + absolute timeout, fail-
  closed on missing/forged), then `canAccessStaffPath`; every page re-checks via
  `requireStaffContext`. Branch isolation is explicit (non-owner locked to own branch).
- **Live auth matrix: no bypass.** unauth→login, staff→unauthorised on admin/operator,
  manager→unauthorised on owner-only, operator_mode locked to `/operator`, owner global.
- Login: lockout on repeated failure, generic error (no user enumeration), hashed
  signals only (no PII in logs).
- Public order access uses anon client + SECURITY DEFINER RPCs returning safe DTOs (no
  service-role on public paths); secrets redacted from audit metadata.
- Checkout API enforces the same hardened service as the storefront (body cap, schema,
  rate limit, idempotency).
- **Caveat:** application-layer auth is excellent, but the *data-layer* write
  authorisation (RLS) is too broad on truth tables (C1) — the most important security
  finding.

## UI / UX Findings

- **Operator Mode is well-judged for the persona:** 4 big doors, one "lead" action,
  ≥56–72 px tap targets, plain words, minimal typing (number pads, choice buttons),
  serif "craft butcher" identity, dot progress (never a percentage), reassuring done
  states. Tablet/mobile screenshots confirm it holds up at 375/768 px.
- Owner/admin is denser but consistent (shared `Masthead`/`Surface`/`SectionHeading`).
- **Gaps:** no friendly error/404 (C2) — the biggest UX risk for a low-tech user;
  `/admin` duplicate-key warning (H5); public storefront still on older styling;
  no loading states on heavy routes.

## Failure Modes

- **Refresh mid-sale / closed tab:** serve uses a client-generated run UUID +
  `readCompletedRun`/`getExistingByRun` → resubmits collapse to the same order (no dupe).
- **Double-click submit:** buttons disable on pending; idempotency keys backstop.
- **Sale succeeds but stock update fails / vice-versa:** depletion runs *inside*
  `transition_order_status`'s transaction — both commit or neither (order stays `ready`).
- **DB write failure mid-flow:** item-insert failure returns an error; the order can be
  re-driven idempotently.
- **Duplicate delivery:** intake idempotency key dedupes; mismatched reuse is rejected.
- **Product deleted after sale:** `ON DELETE RESTRICT` + name/price snapshots on order
  items preserve history.
- **Batch expired / oversell:** FEFO + allow-and-flag shortfall; recalled/disposed
  batches excluded from depletion.
- **Role changed mid-session:** middleware re-reads profile each request.
- **Unhandled throw:** middleware fails closed to `/`; **but a thrown render shows the
  raw Next.js error page (C2).**

## Test Coverage

- **560 unit tests across 73 files — all passing** (`vitest`, this run). Strong coverage
  of domain logic: owner-brain, inventory/compliance, pricing validation, carcass
  breakdown, session envelope, route-access, public-order-access, action intelligence.
- **E2E (Playwright):** route-protection, ops-capture, purchasing, inventory, checkout,
  counter realtime/persistence, storefront, auth, admin dashboards, owner-brain — ~40
  spec files.
- **Bespoke `verify:` gates** for operator firewall/route-lock, owner-brain compliance,
  intelligence firewall, surface convergence, pricing/disaster-recovery integrity.
- **Gaps to add (see fix plan §Tests):** a guard that direct table writes to
  `inventory_batches`/`orders`/`order_items` are rejected (pins C1); operator-serve
  end-to-end stock-movement assertion; £0-custom-line rejection; skipped-required-temp
  blocks completion; friendly-error-page render.

## Recommended Fix Plan

See [`RECOMMENDED_FIX_PLAN.md`](RECOMMENDED_FIX_PLAN.md). Phase 0 (Critical): F1 lock
truth tables to RPCs + F4 friendly error/404. Phase 1 (High): F5 £0 items, F6 unit
correctness, F8 required-temp enforcement, F9 admin key/hydration, F7 operator cost
flag. Phase 2/3: evidence-table RLS, count-based serve, loading states, styling cleanup.

## Final Verdict

### ⚠️ Pilot possible after fixes — currently Pilot-unsafe.

The system is **not yet safe for a real shop or even a pilot as-is**, for one decisive
reason: **C1 is a verified, exploitable bypass of stock/money/audit truth** — the exact
thing this product exists to guarantee — and there is no friendly failure surface for
the non-technical operator (C2). Neither is hard to fix and neither requires redesign.

**After Phase 0 (F1 + F4) it would be "Ready for controlled pilot,"** and after Phase 1
it would be production-credible for a single-shop launch. The underlying architecture,
test discipline, and Operator-Mode design are strong enough that I'd back this system
once the data-layer write surface is locked down to match the application-layer rigour
that's already there.

# PTM Critical & High-Priority Issues

Severity per the audit spec:
- **Critical** — can corrupt stock, money, audit history, auth, or daily operation.
- **High** — can confuse the operator, lose evidence, cause bad owner decisions, or create manual rework.

The engine that protects stock truth (append-only `inventory_movements`, signed/
balanced rows, FEFO depletion, exactly-once reversals, stale-count guard) is genuinely
strong. The critical issues below are about **write paths that sit *beside* that engine
and are not locked to it**, plus a few money/UX gaps in the new Operator Mode.

---

## CRITICAL

### C1 — Truth tables are directly writable via RLS, bypassing the ledger RPCs ✅ verified exploitable
**Where:** `supabase/migrations/202605300001_v2_phase_a_backbone.sql:276-278`
```sql
CREATE POLICY "managers can manage inventory batches" ON public.inventory_batches
FOR ALL USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));
```
The whole inventory-truth design routes stock changes through SECURITY DEFINER RPCs
(`admin_adjust_inventory_remaining`, `admin_record_inventory_waste`, …) that write an
append-only `inventory_movements` row for every change. But this `FOR ALL` RLS policy
*also* grants `authenticated` managers/owners direct INSERT/UPDATE/DELETE on
`inventory_batches` through PostgREST — completely outside the ledger.

**Proof (this audit, live local stack):** signed in as `manager@ptm.test` and ran a
plain PostgREST `update`:
```
target batch f2d84bc9… remaining: 5
direct UPDATE result: ALLOWED -> remaining_weight_kg = 4.877
DB remaining now: 4.877 | new ledger rows: 0   ← stock changed, NO movement, NO audit, NO reason
```
(value restored afterwards). This is exactly the "direct stock editing" the spec says
to mark **critical unless it creates a proper adjustment event** — it creates none.
The reconciliation monitor *would later flag* a cache↔ledger mismatch, but the mutation
itself is silent: no actor in the ledger, no reason, no `why/when/how-much`.

DELETE is likewise policy-allowed (a batch with movements is saved only incidentally,
by the append-only trigger blocking the cascade; a movement-free batch can be hard-deleted).

**Same class, same migration set:**
- `orders` `FOR UPDATE` by staff (`202605290001_init.sql:358`) and `order_items`
  `FOR UPDATE` (`:361`). A staff client can PATCH `orders.status = 'collected'`
  directly — which **skips `transition_order_status` and therefore skips
  `deplete_order_inventory`**: an order can be marked collected with stock never
  leaving the ledger (or stepped backwards out of the state machine). Order-item
  quantities/prices are directly editable too.
- `products` `FOR ALL` by managers (`202605290001_init.sql:349`) — price/cost edits
  bypass the `price_changed`/`cost_changed` audit emission.

**Impact:** stock, money, and audit truth can be changed with no event — the single
most important invariant in the spec ("if meat … sells, wastes, or adjusts, the system
must record why, when, by whom, and how much"). 

**Fix direction:** make the ledger/state tables **read + RPC-only** for app roles
(mirror what V14.1-H already did for `inventory_movements`): drop the `FOR ALL`/`FOR
UPDATE` write policies on `inventory_batches`, `orders`, `order_items`; keep `FOR
SELECT`; `REVOKE INSERT, UPDATE, DELETE … FROM authenticated`. All writes already have
a SECURITY DEFINER path, so the app keeps working. (See RECOMMENDED_FIX_PLAN F1.)

---

### C2 — No friendly failure surface: errors and 404s render raw Next.js defaults
**Where:** there is **no** `error.tsx` / `global-error.tsx` / `not-found.tsx` /
`loading.tsx` anywhere under `src/app/`.
A failed server action, a thrown render, or a bad id (`notFound()` in
`/counter/orders/[id]`) drops the user onto the unstyled Next.js error/404 screen. For
a low-computer-literacy operator mid-service this is a dead end with no "go home" path,
and it looks like the system broke. This is a daily-operation / failure-safety risk for
the exact persona the system is built for.

**Fix direction:** add an operator-friendly `global-error.tsx` + `not-found.tsx` (big
"Something went wrong — tap to go back / call owner" with a Home link), and an
`error.tsx` inside `/operator` and `/counter`. (Fix plan F4.)

---

## HIGH

### H1 — Operator counter sale records custom items at £0 (money under-counts)
**Where:** `src/app/actions/operator/serve.ts:191-201`. When a line has no matched
product (the "Other" tile, or a name the catalogue doesn't resolve), `price = 0` and
`line_total = quantityKg * 0 = 0`. The order is still saved and collected; the owner
gets an "Owner check needed" alert, but **the sale's recorded revenue is understated**
until the owner manually reconciles. A counter that regularly rings up "Other" items
will systematically under-report takings. Combined with the depletion engine ignoring
non-kg lines, an "Other" sale moves neither money nor stock truthfully.
**Fix:** require a price for custom lines (simple numeric pad), or hold the sale in a
"needs price" state instead of persisting £0. (Fix plan F5.)

### H2 — Serve flow treats every product as weight (kg); each/box products mis-handled
**Where:** `serve.ts` + `src/lib/operator/workflows/serve.ts`. Amounts are entered in
grams/kg only (500g / 1kg / 2kg / custom grams). `buildServeTiles` *prefers* kg
products (+100) but does **not exclude** `each`/`box` products, so if the only
"Chicken" is an each-priced whole bird, the tile resolves to it; selling "1kg" then
charges `1 × price_per_each` (wrong money) and, because depletion is kg-only, moves no
stock. There is no way to sell "2 chickens" as a count.
**Fix:** restrict serve tiles to `kg` products (or branch the amount step to a
quantity pad for each/box), and price each/box lines by unit. (Fix plan F6.)

### H3 — Operator deliveries capture no cost (invoice cost = 0)
**Where:** `src/app/actions/operator/delivery.ts:192` passes `invoiceCost: 0`. Stock
received through Operator Mode lands with `cost_per_kg = 0`, so margin/COGS and the
waste "estimated loss" figures are wrong for operator-received batches until an owner
edits them. Acceptable as a deliberate "owner fills cost later" trade-off, but today
nothing forces or even flags that follow-up specifically as a cost gap.
**Fix:** flag operator-received batches as "cost pending" and surface them in the owner
reconciliation list. (Fix plan F7.)

### H4 — Required compliance steps (temperature) are skippable at close/open
**Where:** `src/app/operator/_components/operator-checklist.tsx:177-185`. Every step —
including `fridge_temp`/`fridges_closed`, defined as `required: true` in
`202606071700_v12_6…:61,69` — offers a "Not now" / "I can't do this — tell the owner"
skip, and `completeChecklist` lets the day finish. Out-of-range values *are* rejected
server-side (`[-30,30]°C`), which is good — but a day can still be opened/closed with
**no temperature recorded at all**, leaving a hole in the food-safety audit trail.
**Fix:** block completion (or hard-escalate) when a `required` numeric compliance step
was skipped, rather than silently allowing close. (Fix plan F8.)

### H5 — `/admin` hub renders a React duplicate-key warning; `/admin/briefing` hydration mismatch
**Where:** observed in the live capture pass console.
- `/admin`: `Encountered two children with the same key` — a list is keyed on a
  non-unique value; React may drop/duplicate a card, so the owner's hub can silently
  mis-render an item. Bad owner-decision risk.
- `/admin/briefing`: `Hydration failed because the server rendered HTML didn't match`
  during its redirect to `/admin/today`. Functional (it redirects) but indicates a
  server/client divergence worth removing.
**Fix:** give the `/admin` list a stable unique key; resolve the briefing route to a
clean server redirect. (Fix plan F9.)

---

## Verified-GOOD (explicitly cleared)

These were probed and found safe — recorded so the owner knows what *was* checked:

- **Append-only ledger:** `inventory_movements` UPDATE/DELETE/TRUNCATE blocked by
  trigger + revoked grants (V14.1-H). Cascade-delete of a batch with movements is
  blocked by the trigger.
- **Sale → stock:** collected orders deplete FEFO, idempotent (unique keys), never
  negative (CHECK + floor), with shortfall flagged for reconciliation.
- **Exactly-once reversals:** `admin_reverse_order_inventory` appends compensating rows
  linked to the originals; one group per (order, reason).
- **Stale-count guard:** `ops_apply_stock_count_line` refuses to apply if stock moved
  since the count was recorded (no lost updates).
- **Auth:** middleware + `requireStaffContext` enforce role server-side; full
  auth-matrix probe showed no bypass; owner-only and operator-lock both hold.
- **Audit log integrity:** `audit_logs` insert policies dropped (V11.2); only the
  hardened `emit_audit_log` writes, with secret-key redaction and a fixed allowlist.
- **Money type:** `numeric(10,2)` fixed-point for all prices/totals (no floats).
- **Checkout:** single hardened service for storefront and API (body cap, schema,
  rate limit, idempotency).

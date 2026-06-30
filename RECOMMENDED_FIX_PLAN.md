# PTM Recommended Fix Plan

Ordered by risk-to-ship. Effort is rough (S = hours, M = a day, L = multi-day). The
build constraint holds throughout: **do not redesign the app, do not add features** —
these are targeted hardening + gap-closing changes that fit the existing architecture.

## Phase 0 — Must fix before any real-shop use (Critical)

### F1. Lock truth tables to the ledger/state-machine RPCs (closes C1) — M
The single most important fix. The SECURITY DEFINER write paths already exist; remove
the parallel direct-write doors.
- New migration: on `public.inventory_batches`, drop policy `"managers can manage
  inventory batches"` and replace with a `FOR SELECT` read policy only; then
  `REVOKE INSERT, UPDATE, DELETE ON public.inventory_batches FROM authenticated, anon;`
- Same for `public.orders` (drop `"staff can update branch orders"`), `public.order_items`
  (drop `"staff can update branch order items"`): keep SELECT, revoke writes — all
  legitimate changes go through `transition_order_status` / checkout RPCs.
- For `public.products`, decide: either route price/cost edits through an RPC that
  emits `price_changed`/`cost_changed`, or keep direct edit but accept the audit gap
  (lower priority than stock/orders).
- **Regression test (add to `tests/` or a `verify:` script):** as a manager, a direct
  PostgREST `update`/`insert`/`delete` on `inventory_batches`, `orders`, `order_items`
  must be **rejected**; the equivalent RPC must still succeed and write a movement.
  (This audit's throwaway probe can be promoted into a permanent guard.)
- Re-run the full suite + a manual operator serve/waste/delivery pass to confirm the
  RPC paths are unaffected (they run SECURITY DEFINER, so they are).

### F4. Add operator-friendly error / not-found surfaces (closes C2) — S
- `src/app/global-error.tsx` and `src/app/not-found.tsx`: big, calm, "Something went
  wrong — tap to go back" + Home link + "Tell the owner" escalation, brand styling.
- `src/app/operator/error.tsx` and `src/app/counter/error.tsx` for in-section recovery
  that keeps the operator inside their simple shell.

## Phase 1 — Fix before a pilot (High)

### F5. Stop recording £0 for custom serve items (closes H1) — S/M
In `operator/serve.ts`, when a line has no matched product, require a price (add a
"How much was it?" numeric step in `operator-serve-flow.tsx`) or persist the sale in a
`needs_price` state instead of a £0 line. Keep the existing owner alert.

### F6. Make the serve flow unit-correct (closes H2) — M
Restrict `buildServeTiles` to `unit_type === 'kg'` products (or, if each/box must be
sellable at the counter, branch the amount step into a count pad and price by unit).
Ensures money and depletion both match what physically left.

### F8. Don't let required compliance steps be silently skipped (closes H4) — S/M
In the operator checklist + `completeChecklist`, if a `required` numeric step
(temperature) was skipped, block completion or force an owner escalation before the
day can close. Out-of-range is already rejected; this closes the "no reading at all"
hole.

### F9. Fix `/admin` duplicate-key + `/admin/briefing` hydration (closes H5) — S
Give the `/admin` hub list a stable unique key; convert `/admin/briefing` to a clean
server-side `redirect()` so no client hydration runs before the bounce.

### F7. Flag operator-received batches as "cost pending" (closes H3) — S
Mark batches created via `operator/delivery.ts` (invoice cost 0) and surface them in
the owner reconciliation/Today list as "add cost", so COGS/margin aren't quietly wrong.

## Phase 2 — After pilot (Medium)

- **M1.** Compliance evidence tables (`compliance_logs`, `compliance_readings`,
  `inventory_waste_events`) still accept direct staff INSERT/UPDATE via RLS. Route them
  through the hardened RPCs (the temperature-capture RPC already exists) and revoke
  direct writes, same pattern as F1, so evidence can't be fabricated/edited off-ledger.
- **M2.** Serve flow: support selling by count for each/box, and a "2 chickens" path.
- **M3.** Add a tiny `loading.tsx` for the heavier admin/operator routes so a slow
  first compile/render doesn't look frozen on a counter tablet.
- **M4.** Operator `/operator/serve` uses `customer_phone: "07000000000"` and
  `customer_name: "Shop sale"` sentinels on real orders — fine functionally, but
  consider a dedicated `is_counter_sale` flag so counter sales are cleanly separable
  from online orders in reporting.

## Phase 3 — Cleanup (Low)

- **L1.** Remove/booby-trap the `app.inventory_seed_bypass` GUC in any non-local
  environment (it's already not reachable via PostgREST; document it).
- **L2.** Consolidate the two screenshot/audit scripts (`scripts/audit-screenshots.mjs`
  and this audit's `scripts/ptm-route-audit.mjs`) into one maintained tool.
- **L3.** Replace remaining `font-black` / generic styling on the public storefront
  pages (shop/product/basket/checkout) to match the "craft butcher" design system
  already applied to admin/operator.

## Suggested test additions (per spec §12)

The suite already covers a lot (560 unit + e2e route-protection, ops-capture,
purchasing, inventory, checkout). Add:
1. **RLS guard:** direct table write to `inventory_batches` / `orders` / `order_items`
   by a manager is rejected (the F1 regression test). *Highest value — it pins C1.*
2. Operator serve: custom/"Other" line cannot be saved at £0 (after F5).
3. Operator serve: selling a kg product creates an order **and** a `SALE_COLLECT`
   inventory movement (end-to-end stock-truth assertion through Operator Mode).
4. Operator checklist: a skipped required temperature step blocks `completeChecklist`
   (after F8).
5. `notFound()` / thrown error renders the custom friendly page (after F4).

# V18 Phase A — A2 and B5 implementation note

Implemented on the unified Phase A branch on 14 July 2026.

## A2 — each/box trade and inventory policy

- `products.inventory_policy` is required and constrained to `kg_batch` or
  `untracked_manual`. Each/box can only be untracked; kg normally derives `kg_batch`
  and may deliberately remain manual.
- Product RPCs derive policy from unit and accept no arbitrary policy input. On create,
  the owner may explicitly choose an uncounted kg product; existing kg products expose
  the same audited choice. A batch-write trigger rejects untracked products.
- Stopping kg stock counting freezes every old batch out of stock truth immediately.
  Counting can only be started again when the product has no batch history; unit edits
  cannot bypass that refusal. This prevents a stale physical balance becoming live.
- Canonical stock readers and intelligence exclude untracked products from quantity, value,
  expiry, cover, low-stock and buying claims. Sales, tenders and product performance remain in.
- Inventory, Products and Purchasing use the exact label **Stock not counted**. Public
  availability continues to use manual catalogue availability/stock status.
- Operator delivery and waste entry lists contain only `kg_batch` products. Serve accepts
  catalogue each/box lines as integer counts 1–99 and creates no kg movement for them.

## B5 — price-visible serve

- Weight and count presets show an approximate expected line price.
- Add-more and confirm screens show each line price and the Total.
- Save returns the persisted server subtotal. Done repeats it and says **Price updated** if it
  differs from the browser estimate.
- The in-app owner guide includes a counter-sale rehearsal covering weight/count, price readout,
  tender, confirmation and saved total.

## Automated evidence

Evidence is regenerated from a clean migrated and seeded local stack with
`verify:inventory-policy`, `verify:untracked-isolation`, `verify:atomic-operator-serve`,
`verify:operator-serve`, the V18 Playwright suite, typecheck, unit, build and operator
language/firewall gates. The consolidated Phase-A report records the exact results; this
design note deliberately carries no copied pass counts that can go stale.

These are implementation checks, not the owner-required physical shop trial. The timed Gul
rehearsal and real reconciliation day remain field evidence to record at the Phase A gate.

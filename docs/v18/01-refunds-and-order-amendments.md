# V18 Phase B - refunds and order amendments

Implemented on 14 July 2026 as packages B3 and B4 of the unified V18 programme.

## Shipped reality

### B3 - refunds and mistake flags

- `refund_order_v18` is the only refund transaction boundary. Its signature has no
  refund-method input. It locks the order and derives the method and remaining balance
  from append-only sale/refund events.
- `refund_operations` and `refund_line_outcomes` preserve operation-level and line-level
  evidence. A client-generated operation UUID makes a replay return the original receipt
  without another money, stock, waste, audit or owner-alert fact.
- A line is capped by the quantity and value actually depleted, less earlier refunds.
  The per-method refund total can never exceed sale payments less earlier refunds for
  that method.
- `customer_kept` writes no movement. `returned_restockable` reverses the exact original
  FEFO allocations using `reversal_of_movement_id`. `returned_discarded` first reverses
  those allocations and then records returned waste, for net-zero stock and preserved
  waste cost.
- Money, line outcomes, inventory movements, waste, audit and the threshold owner job
  commit or roll back in one PostgreSQL transaction. The thin server action is manager-only;
  the operation-scoped owner job is created in the RPC for a refund at or above the
  configured GBP 20 default, so a crash or replay cannot lose or duplicate it.
- Refund selections for `each` and `box` lines must be whole counts. Fractional kg remains
  supported to three decimal places.
- Operator Help includes **I made a mistake just now**. It links the latest completed run
  to an `operator_mistake_flag` owner job; it never edits the order, money or stock itself.

### B4 - weigh-at-handover amendments

- `order_amendments` is an append-only, globally ordered per-order event log. Original
  `order_items` remain immutable.
- `get_effective_order_lines_v18` is the single authoritative fold. Manager reads,
  public order status, amendment validation, tender calculation and inventory depletion
  consume this SQL projection. TypeScript only computes a labelled display preview.
- `amend_order_item_v18` supports weight adjustment, compatible sellable substitution,
  and full/partial removal while an order is preparing or ready. It requires the screen's
  expected sequence and an idempotency key. A higher final price requires explicit customer
  confirmation and always uses the substitute's live catalogue price.
- A substitute must be both catalogue-available and not `out_of_stock`. Each/box partial
  removal must leave a whole count.
- Collection freezes the maximum amendment sequence under the order lock. Tender amount
  and `kg_batch` depletion consume that same sequence, recorded on
  `order_inventory_depletions.amendment_seq`. Untracked manual lines never create kg stock.
- A transaction advisory lock gives an overlapping amend/collect attempt one clean winner.
  Collection remains terminal; post-collection correction uses the refund flow.

## Operator and manager workflow

1. On a preparing or ready order, choose **Adjust** and select the line.
2. Enter the actual kg, choose a compatible substitute, or remove all/part of the line.
3. Review ordered versus final quantity and price. Confirm a price increase with the
   customer before saving.
4. Collect normally. The displayed final total is the tendered and depleted version.
5. For a collected order, a manager chooses **Refund / fix**, selects quantities and the
   honest physical disposition, enters a reason, reviews the derived tender method and
   stock effect, then confirms.

See [Managing orders](../operational-playbooks/managing-orders.md) for the plain-language
shop procedure and [the deployment runbook](../runbooks/v18-order-corrections.md) for
release and rollback handling.

## Automated evidence

- `pnpm verify:refund-truth`: refund math, exact multi-batch reversals, disposition stock
  effects, rollback, authority, method derivation, shortfall cap and idempotency.
- `pnpm verify:amendment-depletion`: SQL event-fold composition, substitution rules,
  sequence/idempotency checks, frozen tender/depletion and no-amendment identity.
- `pnpm verify:order-correction-concurrency`: real two-connection amend/collect and
  manager-refund races.
- `V18_DB_PARITY=1 pnpm vitest run src/lib/domain/order-corrections.db.test.ts`: display
  preview versus the canonical SQL fold.
- `playwright test tests/e2e/order-corrections.spec.ts`: catch-weight collection and a
  discarded-return refund through the browser.

The automated suite proves repository/database invariants. The implementation plan's
physical reconciliation day, Dad's unaided refund rehearsal, and the Gul field rehearsal
remain real-shop exit evidence; they cannot be manufactured by a software test.

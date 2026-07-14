# V18 order-corrections release and recovery runbook

Use this for the B3 refund and B4 handover-amendment release.

## Before release

1. Apply migrations in timestamp order. Payment truth and inventory policy must already
   exist; then apply `202607141600_v18_refunds.sql` and
   `202607141700_v18_order_amendments.sql`.
2. Regenerate and verify the migration manifest.
3. Run a fresh local reset and seed, followed by `verify:refund-truth`,
   `verify:amendment-depletion`, `verify:order-correction-concurrency`, typecheck, unit,
   build and the order-corrections browser test.
4. Confirm the configured refund alert threshold. The V18 default is GBP 20.

## Release checks

- A cash sale offers only a cash refund; a card sale offers only card.
- A ready catch-weight order shows ordered and final lines, then tenders and depletes the
  same final quantity.
- A returned restockable line restores the original batches. A returned discarded line
  leaves stock unchanged and creates waste evidence. Customer-kept creates no movement.
- Staff cannot refund; a manager can. A new refund at/above threshold creates one owner job.
- Each and box corrections use whole counts; kg corrections may use three decimals.
- Operator mistake Help creates a linked owner job and changes no business facts.

## Failure and retry

- Retry an uncertain refund with the same refund-operation UUID. Never generate a new UUID
  until the prior result has been read; a replay returns the persisted receipt.
- Retry an uncertain amendment with its same idempotency key. On a stale-sequence or
  "being changed" response, refresh the order before deciding whether another edit is needed.
- Do not repair money or stock with direct table writes. Inspect `refund_operations`,
  `refund_line_outcomes`, `payment_events`, `inventory_movements` and audit rows together.

## Rollback

These migrations add append-only business evidence and replace RPC bodies. Do not down-migrate
or delete rows after live refunds/amendments exist. If the UI must be withdrawn, disable the
new entry points while retaining the schema and reads, then deploy a forward fix. Restore from
backup only for a wider disaster and follow the main restore certification runbook.

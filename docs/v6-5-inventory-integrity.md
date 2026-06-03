# V6.5 Inventory Integrity

This release separates expected breakdowns from actual stock and makes the cost source policy explicit.

## Stock lifecycle

1. Carcass intake is captured as an expected breakdown.
2. An operator reviews the cut plan.
3. Actual recorded cuts are confirmed.
4. Inventory batches are created from the confirmed intake.
5. Inventory movements, waste and adjustments update the batch, not the forecast.

## What changes stock

- `inventory_batches` creates and stores actual stock.
- `inventory_movements` records received stock, waste and adjustments.
- `inventory_waste_events` records waste against a specific batch.

## What does not change stock

- Cutting guide calculations.
- Yield guardrail estimates.
- Margin planning previews.

## Cost policy

- Margin: committed product cost wins, with weighted active batch cost as fallback.
- Purchasing: weighted active batch cost wins, with product cost as fallback.
- Inventory: batch cost stays on the batch.
- Dashboard: uses the same committed product cost first, then weighted active batch cost when needed.

## Duplicate intake protection

Intake submissions carry an idempotency key so a retry, refresh or double click cannot create a second batch.

The same key returns the same batch id. If a reused key points at a different payload, the write is rejected.

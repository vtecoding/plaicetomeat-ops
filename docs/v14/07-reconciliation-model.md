# V14.0 — 07 · Reconciliation Model — *Counts, adjustments, variance*

Once sales deplete stock automatically, the system's *belief* about stock will inevitably diverge from the *physical* shelf: weight estimates, trim loss, theft, miskeyed quantities, un-recorded waste. Reconciliation is how physical reality re-asserts itself over the ledger — **without lying about the past.**

---

## The central question: can a stock count overwrite inventory?

**No.** A stock count must **never** silently overwrite `remaining_weight_kg` (Invariant 7). It must create a **reconciliation movement** that records the variance as a first-class, audited ledger event.

This is already how the system behaves and V14 keeps it. `ops_apply_stock_count_line` ([V12.5](../../supabase/migrations/202606071600_v12_5_inventory_stale_count_guard.sql)):
1. Snapshots `system_weight_kg` (belief at count time) and `counted_weight_kg` (physical reality).
2. On apply, **locks the batch** and rejects with `STALE_STOCK_COUNT` if belief changed since the snapshot (lost-update prevention).
3. If counted == system: records a no-op reconciliation (line `applied_at`, audit row, **no stock change**).
4. If counted ≠ system: routes through `admin_adjust_inventory_remaining`, producing an **`ADJUSTMENT` movement + reason + audit** — i.e. the variance is a *new ledger fact*, the prior stock figure remains in history.

### Why overwrite is forbidden
- **Invariant 4 (reconstruction):** if a count silently set `remaining = 47.2`, the ledger would no longer sum to the cache; truth would be unprovable.
- **Court-defensibility:** "stock was 50, we counted 47.2, we recorded a −2.8 variance for reason X by actor Y at time T" is evidence. "Stock is now 47.2" is an assertion with no provenance.
- **Variance is the signal.** The *difference* between belief and count is the most valuable number reconciliation produces (it reveals shrinkage, estimation error, unrecorded waste). Overwriting destroys it.

---

## The reconciliation movement (the V14 fix to make counts reconstructable)

Today the count-driven `ADJUSTMENT` shares the **sign-ambiguity defect** (Defect 1, [02](02-inventory-truth-architecture.md)): it stores `abs(delta)`. V14's signed-movement model fixes this so a reconciliation movement records:

```
source_event   = COUNT_RECONCILE
delta_kg       = counted − system        (signed: negative = shrinkage, positive = found stock)
balance_before = system_weight_kg
balance_after  = counted_weight_kg
reason         = operator reason (>= 4 chars, already enforced)
reference      = stock_count_line.id      (binds the movement to its evidence)
actor          = auth.uid()
```

Now a count variance is fully reconstructable *and* its direction is explicit — shrinkage vs. overage become queryable, which is what variance reporting needs.

---

## Three reconciliation entry points

| Entry point | Trigger | Movement | Authority |
|-------------|---------|----------|-----------|
| **Stock count** | `ops_apply_stock_count_line` (guided count session) | `COUNT_RECONCILE` (signed) | manager |
| **Manual adjustment** | `admin_adjust_inventory_remaining` (single-batch correction) | `MANUAL_ADJUST` (signed) | manager |
| **Waste** | `admin_record_inventory_waste` | `WASTE` (down only) | manager |

All three: lock the batch, require a reason, append a signed movement, update the cache, emit audit. V14 normalises them onto the **same signed-movement + balance-before/after shape** so the ledger is homogeneous and reconstructable regardless of *which* door the change came through.

---

## Variance reporting (a downstream consumer, enabled by the model)

With signed reconciliation movements, variance reporting is a straight query over the ledger — no new capture:

- **Shrinkage per product/branch/period** = `Σ delta_kg WHERE source_event = 'COUNT_RECONCILE' AND delta_kg < 0`.
- **Estimation error at intake** = compare `expected_weight_kg` vs. `actual_weight_kg` (V6.6 fields) against subsequent reconciliations.
- **Unrecorded depletion signal** = a batch with large negative count variance but no matching `WASTE`/`SALE_COLLECT` history → investigate (theft, missed waste log, estimation drift).
- **Sale-vs-count drift** = once sales deplete, the count variance *should* shrink (the system now tracks sales); a *growing* variance after V14 ships is a red flag that depletion quantities (e.g. unit→kg conversion) are wrong.

This last point is important: **the variance number is V14's own self-test.** If sales depletion is accurate, reconciliation variances trend toward zero; if they grow, the engine is mis-depleting and the count is catching it. Reconciliation thus *validates* the depletion engine, not just the shelf.

---

## Interaction with sales (the count-during-sale hazard)

A count taken while the shop is trading is a moving target. The `STALE_STOCK_COUNT` guard already handles this correctly: if a sale depletes a batch between the count snapshot and its apply, the apply is **rejected**, forcing a re-count. V14 preserves this and it becomes load-bearing once sales are frequent. Recommended operational guidance (doc, not code): perform full stock counts **at open or close** (the guided `opening`/`closing`/`stock_count` sessions already exist) when trading is paused, to minimise stale rejections — but the guard makes mid-day counts *safe* (they fail closed), just occasionally inconvenient.

---

## What reconciliation must never do

- ❌ Overwrite `remaining_weight_kg` without a movement.
- ❌ Edit or delete prior movements (append-only, Invariant 11).
- ❌ Apply a stale snapshot (CAS guard).
- ❌ Adjust without an actor and a reason (Invariants 2, 3).
- ❌ Cross branches (a count line, its session, and its batch must share a branch — already asserted in `ops_apply_stock_count_line`).

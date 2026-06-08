# V14.0 — Inventory Truth Engine: Executive Summary

**Status:** Architecture-only. No migrations, no code, no inventory movement logic.
**Date:** 2026-06-08
**Predecessor:** V13.4 (honesty + disaster recovery sealed; `BACKUP_CERTIFIED` + `RECOVERY_CERTIFIED`).
**Scope of this document set:** a signed architecture and invariant pack that defines *how inventory truth should work* before a single line of V14 implementation is written.

> **Hard stop.** This pack does not implement V14. It does not create migrations. It does not modify production code. It is the design that the V14.1–V14.3 implementation slices must conform to.

---

## Why this subsystem is different

Every prior release (V2–V13) treated inventory as **intake- and count-based**: stock goes up when a batch is received, and is corrected by manual stock counts. Sales never decrement inventory. V13.2 was explicit and honest about this.

V14 changes that one fact — *sales will now move stock* — and that one change makes inventory the **most correctness-critical subsystem in PlaiceToMeat**. Eight future capabilities sit downstream of it:

```
                       ┌─ stock levels / availability
                       ├─ depletion & purchasing
   INVENTORY TRUTH ───►├─ waste reporting
                       ├─ yield analysis
                       ├─ margin & cost-of-goods
                       ├─ inventory valuation
                       ├─ reorder recommendations
                       └─ commercial intelligence (V15)
```

A defect here is not a local bug. It silently poisons every downstream number — and because those numbers drive money decisions (what to buy, what to bin, what to charge), a wrong inventory engine is *worse than no inventory engine*. V13's whole thesis was honesty; V14 must not regress it.

That is why V14.0 is architecture-only.

---

## The six questions this pack answers

| # | Question | Answer (one line) | Detail |
|---|----------|-------------------|--------|
| 1 | **What event decrements inventory?** | `ORDER_COLLECTED` is the depletion event; reservation at create/ready is a later, optional soft overlay. | [03](03-stock-movement-model.md) |
| 2 | **How are reversals handled?** | Compensating movements (never edits/deletes), keyed exactly-once per `(order, reason)`. | [05](05-reversal-model.md) |
| 3 | **How is concurrency handled?** | Pessimistic `FOR UPDATE` on batch rows in deterministic order + idempotency-key ledger + CAS freshness guard. | [06](06-concurrency-model.md) |
| 4 | **How is inventory reconstructed?** | `inventory_movements` becomes the signed ledger of record; `remaining_weight_kg` is a verifiable cache. | [02](02-inventory-truth-architecture.md), [07](07-reconciliation-model.md) |
| 5 | **What implementation order is safest?** | Ledger-truth foundation → collection depletion → reversals → reservation/intelligence. | [10](10-v14-implementation-roadmap.md) |
| 6 | **What could silently fail?** | Adjustment-sign ambiguity, unit conversion, oversell, double-deplete, stale reads, branch crossover. | [09](09-failure-modes.md) |

---

## Headline recommendation

1. **Decrement on `ORDER_COLLECTED`** (Option C). It is the only event that maps to meat physically leaving the building. Reservation (Option D) is valuable but is layered *on top* later, not used as stock truth. See [03](03-stock-movement-model.md).
2. **Make `inventory_movements` the source of truth**, with `remaining_weight_kg` demoted to a *materialized cache* that must be reconstructable from the ledger at all times. This requires adding **signed deltas + before/after values** to movements — today an `ADJUSTMENT` row cannot tell you whether stock went up or down, which already breaks Invariant 4. See [02](02-inventory-truth-architecture.md), [08](08-audit-model.md).
3. **Deplete by FEFO with a manual override** (hybrid). Expiry-driven selection minimises spoilage; the override keeps the ledger honest about which physical batch was actually used (critical for halal-cert traceability). See [04](04-batch-depletion-model.md).
4. **Reconciliation never overwrites history.** Stock counts already create `ADJUSTMENT` movements via `ops_apply_stock_count_line` with a stale-count guard — V14 keeps and hardens this. See [07](07-reconciliation-model.md).
5. **Concurrency = pessimistic locks + idempotency ledger.** Reuse the established `SELECT … FOR UPDATE` pattern, add a one-row-per-`(order_id, intent)` depletion ledger so retries, double-clicks, and two staff fulfilling the same order collapse to exactly one depletion. See [06](06-concurrency-model.md).

---

## The two defects V14 must fix in the existing model

These exist *today* and would corrupt any sales-depletion feature built naïvely on top:

1. **Adjustment sign is unrecoverable.** `admin_adjust_inventory_remaining` writes `movement_type = 'ADJUSTMENT', quantity_kg = abs(delta)`. From the ledger alone you cannot tell a +2kg correction from a −2kg correction. This breaks Invariant 4 (reconstruct from history). See [02](02-inventory-truth-architecture.md) §"Ledger defect 1".
2. **`remaining_weight_kg` is mutated directly, not derived.** The batch row is the truth and the movement is a side-note. Sales depletion *must* invert this relationship or the two will drift. See [02](02-inventory-truth-architecture.md).

---

## What V14.0 explicitly does **not** decide

- Exact column names / SQL DDL (that is V14.1's implementation detail, constrained by this pack).
- Whether product→batch resolution stores a fixed mapping or resolves at depletion time (analysed, recommended, but the migration is V14.1).
- UI for batch override at the counter (a V14.2 concern).

---

## Document map

| File | Purpose |
|------|---------|
| [00-executive-summary.md](00-executive-summary.md) | This document. |
| [01-current-state-analysis.md](01-current-state-analysis.md) | What exists today, grounded in real migrations/RPCs. |
| [02-inventory-truth-architecture.md](02-inventory-truth-architecture.md) | The ledger-of-record model and invariants. |
| [03-stock-movement-model.md](03-stock-movement-model.md) | Which event decrements stock (A/B/C/D analysis). |
| [04-batch-depletion-model.md](04-batch-depletion-model.md) | FEFO/FIFO/manual/hybrid analysis. |
| [05-reversal-model.md](05-reversal-model.md) | Cancellation & refund reversal, exactly-once. |
| [06-concurrency-model.md](06-concurrency-model.md) | Locking, idempotency, retries, recovery. |
| [07-reconciliation-model.md](07-reconciliation-model.md) | Counts, adjustments, variance. |
| [08-audit-model.md](08-audit-model.md) | Court-defensible evidence model. |
| [09-failure-modes.md](09-failure-modes.md) | Adversarial analysis. |
| [10-v14-implementation-roadmap.md](10-v14-implementation-roadmap.md) | V14.1/V14.2/V14.3 slices. |

---

## Sign-off contract

This pack is considered **signed** when it answers all six core questions, defines hard invariants with enforcement strategies, and names every way the engine could silently fail. The implementation slices in [10](10-v14-implementation-roadmap.md) are not authorised to begin until this pack is reviewed and the depletion-event decision (Option C) is owner-confirmed.

# V14.0 — 04 · Batch Depletion Model — *Which batch is consumed, and in what order?*

A product can have many active batches (different receipts, expiries, costs, suppliers). When a sale depletes `N` kg of a product, the engine must decide *which batch(es)* to draw from. That decision drives spoilage, cost-of-goods accuracy, and halal-cert traceability.

---

## The four strategies

### FIFO — First-In, First-Out
Consume the oldest *received* batch first.
- **Spoilage:** good *only when receipts arrive in expiry order.* Fails when a later delivery has an earlier expiry (common with mixed fresh/frozen or short-dated promo stock) — FIFO would leave the sooner-expiring batch to rot.
- **Auditability:** simple, deterministic.
- **Cost accuracy:** classic FIFO costing; acceptable.
- **Complexity:** low.

### FEFO — First-Expired, First-Out
Consume the batch with the **earliest `expiry_date`** first.
- **Spoilage:** **minimises waste** — exactly the goal for perishable halal meat. This is the food-industry standard for fresh product.
- **Auditability:** deterministic *if the ordering is total* (tie-break needed — two batches can share an expiry date).
- **Cost accuracy:** cost follows the consumed batch's `cost_per_kg`; fine.
- **Complexity:** low — `inventory_batches` already has `expiry_date` and an index `(branch_id, expiry_date, status)`.
- **Feasibility:** the data already exists. No new capture required.

### Manual — operator selects the batch
Staff pick the physical batch they actually cut from.
- **Spoilage:** depends entirely on operator discipline.
- **Auditability:** **highest** — the ledger records the *physically true* batch, which is gold for halal-cert and recall traceability.
- **Cost accuracy:** exact.
- **Complexity / friction:** high — a selection step at every collection. Error-prone under counter pressure; a tired operator picks the wrong batch.

### Hybrid — FEFO default + manual override  ✅ RECOMMENDED
The engine *proposes* the FEFO batch automatically; the operator may *override* to the batch they physically used. Both the proposal and any override are recorded.
- **Spoilage:** FEFO-optimal by default.
- **Auditability:** highest achievable — defaults are deterministic and the override captures physical truth when it matters (recall, cert).
- **Cost accuracy:** exact (follows the actually-consumed batch).
- **Complexity:** moderate — the override is optional and only surfaced when more than one active batch exists for the product.

---

## Comparison

| Criterion | FIFO | FEFO | Manual | **Hybrid (FEFO+override)** |
|-----------|------|------|--------|----------------------------|
| Spoilage minimisation | ✗ (fails on out-of-order expiry) | ✓✓ | depends on staff | ✓✓ |
| Determinism | ✓ | ✓ (with tie-break) | ✗ | ✓ (default path) |
| Halal/recall traceability | ~ | ~ | ✓✓ | ✓✓ (override captures physical truth) |
| Operator friction | none | none | high | low (override optional) |
| Cost-of-goods accuracy | ok | good | exact | exact |
| Uses existing data | ✓ | ✓ | needs UI | ✓ + small UI |
| Implementation risk | low | low | medium | low–medium |

---

## Recommendation

> **FEFO by default, with an optional manual batch override (Hybrid).**

Rationale:
1. **FEFO is correct for the product class** — fresh/halal meat with real expiry dates. Minimising spoilage is a direct money win and the data is already present.
2. **Pure FIFO is unsafe here** because deliveries do not always arrive in expiry order; FIFO would actively *cause* spoilage of shorter-dated stock.
3. **Pure manual is too much friction** for a counter and degrades to garbage under pressure — but its *traceability* is exactly what halal-cert and recalls need.
4. **The hybrid keeps the best of both:** the default is optimal and zero-friction; the override exists for the moments physical truth diverges from the model (the butcher grabbed batch B, not the FEFO-suggested batch A). Recording the override keeps the ledger *physically honest* rather than *model-honest*.

For V14.1, ship **FEFO-only** (no override UI) to get the engine correct and shippable; add the **override in V14.2**. FEFO-only is a safe subset of the hybrid — the override is purely additive.

---

## Deterministic FEFO ordering (Invariant 8)

Expiry dates can tie. The selection order must be **total** so depletion is reproducible:

```
ORDER BY expiry_date ASC,        -- soonest to expire first (FEFO)
         received_date ASC,      -- then oldest receipt (FIFO tie-break)
         id ASC                  -- then stable PK tie-break (fully deterministic)
WHERE status = 'active'
  AND branch_id = :branch
  AND product_id = :product
  AND remaining_weight_kg > 0
FOR UPDATE                       -- lock the candidate set (see [06])
```

Multi-batch span: if the required kg exceeds the first batch's `remaining_weight_kg`, the engine consumes it fully (batch → `depleted`) and continues to the next batch in FEFO order until the quantity is satisfied — **each consumed batch gets its own movement row** (so per-batch traceability and per-batch cost are preserved). This produces *one movement per batch touched*, all bound to the same `order_id`.

---

## Interaction with `status` and zero-out

- When a batch's `remaining_weight_kg` reaches 0 via sale, set `status = 'depleted'` (the enum already supports it; mirrors what `admin_adjust_inventory_remaining` does at zero).
- `recalled` and `disposed` batches are **excluded** from FEFO candidates (only `status='active'`).
- A `recalled` batch must never be auto-consumed — recall safety outranks FEFO.

---

## Spoilage analysis (why FEFO pays for itself)

Fresh meat written off at expiry is pure loss at `cost_per_kg`. FEFO systematically pushes the soonest-expiring stock out the door first, shrinking the window in which any batch reaches expiry unsold. FIFO only achieves this *by accident* when receipts happen to be expiry-ordered; the first time a short-dated delivery lands behind a long-dated one, FIFO strands the short-dated batch. Given the engine already knows every batch's `expiry_date`, choosing FIFO over FEFO would be leaving free waste-reduction on the table — and waste reporting is itself a downstream consumer of this engine.

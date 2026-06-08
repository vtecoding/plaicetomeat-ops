# V14.0 — 03 · Stock Movement Model — *Which event decrements stock?*

This is the core question of V14. The answer determines the correctness profile of every downstream number.

---

## The candidate events

PlaiceToMeat's order lifecycle (enforced by `transition_order_status`):

```
incoming ──► prepping ──► ready ──► collected
    │            │           │
    └────────────┴───────────┴────► cancelled
```

A decrement could fire at any of these. Analysis follows.

---

## Option A — decrement on `ORDER_CREATED`

Stock falls the moment a customer places an order at checkout.

**Arguments for**
- Reflects committed demand immediately; availability shown to the *next* customer is conservative.
- Simplest mental model: "ordered = gone".

**Problems**
- **No-shows and cancellations are the norm, not the exception** for pre-order butchery. Most of these orders never result in meat leaving the shop. Depleting at create means constant reversals — every cancel/no-show must reverse, and reversal volume = order volume.
- **Checkout is `service_role`-only and public-triggered** (`create_checkout_order`). Wiring stock depletion into the public order path massively widens the blast radius: a bot/abuse/retry storm on checkout would thrash inventory, not just create junk orders.
- **Conflates reservation with consumption.** "I intend to buy" is not "meat has left the building." Treating them as the same destroys the distinction the business actually needs (what's promised vs. what's gone).
- **Weight is provisional at create.** A "1 leg of lamb ~2.5kg" order's true weight is known at the counter, not at checkout. Depleting an estimate at create guarantees a correction at collect.

**Verdict:** Rejected as the *depletion* trigger. (Its legitimate idea — reserving stock against promises — is Option D's reservation overlay, not depletion.)

---

## Option B — decrement on `ORDER_READY`

Stock falls when staff mark the order prepared.

**Arguments for**
- Closer to physical reality than create: the butcher has actually cut the meat, so it has physically left the batch.
- Naturally excludes never-prepped cancellations.

**Problems**
- **"Prepared but never collected"** still sits on the books as depleted while the meat is physically in the shop chiller. If the customer no-shows, the prepared meat is re-merchandised or wasted — either way the depletion was premature and needs a reversal or a waste event.
- **`ready` is reversible to `cancelled`** in the transition graph, so it inherits reversal complexity anyway.
- Marks stock gone before the money/handover is real.

**Verdict:** Rejected as the primary trigger. It is *closer* to truth than A, but "ready" is an internal prep state, not a transfer of goods. (It is, however, the natural anchor for an optional reservation maturity step in Option D.)

---

## Option C — decrement on `ORDER_COLLECTED`  ✅ RECOMMENDED

Stock falls when the customer physically collects — the terminal, irreversible state.

**Arguments for**
- **It is the only event that maps to meat physically leaving the building.** Inventory is a physical-truth system; the depletion event should be the physical-transfer event. This is the spec's own observation ("closest to real inventory transfer").
- **`collected` is terminal** in the transition graph (`ready→collected`, with no exit). There is *no reversal-from-collected* path in normal operation, so the dominant case (deplete-and-done) needs **no reversal at all**. Reversals become the rare exception (refund/mistake), not the rule.
- **Weight is final at the counter.** The butcher weighs the actual cut at handover; depleting here can use the *real* weight, not an estimate.
- **Smallest blast radius.** Triggered only from `transition_order_status` by branch staff — never public, never anon, never on a retry-prone public endpoint.
- **Cancellations before collection cost nothing** to inventory: if stock never moved, there is nothing to reverse. The transition graph already routes `incoming/prepping/ready → cancelled` *without* ever having depleted.

**Problems (and mitigations)**
- *Availability lag:* stock shown to customers stays high until collection, so two customers could order the last of something. → Mitigated by the **reservation overlay (Option D)**, layered later, which reserves against `remaining` without depleting it.
- *"Prepared, awaiting collection" is invisible to stock.* → Acceptable for V14.1; the reservation overlay closes it when business value justifies the complexity.

**Verdict:** **Recommended.** It is the correct, lowest-risk *truth* event. Build V14 depletion here first.

---

## Option D — Hybrid reservation + final depletion

Two-phase: a **soft reservation** at create (or ready) reduces *available* stock without touching *physical* stock; a **final depletion** at collect converts reservation → real movement; cancellation **releases** the reservation.

**Arguments for**
- Best availability accuracy: oversell is prevented at order time while physical truth stays honest.
- Cleanly separates "promised" from "gone" — the distinction the business actually needs.

**Problems**
- **Materially more complex:** a reservation lifecycle (`held → consumed | released | expired`), expiry/no-show sweeping, and reconciliation of reservations against physical stock.
- Reservations are *projections*, not physical truth; mixing them into the physical ledger risks re-confusing the two (the very thing Option A got wrong).

**Verdict:** **Adopt — but staged and layered, not as the V14.1 truth model.** Reservation is an *availability overlay* computed alongside physical truth, not a physical movement. Physical depletion stays on Option C. See roadmap [10](10-v14-implementation-roadmap.md): reservation is V14.3, optional, gated on real demand for oversell prevention.

---

## Recommendation, stated plainly

> **The physical stock ledger decrements on `ORDER_COLLECTED` (Option C).**
> Reservation (Option D) is a later, separate *availability* layer that reduces displayed/availability stock without writing physical movements, and is only built if oversell becomes a real operational problem.

This gives V14.1 the correct truth model with the **smallest reversal surface** (collected is terminal) and the **smallest blast radius** (staff-only, post-prep), while leaving a clean seam for reservation later.

---

## How depletion attaches to the existing transition

Inside `transition_order_status`, in the existing `ready → collected` branch, **within the same transaction and lock**:

```
on (ready → collected):
   for each order_item (resolved to a depletable kg quantity):     -- see unit-conversion note
       deplete_by_fefo(branch, product, kg, order_id, actor)        -- [04] selection, [06] locking
   record one depletion-ledger row keyed (order_id, 'SALE_COLLECT') -- [06] idempotency
   emit audit 'inventory_depleted_for_order'                        -- [08] (new allowlist entry)
```

The status flips to `collected` **only if** the depletion attempt commits (success or explicitly-recorded shortfall) — Invariant 13.

### The unit-conversion dependency (must be resolved in V14.1)
`order_items.unit_type` may be `each` or `box`, while inventory is **kg only**. Depletion needs a *kg quantity per line*. Options, to be decided in V14.1 design:
1. **Capture actual weight at collection** for `kg`/weight-confirmed products (butcher weighs the cut) — most accurate, fits the counter workflow, and `products.requires_weight_confirmation` already exists to flag these.
2. **Per-product nominal kg** for `each`/`box` items (e.g. "1 box ≈ 5kg") stored on the product, used when no weighed value is captured.
3. Items with **no resolvable kg** (pure non-weight SKUs, if any) are *not* depleted and are flagged as non-inventory items.

This conversion is the single biggest piece of *new* domain modelling in V14 and is called out again in [09](09-failure-modes.md) (silent under/over-depletion) and [10](10-v14-implementation-roadmap.md).

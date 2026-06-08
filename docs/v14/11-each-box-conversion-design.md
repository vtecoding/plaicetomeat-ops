# V14.0 — 11 · Each/Box → kg Conversion (design note, NOT implemented)

> Status: **design only.** Written during V14.1 (sales-driven stock truth, kg products
> only). No code, no migration, no behaviour. This records *how* non-weight products
> will eventually move stock so the decision isn't lost — implementation is a later slice.

## Why this exists

V14.1 ships the truth foundation with one deliberate boundary (owner-confirmed):

> **Only `kg` products deplete stock.** Their order `quantity` already *is* the kg, so
> depletion is exact and invents nothing. `each` and `box` products stay fully sellable
> but are recorded as **not weight-tracked** — their stock is counted by hand, exactly as
> it is today. No nominal weights, no automatic conversion, no counter weigh-step, and
> **never** a failure or a developer-facing message.

This closes the most dangerous version of F12 (unit-conversion error → systematic
over/under-depletion) by **not guessing**. The cost is that each/box stock still relies on
manual counts. That is acceptable for the first slice and honest about confidence.

## The eventual options (pick in a later slice, owner-gated)

Each resolves an `each`/`box` order line to a depletable kg quantity. They are not
mutually exclusive — a hybrid is likely.

1. **Per-product nominal weight.** Add `products.nominal_kg` (kg per unit). A line of
   `2 × Whole Chicken` depletes `2 × nominal_kg`.
   - *Pros:* zero counter friction; uses existing order data.
   - *Cons:* nominal weights are estimates → guaranteed reconciliation drift the stock
     count must absorb; requires the owner to set a weight per each/box product.

2. **Weighed-at-sale / weighed-at-collection.** Capture the actual cut weight at the
   counter for weight-confirmed products (`products.requires_weight_confirmation` already
   exists). The collected line carries a real kg.
   - *Pros:* most accurate; matches how a butcher actually works.
   - *Cons:* adds an input step to the counter — must be designed to stay calm and
     one-tap, or it violates the Operator-First Doctrine.

3. **Supplier-defined pack weights.** For `box`/pack SKUs, derive kg from the pack
   composition (e.g. a curry pack = 1kg chicken + 0.5kg lamb + 0.5kg mince), depleting
   each component product.
   - *Pros:* correct for composite packs; feeds true cost-of-goods.
   - *Cons:* needs a pack→components model; more schema.

## Recommended eventual shape

- **Weighed-at-collection** for single-product weight items (most accurate, fits the
  counter) — opt-in per product via `requires_weight_confirmation`.
- **Per-product nominal weight** as the fallback for `each` items with no weighed value.
- **Pack composition** for `box` packs, depleting component kg.
- Anything still unresolvable stays **non-inventory** and is counted manually — the
  V14.1 behaviour, never a failure.

## Operator language (unchanged across all options)

- Weight-tracked: *"stock updated"* / silent success.
- Not weight-tracked: *"stock is counted manually."*
- Short on a weighed item: *"Please count {product} when convenient."*

Never: nominal-kg, conversion, movement, depletion, variance.

## Cross-references

- [03 · Stock movement model](03-stock-movement-model.md) — the unit-conversion dependency.
- [09 · Failure modes](09-failure-modes.md) — F12 (the highest new risk).
- [10 · Roadmap](10-v14-implementation-roadmap.md) — this is part of the V14.2 "unit-conversion model resolved first" prerequisite.

# UX Friction Report — PlaiceToMeat Ops

Date: 2026-05-30 · Scored 1–10 (10 = excellent). Direct assessment, no padding. Evidence in `audit-results/screenshots/`.

Priority key: **P0** blocks launch/trust/security · **P1** must fix before serious use · **P2** conversion/retention · **P3** polish.

---

## Customer Flow

### First impression — 8/10
- **Works:** Hero butcher-counter image, "PlaiceToMeat Wylde Green", HMC halal trust badge, address, and a one-line value prop ("order ahead, collect from the counter, pay on collection") with a single obvious CTA. Instantly reads as a local halal butcher doing click-and-collect.
- **Friction:** Opening hours not visible above the fold; "next available pickup window" banner is good but generic.
- **Why it matters:** First 5 seconds decide trust for a £40 meat order from a shop they may not know.
- **Fix:** Add today's open/close + "ordering closes 4pm" to the hero; show a live "X collection slots left today".
- **Priority:** P3.

### Trust — 8/10
- **Works:** HMC badge, "pay at the counter — no online payment taken", privacy notice linked from checkout.
- **Friction:** Trust is asserted, not provable — no certificate detail, no "last verified" date, no supplier transparency (the DB *has* supplier cert tables).
- **Why it matters:** Halal trust is the #1 differentiator vs supermarkets and the reason a customer chooses this shop.
- **Fix:** Public halal-promise page backed by `suppliers`/`supplier_documents` with a visible "verified" date (see V2 §7).
- **Priority:** P2.

### Product discovery — 6/10
- **Works:** Clear product cards, categories, per-item pricing.
- **Friction:** No search, no "best for curry/grill/roast" guidance, no bundles, no household-size helper. Browsing is flat.
- **Why it matters:** Discovery drives average order value; a butcher's edge is advice, which the UI doesn't give.
- **Fix:** Education tags, bundles, "build my weekly box" (V2 §6, §12).
- **Priority:** P2.

### Basket clarity — 8/10
- **Works:** Items, quantities, totals; "weight-based items may vary slightly" disclaimer; empty state handled.
- **Friction:** Variable-weight pricing is disclaimed in text but not modeled (no "approx £X, final at counter").
- **Why it matters:** Final-weight/price mismatch is the #1 butcher e-commerce dispute.
- **Fix:** Weight-variance display + counter re-weigh approval (V2 §13).
- **Priority:** P2.

### Checkout ease — 8/10
- **Works:** Single clean form; required fields enforced; submit disabled until basket valid + min order met; transparent "server checks still run" note; great mobile layout.
- **Friction:** Phone format errors surface late (client `pattern` ignored, P1.3); errors show as one top-of-form alert rather than inline per field.
- **Why it matters:** Every avoidable error on mobile loses a conversion.
- **Fix:** Inline JS phone validation + field-level error association.
- **Priority:** P1 (phone), P3 (inline errors).

### Pickup clarity — 7/10
- **Works:** Pickup date + named windows with times; same-day 4pm cutoff stated.
- **Friction:** No confirmation-page proof seen (not submitted); customer doesn't yet see "what happens next / how we'll text you".
- **Fix:** Confirmation page with ref, window, address map, and "we'll text when ready" (verify in test mode).
- **Priority:** P1.

### Mobile experience — 8/10
- **Works:** 390×844 checkout and storefront are clean, single-column, well-spaced, tappable. *Evidence:* `responsive/_checkout__mobile-*`.
- **Friction:** Tap-target sizes/contrast not axe-verified.
- **Priority:** P3.

### Error recovery — 6/10
- **Works:** Server returns specific messages (window full, item unavailable, min order); shown in an alert.
- **Friction:** No retry affordance on network failure; no offline handling; client phone error is generic.
- **Priority:** P1/P2.

### Perceived professionalism — 8/10
- Consistent type, color, spacing; looks like a real brand, not a template. Strong.

**Customer flow average ≈ 7.4/10 — the strongest part of the product and close to launch-ready.**

---

## Staff Flow

### Speed — 7/10 (visual) / 2/10 (functional)
- **Works:** Big touch buttons, board layout, audible new-order tone, tablet reflow.
- **Breaks:** Actions don't persist; a refresh loses work (P0.2).
- **Fix:** Persisted status server action. **Priority: P0.**

### Clarity — 7/10
- **Works:** Ref, name, window, items, subtotal, SMS badge per card.
- **Breaks:** No customer phone, no precise status age, items truncated at 2 with no "+N".
- **Fix:** Add phone (one-tap call), "received Xm ago" timer, full item list/expander. **Priority: P2.**

### Mistake prevention — 5/10
- **Works:** Cancel has a confirm dialog.
- **Breaks:** Status can't regress safely because nothing persists; no audit of who did what (no `order_status_events`/actor written). **Priority: P0/P1.**

### Order urgency visibility — 6/10
- **Works:** Urgency border colors + pulse for passed windows.
- **Breaks:** No countdown/age text; urgency relies on color alone (accessibility risk). **Priority: P2.**

### Status flow — 3/10
- Transitions exist visually but are not real (P0.2). **Priority: P0.**

### Notes / internal comms — 4/10
- "Notes attached" indicator only; `order_notes` table exists but no staff note entry/handover UI. **Priority: P1.**

### Multi-tab consistency — 1/10
- No realtime + no persistence ⇒ two tablets diverge immediately (P0.3). **Priority: P0.**

**Staff flow: looks ready, isn't. Functional reliability is the launch blocker.**

---

## Manager / Owner Flow

### Control — 2/10
- Admin renders but writes nothing (P0.4). Owner cannot change a price, mark out-of-stock, or edit a window. **Priority: P0.**

### Reporting — 1/10
- No daily summary, revenue, or order counts anywhere. **Priority: P1.**

### Product management — 2/10
- Read-only list; "Add product" inert; no audit on price changes. **Priority: P0/P1.**

### Compliance confidence — 3/10
- Temp-log + readings schema is excellent and HMC-credible, but admin compliance is a static view with no entry, no expiry alerts, no supplier certs surfaced. **Priority: P1.**

### Operational visibility — 2/10
- No expiring-stock board, no waste view, no capacity view — despite inventory tables existing in the DB. **Priority: P1/P2.**

### "Does the owner know what to do next?" — 1/10
- No. There is no action-needed surface. This is the difference between a website and an operating system. **Priority: P1.**

**Manager flow: prototype only. The schema is ready; the UI is not.**

---

## Top friction, ranked
1. **No login** — staff/owner can't get in at all. (P0)
2. **Counter doesn't persist / no realtime** — can't run a service. (P0)
3. **Admin writes nothing** — owner can't operate. (P0)
4. **No owner daily briefing / reporting** — no operational visibility. (P1)
5. **Inventory + waste + supplier-cert UI absent** despite schema — the margin and trust engines are dormant. (P1/P2)
6. **Customer phone format UX + inline errors** — small conversion leaks. (P1/P3)

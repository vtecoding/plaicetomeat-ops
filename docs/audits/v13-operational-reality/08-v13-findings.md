# 08 — V13 Findings

_V13 Operational Reality Audit · 2026-06-08 · audit-only._

Consolidated findings from reports 01–07, sorted into action categories. Each links to its
evidence report.

> **Framing finding (read first):** the brief assumes a post-V12 / post-V13.1 system with a
> "pricing validation/signoff report." **None of those artefacts exist in the repository.**
> HEAD is `fb9985c`, maturity ≈ V11.3. This audit therefore audits the *real* system, and
> the "missing V12/V13 inputs" is itself logged under Unknowns. Treat any V12/V13 claims
> elsewhere as unverified.

---

## A. Must fix before V13 close

1. **SMS is a stub — no customer is ever texted, yet the UI promises a text. (R7, `02`#16, `04`)**
   Decide and act: wire Twilio + test, **or** remove the "we'll text you when ready" promise
   from customer copy and add a "call the customer" cue at the counter. Shipping an unmet
   promise is the most damaging Dangerous item.

2. **Stock is never decremented by sales → all stock figures overstate reality. (R1)**
   At minimum, add an honesty signal everywhere stock is shown ("intake-only · last counted N
   days ago"). This is a closure-quality bar, not a new feature.

3. **Depletion / purchasing recommendations are built on that false stock number. (R2, `04`)**
   Demote them off the daily decision surface or gate behind a recent stock count. Confident
   wrong buying advice loses money and trust.

4. **Halal certificate "all green" can mean "nothing entered." (R6)**
   Add a "supplier has no certificate on file" finding distinct from "expiring." This is the
   shop's #1 differentiator and a legal exposure.

## B. Should fix soon

5. **Two stock-correction doors. (D1, `02`#8)** Make stock-count the sole correction; keep
   inventory adjust as a labelled owner exception only.
6. **Temperature captured in two rituals → legal record can silently stay empty. (D2)**
   Finish the V11.3b single-source dedup.
7. **Non-idempotent waste/adjust + public cancel retry. (R3)** Add idempotency; return existing
   cancellation state on repeat instead of an error.
8. **Counter "Due in 15 min" label inaccurate** for windows >15 min (strategy audit §3.3).
9. **SMS-failure visibility** — surface "customers aren't being texted" to the owner, not just
   in `sms_log` (R7/`06`).
10. **Two help surfaces** (`/admin/guide` + `/admin/playbooks`). Merge (D3).

## C. Can defer

11. **Business Insights analytics** (loyalty, basket pairings, product performance) — thin/empty
    and mostly non-actionable until data exists (R12/R13, `04`). Defer, don't expand.
12. **Customer repeat/loyalty** — needs a real customer entity *and* a retention action (working
    SMS) before it's worth screen space (`02`#14, `06`).
13. **`/admin/today/walk`** — fold into Today day-shape eventually (D10).
14. **Sales-linked inventory decrement** — the "real" fix for R1/R2, but a genuine V14 project
    (must ship with cancellation reversal, R10).
15. **Pickup-window last-slot capacity race** — verify; low priority at this volume (R4).

## D. Should remove / simplify

16. **Releases ledger off the owner navigation** (Decorative for a butcher; keep tables) (`01`,`04`).
17. **Basket-pairing panel** — remove until it drives a bundle/upsell (`06`).
18. **Carcass *price output* labelled as authoritative** — relabel as "starting estimate" until
    butcher sign-off (R8).
19. **Setup checklist** — keep for launch, drop from daily nav post-go-live (`01`).
20. **Dead route branches** (`/admin?mode=counter`) — retire the fall-through (D10).

## E. Strong existing foundations (protect — do not touch)

21. **Checkout** — idempotent, server-priced, capacity/cutoff/closure enforced. (`02`#3)
22. **Counter fulfilment + order state machine** — `FOR UPDATE`, strict transitions, can't lose
    an order. (`02`#4, R4)
23. **Sealed append-only audit** (`audit_logs`/`audit_events`, V11.2). (R14)
24. **Branch isolation / RLS** — single source of branch truth, tested. (R5)
25. **Honest-by-design philosophy** — "margin unavailable" over guessing; evidence-gated
    recommendations; honest SMS status recording. (V9/V8 docs)
26. **Atomic carcass intake** — all-cuts-or-none, idempotent, audited. (`02`#6)
27. **V11.3 consolidation** — "one door per job" already done for the big overlaps.

## F. Unknowns requiring manual / owner validation

28. **Missing V12 / V13.1 / pricing-signoff artefacts** — referenced by the brief, absent in
    repo. Owner must confirm whether these exist elsewhere or were never produced.
29. **Carcass yield numbers** (`cut-sheets.ts`) — no butcher has signed them off (R8). Owner
    action.
30. **Is the homepage/header now real data** (not the hardcoded demo flagged 2026-06)? Verify
    on the live deployment (`01` `/`).
31. **Launch-safety env items** (temp owner login, `*.test` accounts, Supabase Site-URL) — these
    are deployment/config, invisible to a static code audit (STRATEGY §3.6). Owner must verify.
32. **Real-shop dry run** — has place→prep→ready→collect→cancel been run on the actual tablet?
    (STRATEGY P0). Owner action.
33. **Does SMS need to work for V1 at all?** — owner decision (R7); changes whether #1 is "wire"
    or "de-promise."

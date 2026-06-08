# 09 — V13 Recommendations (Ranked)

_V13 Operational Reality Audit · 2026-06-08 · audit-only._

Ranked by **(commercial+risk impact) ÷ difficulty**. Each carries: problem, evidence,
proposed action, expected benefit, risk if ignored, difficulty, and version target.

Difficulty: **S** (hours) · **M** (a day or two) · **L** (a real project).
Targets: **V13.2** (next slice) · **V13.3** (polish/hardening) · **V14** (next major) · **Defer**.

---

### REC-1 — Tell the truth about SMS
- **Problem:** `buildReadySmsOutcome` is a stub; live mode hard-fails; default OFF. No customer is ever texted, but customer copy promises a text.
- **Evidence:** `src/lib/server/sms.ts:38-75`; R7; `02`#16.
- **Proposed action:** Owner decision → **either** wire Twilio and test in dry-run then live, **or** remove "we'll text you when ready" from customer-facing copy and add a counter cue "SMS off — call the customer." Add an owner-facing alert when `sms_log` shows failures/disabled on ready orders.
- **Expected benefit:** No broken promise → fewer no-shows, preserved trust (the brand).
- **Risk if ignored:** Customers wait for texts that never come; trust erodes silently.
- **Difficulty:** S (de-promise + banner) / M (wire+test).
- **Target:** **V13.2.**

### REC-2 — Stamp stock figures with honesty ("intake-only · last counted N days ago")
- **Problem:** `remaining_weight_kg` never decremented by sales → all stock surfaces overstate.
- **Evidence:** `transition_order_status` (202605300002) touches no inventory; R1; `06`#1.
- **Proposed action:** Surface "last stock count: N days ago" and an "intake-only estimate" tag wherever stock is shown (Today, inventory, shop badges). Add a Today nudge when N is large.
- **Expected benefit:** Owner stops over-trusting stock; nudged to count; cheap honesty.
- **Risk if ignored:** Confident wrong stock → bad ordering, customer disappointment.
- **Difficulty:** S–M.
- **Target:** **V13.2.**

### REC-3 — Demote/gate the depletion & purchasing recommendations
- **Problem:** Buy advice divides sales velocity by undepleted stock → structurally wrong "confident" recommendations.
- **Evidence:** `operations-intelligence.ts:187`; `purchasing-intelligence.ts`; R2; `04`.
- **Proposed action:** Remove auto "order more/less" from the daily surface; replace with honest "what sold vs what you wasted — you decide," **or** gate recommendations behind a recent stock count.
- **Expected benefit:** Removes the most dangerous money-losing confidence.
- **Risk if ignored:** Owner over/under-orders on false data; distrusts app once burned.
- **Difficulty:** S (demote) / M (reframe).
- **Target:** **V13.2.**

### REC-4 — "Supplier has no certificate on file" nag
- **Problem:** Expiry alerts only fire for dated certs; absence is invisible → "all green" lies.
- **Evidence:** R6; suppliers/`supplier_documents`; `/our-halal-promise`.
- **Proposed action:** Add a finding (Today + compliance) for suppliers with no current cert recorded, distinct from "expiring."
- **Expected benefit:** Protects the #1 differentiator and a legal exposure.
- **Risk if ignored:** Trading/selling under a lapsed or absent halal cert.
- **Difficulty:** S.
- **Target:** **V13.2.**

### REC-5 — One stock-correction door
- **Problem:** Per-batch "Correct stock" duplicates stock-count; two audit narratives for one truth.
- **Evidence:** D1; R11; V11.3 left adjust as exception.
- **Proposed action:** Route all corrections through `/admin/stock-count`; keep inventory adjust only as a clearly-labelled owner emergency exception (or remove).
- **Expected benefit:** One mental model; cleaner reconciliation/audit.
- **Risk if ignored:** Confusing double workflow; staff use wrong page.
- **Difficulty:** S.
- **Target:** **V13.2 / V13.3.**

### REC-6 — Single temperature source (finish V11.3b)
- **Problem:** Temps captured in opening/closing checklist *and* compliance log; legal `compliance_readings` can stay empty.
- **Evidence:** D2; `v11-3-consolidation-audit.md:104-107`.
- **Proposed action:** Opening/closing temperature step writes the official `compliance_readings`; compliance page reads the same record.
- **Expected benefit:** One legal temperature truth; no double entry.
- **Risk if ignored:** Food-safety inspection finds gaps despite diligent staff.
- **Difficulty:** M (touches data capture — handle carefully).
- **Target:** **V13.3.**

### REC-7 — Idempotency on waste/adjust + graceful repeat-cancel
- **Problem:** Double-tap can double-record waste/correction; public cancel retry errors though already cancelled.
- **Evidence:** R3; `admin_record_inventory_waste`, `admin_adjust_inventory_remaining`, `cancel_public_order`.
- **Proposed action:** Add idempotency keys to waste/adjust RPCs; return existing cancellation state on repeat `cancel_public_order`.
- **Expected benefit:** No phantom waste/loss; less confusing customer cancel.
- **Risk if ignored:** Inflated waste dents reported margin; support calls.
- **Difficulty:** S–M.
- **Target:** **V13.3.**

### REC-8 — Fix the "Due in 15 min" counter label
- **Problem:** Any window within the hour shows "Due in 15 min."
- **Evidence:** STRATEGY §3.3; `02`#4.
- **Proposed action:** Show real remaining time.
- **Benefit:** Staff trust the board.
- **Difficulty:** S. **Target:** **V13.3.**

### REC-9 — Merge the two help surfaces
- **Problem:** `/admin/guide` and `/admin/playbooks` overlap.
- **Evidence:** D3; `01`.
- **Proposed action:** Fold quick cards into playbooks; move dry-run to setup.
- **Benefit:** One help home; less drift. **Difficulty:** S. **Target:** **V13.3.**

### REC-10 — Move releases ledger off the owner nav; relabel carcass price as "estimate"
- **Problem:** Releases is dev tooling on the owner's surface (Decorative); carcass prices look authoritative but are unsigned-off.
- **Evidence:** `01`,`04`; R8.
- **Proposed action:** Hide releases from owner nav (keep tables); label recommended cut prices "starting estimate — confirm at the block."
- **Benefit:** Less noise; no false pricing authority.
- **Difficulty:** S. **Target:** **V13.3.**

### REC-11 — Defer Business Insights expansion; collapse to 3 weekly truths
- **Problem:** Nine analyst-grade panels, thin/empty, mostly non-actionable.
- **Evidence:** R12/R13; `04`; STRATEGY §3.2.
- **Proposed action:** Keep cert-due + waste-by-product; collapse the rest into a weekly digest (top seller / biggest waste / one change). Remove basket-pairing until it drives a bundle.
- **Benefit:** Owner actually reads it; less "feels broken/empty."
- **Risk if ignored:** Dashboard avoidance → whole intelligence layer dormant.
- **Difficulty:** M. **Target:** **V13.3.**

### REC-12 — Butcher sign-off on yields (process, not code)
- **Problem:** `cut-sheets.ts` yields unverified → systematic mis-pricing risk.
- **Evidence:** R8; STRATEGY §3.4.
- **Proposed action:** Owner gets a real butcher to validate yields + 3–4 sample prices; record the sign-off date in-app.
- **Benefit:** Pricing engine becomes trustworthy, not just honest.
- **Risk if ignored:** Confident wrong prices erode margin.
- **Difficulty:** S (code) + owner effort. **Target:** **V13.2 (owner action).**

### REC-13 — Sales-linked inventory decrement (the real R1 fix)
- **Problem:** Only a true decrement makes stock/depletion/purchasing real.
- **Evidence:** R1/R2/R10.
- **Proposed action:** On `collected`, write a `SALE` movement and decrement the batch (FEFO); cancellation/refund must reverse it; ship both together.
- **Expected benefit:** Real-time stock, trustworthy forecasts, honest "expiring today."
- **Risk if ignored:** Stock truth depends forever on manual counts.
- **Difficulty:** **L** (correctness-critical; needs careful design + tests).
- **Target:** **V14.** (Do **not** rush into V13.)

### REC-14 — Real customer entity + retention action
- **Problem:** Loyalty built on fragile name/phone matching with no action.
- **Evidence:** R13; `02`#14; `06`.
- **Proposed action:** Introduce a customer table keyed on normalised phone; attach one concrete action (e.g., "text X lapsed regulars") — depends on working SMS (REC-1).
- **Benefit:** Retention becomes a lever, not a panel.
- **Difficulty:** **L.** **Target:** **V14 / Defer.**

---

## Priority shortlist

| Rank | Rec | Target | Difficulty |
|------|-----|--------|------------|
| 1 | REC-1 SMS truth | V13.2 | S/M |
| 2 | REC-2 stock honesty stamp | V13.2 | S/M |
| 3 | REC-3 demote depletion/purchasing | V13.2 | S/M |
| 4 | REC-4 no-cert nag | V13.2 | S |
| 5 | REC-12 yield sign-off | V13.2 (owner) | S+effort |
| 6 | REC-5 one correction door | V13.2/3 | S |
| 7 | REC-7 idempotency | V13.3 | S/M |
| 8 | REC-6 single temp source | V13.3 | M |
| 9 | REC-8 due label | V13.3 | S |
| 10 | REC-9 merge help | V13.3 | S |
| 11 | REC-10 releases off nav / price label | V13.3 | S |
| 12 | REC-11 collapse analytics | V13.3 | M |
| 13 | REC-13 sales decrement | V14 | L |
| 14 | REC-14 customer entity | V14/Defer | L |

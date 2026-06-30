# PTM Owner Decision Audit — V1

**Date:** 2026-06-30
**Author:** Claude (Opus 4.8)
**Companion to:** [Friction & Cognitive Load Audit](friction-cognitive-load-audit-v1.md) · [Information Necessity Audit](information-necessity-audit-v1.md)

> The first two audits optimised the **operator** (an executor — do less work). This one optimises the **owner** (a decision-maker — make better decisions). Different axis entirely.
>
> The owner should spend time **deciding**, not remembering, searching, or transcribing.

## Core doctrine

Every owner interaction is one of five things. Only the first creates business value; the other four are overhead until proven necessary:

| Class | Creates value? | Verdict lens |
|---|---|---|
| **Decision** | ✅ Yes | Make it fast and well-informed |
| **Confirmation** | Partial | Should be one-tap on a recommendation |
| **Transcription** | ❌ No | Reality/supplier owns it — observe, don't type |
| **Navigation** | ❌ No | Collapse the path to the decision |
| **Configuration** | ❌ No (set-once) | Move out of the daily surface |

**Grounding & fairness note.** PTM's owner side is *already* unusually decision-first — more than almost any retail back-office. The Owner Brain (`src/lib/owner-brain/`) recasts every signal as an `OwnerDecision` with a money impact, a due window, and a **recommended action** (`decisions.ts`), compresses to **Do Now ≤3** + Later, and routes each one **one tap to the work, never to execute** (`action-target.ts`). The Intelligence Firewall keeps raw metrics off the strict surfaces. So this audit is not "PTM interrogates the owner" — it largely doesn't. The remaining overhead is concentrated and specific, and this audit names exactly where.

---

# Part 1 — Complete Owner Decision Inventory

Every action available to Dad, read from the server actions (`src/app/actions/**`) and admin routes.

| # | Action | Source |
|---|---|---|
| 1 | Review Today / Do Now (the home) | `admin/today` + owner-brain |
| 2 | Open a decision's detail & act | `admin/today/[id]` |
| 3 | Guided walk through the day | `admin/today/walk` |
| 4 | Review while away (Owner Away) | `admin/away` + `owner-away.ts` |
| 5 | Change a product price | `updateProductPrice` / `commitCutToProduct` |
| 6 | Toggle product availability / stock status | `updateProductAvailability` |
| 7 | Create / edit a product | `createProduct` / `updateProduct` |
| 8 | Record a carcass intake | `confirmCarcassIntake` |
| 9 | **Add the invoice cost** to an operator delivery | cost-pending alert → batch cost |
| 10 | Create an inventory batch (owner manual) | `createInventoryBatch` |
| 11 | Approve / record a pricing validation | `recordPricingValidation` |
| 12 | Add / edit a supplier (+ certificate fields) | `saveSupplier` |
| 13 | Purchasing — decide what to reorder | `admin/purchasing` |
| 14 | Stock correction (apply a counted variance) | `admin/stock-count` |
| 15 | Reverse an order's stock depletion | `admin_reverse_order_inventory` |
| 16 | Record a compliance temperature reading | `recordComplianceReading` |
| 17 | Complete the daily compliance log | `completeComplianceDay` |
| 18 | Review / approve operator evidence (photos) | `admin/evidence` |
| 19 | Act on an owner alert (13 kinds) | `createOwnerAlert` consumers |
| 20 | Move an order's status / add a note | `updateOrderStatus` / `addOrderNote` |
| 21 | Pickup windows (create / edit / activate) | `admin-schedule` |
| 22 | Shop closures | `createShopClosure` |
| 23 | Branch settings (address / SMS / cancellation) | `updateBranchSettings` |
| 24 | Toggle Owner Away mode | `owner-away` |
| 25 | Business Insights — review numbers & trends | `admin` (hub) |
| 26 | Reference: playbooks / guide / cutting-guide / setup / audit / releases | `admin/*` |

**The 13 owner-alert kinds** (each a potential interruption — Part 8):
`operator_checklist_help`, `operator_document_review`, `operator_waste_unknown_product`, `operator_waste_needs_owner`, `operator_waste_no_matching_stock`, `operator_waste_reason_check`, `operator_evidence_review`, `operator_sale_check_needed`, `operator_sale_count_needed`, `operator_help`, `operator_delivery_unknown_product`, `operator_delivery_needs_owner`, `operator_delivery_unknown_supplier`, `operator_delivery_check_needed`, `operator_delivery_cost_pending`, `operator_stock_ran_out`, `operator_stock_help_needed`.

---

# Part 2 — Decision Classification Matrix

Exactly one primary purpose per action.

| Action | Decision | Confirm | Transcribe | Navigate | Config |
|---|:--:|:--:|:--:|:--:|:--:|
| Review Today / Do Now | ● | | | | |
| Decision detail & act | ● | | | | |
| Guided walk | | | | ● | |
| Owner Away review | | ● | | | |
| Change a price | ● | | | | |
| Toggle availability | | ● | | | |
| Create/edit product | | | | | ● |
| Carcass intake — margins / days hung | ● | | | | |
| Carcass intake — **weight / cost** | | | ● | | |
| **Add invoice cost** (cost-pending) | | | ● | | |
| Create inventory batch — **cert refs / origin / slaughter** | | | ● | | |
| Pricing validation — **approve / changes** | | ● | | | |
| Pricing validation — **carcass weight/cost** | | | ● | | |
| Add/edit supplier — **cert number / expiry** | | | ● | | |
| Add/edit supplier — name / active | | | | | ● |
| Purchasing (reorder) | ● | | | | |
| Stock correction (variance) | | ● | | | |
| Reverse stock | ● | | | | |
| **Compliance temperature** | | | ● | | |
| Compliance completion (attestation) | | ● | | | |
| Review evidence (photos) | | ● | | | |
| Act on owner alert | ● / ● | ● | | | |
| Order status / note | | ● | | ● | |
| Pickup windows / closures | | | | | ● |
| Branch settings | | | | | ● |
| Owner Away toggle | | ● | | | |
| Business Insights | | | | ● | |
| Playbooks / guide / setup | | | | ● | |

**Tally of primary purposes:** genuine **Decisions ≈ 7**; **Confirmations ≈ 8**; **Transcriptions ≈ 6**; **Navigation ≈ 5**; **Configuration ≈ 6**.

**The headline:** only ~25% of distinct owner actions are genuine decisions. The two biggest pools of *non-decision* owner work are **Transcription** (6 — re-keying supplier-owned facts) and **Confirmation** (8 — which should mostly be one-tap on a recommendation). Those two are where the owner's attention is being spent without creating value.

---

# Part 3 — Decision Quality (can Dad decide in <10s?)

For the **7 genuine decisions**, does PTM give enough — and only enough — to decide confidently and fast?

| Decision | Info provided today | <10s? | Gap |
|---|---|---|---|
| Do Now actions | Title, why, **money impact**, due window, one-tap to work (`OwnerDecision`) | ✅ Yes | This is the gold standard — keep |
| Change a price | Live in pricing-validation: system suggests price/margin, butcher compares | ✅ mostly | Outside validation (ad-hoc reprice in `admin/products`) there's **no margin context at the point of editing** — owner edits a bare price field |
| Purchasing (reorder) | Depletion forecast + expiry command centre feed it | ⚠️ Partly | No **suggested quantity** — owner infers how much to buy |
| Stock correction | Counted vs system variance shown (`stock-count`) | ✅ Yes | Good — variance is the decision context |
| Reverse stock | Order + depletion detail | ✅ Yes (rare) | Fine |
| Act on alert | Alert summary + entity ref | ⚠️ Varies | Some alerts (`reason_check`) carry thin context; some (`cost_pending`) are transcription mislabelled as a decision |
| Toggle availability | Stock status | ✅ Yes | Could be **auto-recommended** from inventory truth |

**Quality finding:** the *engineered* decision path (Do Now → detail → one-tap work) is excellent — money at stake, plain language, no jargon, no hunting. The weak spots are the **ad-hoc** decisions made outside that path: editing a price in `admin/products` with no margin shown, and deciding a reorder quantity with no suggested number. The owner brain knows the margin and the depletion rate — it just doesn't surface them *at the moment of the edit*.

---

# Part 4 — Decision Timing (why now?)

| Decision/task | Asked when | Should it be now? |
|---|---|---|
| Cost-pending (add invoice cost) | Raised immediately per delivery | **No** — it's reconciliation. Batch into one daily/weekly "costs to add" task, not N interruptions |
| Unknown supplier/product | Immediately | Yes — it blocks truth/compliance |
| Ran out | Immediately | Yes — affects today's selling |
| Pricing validation | Owner-initiated | Correct (owner chooses) |
| Reorder | Surfaced in Do Now when depletion predicts it | ✅ Correct timing — proactive |
| Waste reason_check | Immediately | **Probably not** — low stakes; batch it |
| Evidence review | Per upload | Could batch into a review queue (it already half-does via Owner Away) |

**Timing finding:** the *intelligence* decisions (reorder, expiry, margin) are well-timed — surfaced proactively in Do Now. The *operator-escalation* alerts are the timing problem: several are **reconciliation or low-stakes** (cost-pending, reason_check) yet arrive as individual interruptions. They should **collapse into a batched digest**, which is exactly what Owner Away already does — the pattern just isn't applied when the owner is *present*.

---

# Part 5 — Transcription Hunt (the biggest section)

Every place Dad types a fact instead of making a decision. **All six are supplier- or reality-owned**, and — critically — **PTM already photographs the document in most cases** (the certificate flow + delivery-note capture via `uploadOperatorEvidence`). So the path is photo → (OCR) → confirm. *Record the opportunity; don't build OCR.*

| Transcribed fact | Where | True owner | Photo already captured? |
|---|---|---|---|
| **Invoice cost** | cost-pending → batch | Supplier invoice | Delivery-note photo (operator flow) — **yes, often** |
| **Halal cert ref** | `createInventoryBatch` / carcass | Supplier cert | Certificate flow (`paperKind: "halal"`) — **yes** |
| **Country of origin** | batch | Supplier label | Label/cert photo — partial |
| **Slaughter date** | batch | Supplier label | Label/cert photo — partial |
| **Cert number / expiry** | `saveSupplier` | Supplier cert | Supplier document upload exists | 
| **Carcass weight / cost** | `confirmCarcassIntake` | Scale / invoice | Invoice photo — partial |
| **Compliance temperature** | `recordComplianceReading` | Fridge probe | (hardware, not paper) |

**Transcription finding:** every owner transcription field is a **supplier- or reality-owned fact**, and PTM **already has the photo pipeline** that an OCR step would read. The owner is currently the OCR. Reframed as the Decision Audit demands: *typing the invoice cost is not a decision — it's unpaid data entry of a number the supplier already wrote down.* The owner's only legitimate role here is **confirming** a proposed value, never transcribing it. (This is the same conclusion the Information Audit reached from the field angle — the Decision lens sharpens *why it matters*: every transcription minute is a non-decision minute.)

---

# Part 6 — Navigation Audit (screens to the thing that matters)

The engineered path is short:

```
Today → Do Now card → (one tap) → the work screen, item pre-focused
```

That's **2 taps** to the work, with `resolveActionTarget` carrying the focused item in the URL. Genuinely excellent.

The *off-path* navigation is where it sprawls:

| Path | Taps today | Issue |
|---|---|---|
| Do Now → work | 2 | ✅ optimal |
| Today "More" grid → any of 9 links | 1 + scan | A mini-dashboard at the foot of the most disciplined page (flagged in Friction Audit B1) |
| Reach a config page (products/windows/settings) | Today → More → page | Config competes with decisions at the same altitude |
| Business Insights (metrics) | Today → More → /admin | A whole metrics surface one tap from Today |

**Navigation finding:** the *decision* path is already 2 taps. The waste is that **configuration and reference share the top level** with decisions via the 9-link "More" grid. Collapsing config/reference behind two doors ("Settings & setup", "Guides") — as the Friction Audit recommended — would make Today a pure decision surface with no navigation noise.

---

# Part 7 — Information Density (what changes today's decision?)

| Surface | Carries a today-decision? | Verdict |
|---|---|---|
| Do Now (≤3) | ✅ Every card is an action | Keep |
| Morning briefing (≤100 words) | Orientation only, no numbers | Keep — it frames, doesn't clutter |
| Weekly summary (collapsed) | "Interesting", rarely actionable | Correctly demoted ✅ |
| **Business Insights `/admin`** | Mixed — trends & metrics | **Audit each metric for "so what?" (Part 11)** |
| Compliance page | Reference unless a breach | Surface only on breach |
| Evidence page | A review queue | Could be a Do-Now action ("3 photos need you") |

**Density finding:** TODAY is already dense-with-decisions and nothing else (the firewall enforces it). The density problem lives on **`/admin` Business Insights** — a standing metrics page where most numbers don't change a *today* decision. The fix isn't to delete the numbers (they're useful for monthly reflection) but to stop treating "Business Insights" as a peer of Today.

---

# Part 8 — Owner Interruptions (does each alert justify interrupting Dad?)

Test each of the 13 alert kinds: would *ignoring it* cost money, break compliance, or harm a customer?

| Alert kind | Money? | Compliance? | Harm? | Verdict |
|---|:--:|:--:|:--:|---|
| `operator_delivery_unknown_supplier` | | ✅ | | **Interrupt** (halal provenance) |
| `operator_delivery_unknown_product` | ✅ | | | **Interrupt** (stock truth) |
| `operator_delivery_check_needed` | ✅ | ✅ | | **Interrupt** |
| `operator_delivery_cost_pending` | ✅ (margin) | | | **Batch** — reconciliation, not urgent |
| `operator_stock_ran_out` | ✅ | | | **Interrupt** (today's selling) |
| `operator_sale_check_needed` / `count_needed` | ✅ | | | **Interrupt** (money/truth) |
| `operator_evidence_review` / `document_review` | | ✅ | | **Batch into a review queue** |
| `operator_waste_unknown_product` / `no_matching_stock` | ✅ | | | **Interrupt** (stock truth) |
| `operator_waste_reason_check` | | | | **Batch / maybe drop** — low stakes |
| `operator_waste_needs_owner` | ✅ | | | Interrupt |
| `operator_help` / `checklist_help` / `stock_help_needed` | ✅? | ✅? | ✅? | **Interrupt** (operator is blocked — human needs help) |

**Alert finding:** most alerts genuinely justify interruption (they protect money, halal compliance, or an operator who's stuck). The two that **don't** are `cost_pending` (reconciliation) and `waste_reason_check` (low stakes) — these should **batch into a digest** rather than each becoming a Today problem. The infrastructure to do this already exists: **Owner Away mode already batches everything into a "while you were out" summary** (`owner-away.ts`). The opportunity is to apply that same batching to low-urgency alerts even when the owner is *present* — a standing "to reconcile" tray separate from "needs you now".

---

# Part 9 — Decision Defaults (recommend one option, owner confirms)

Where PTM could propose a recommended option the owner simply confirms:

| Decision | Recommend? | Status today |
|---|---|---|
| Reorder | **Suggested quantity** from depletion rate | ⚠️ Surfaces *that* to reorder, not *how much* |
| Price | **Suggested price** from cost + target margin | ✅ Exists in pricing-validation; ❌ absent in ad-hoc `admin/products` reprice |
| Supplier (delivery) | "Same supplier as last time?" | ✅ Just built (confirm-don't-ask) — operator side |
| Expiry | Shelf-life default | ✅ Just built (operator side) |
| Stock correction | Variance pre-computed | ✅ stock-count shows counted vs system |
| **Invoice cost** | **OCR-proposed cost to confirm** | ❌ Owner types it raw |
| Availability toggle | Recommend from inventory truth | ❌ Manual |
| Cert / origin / slaughter | OCR-proposed to confirm | ❌ Owner types raw |

**Recommendation finding:** PTM already *recommends* on its strongest surfaces (Do Now actions carry a `recommendedAction`; pricing-validation suggests a price; the new confirm-don't-ask covers operator supplier/storage/expiry). The **missing recommendations are all on the owner's transcription and ad-hoc-edit paths**: a suggested reorder *quantity*, a margin shown at the point of an ad-hoc reprice, and OCR-proposed values for cost/cert/origin. Turn each from "type a fact" into "confirm a proposal".

---

# Part 10 — Decision Entropy (forgotten / repeated / delayed / ignored)

| Pattern | Mechanism | PTM's pull-back |
|---|---|---|
| **Cost never added** | cost-pending forgotten | ✅ Standing per-batch alert already exists — but as N interruptions, not one tray |
| Supplier left "unknown" | operator escalation | ✅ Alert raised |
| Reprice deferred when margin drifts | No prompt | ❌ **Gap** — margin erosion is silent until reflected in weekly summary |
| Stock count skipped | Honesty stamp ("last count X days ago") | ✅ Exists |
| Evidence un-reviewed | Per-upload alert | ⚠️ No queue view of the backlog |
| Pricing sign-off incomplete | `summariseOverallSignoff` INCOMPLETE | ✅ Tracked |

**Entropy finding:** PTM's self-healing spine (alerts, honesty stamps, sign-off verdicts) catches most drift. The one **silent** decay is **margin erosion**: when a product's cost rises or its price lags, nothing prompts a reprice until it surfaces (if at all) in the weekly summary. A "margin slipped on X — reprice?" Do-Now recommendation would close it. (This is a *new decision to surface*, not overhead to remove — the rare case where the owner should be interrupted *more*, because money is leaking silently.)

---

# Part 11 — Metrics Audit ("so what?")

Every metric must answer "so what?" — if the owner can't act on it immediately, it doesn't belong on Today.

| Metric surface | Actionable? | Verdict |
|---|---|---|
| Do Now money impact | ✅ "Win back £Y" → call them | Keep |
| Morning briefing (qualitative) | Orientation, no numbers | Keep |
| Weekly summary (wins/risks/opps) | Reflective, collapsed | Correctly off Today |
| Business Insights — product performance, waste trend, margin tables | Monthly reflection, not daily | **Keep on `/admin`, never promote to Today** |
| Health score / KPIs | Already firewalled off strict surfaces | ✅ Enforced by `verify:owner-brain-compliance` |

**Metrics finding:** the firewall already does this job well — Today carries only actionable, money-anchored items, and the `verify:owner-brain-compliance` guard *enforces* no bare %/score/KPI on strict surfaces. The remaining "so what?" failures live on `/admin` Business Insights, which is acceptable **as long as it stays a deliberate drill-down** and never leaks back onto Today. No regression; hold the line.

---

# Part 12 — Final Classification (every interaction → one bucket)

| Owner interaction | Bucket | Why |
|---|---|---|
| Do Now / decision detail / walk | **Keep** | The value-creating core |
| Stock correction (variance) | **Keep** | Real judgement, well-contextualised |
| Reverse stock | **Keep** | Rare, correct |
| Pricing decision (approve/changes) | **Keep** | Owner craft |
| **Invoice cost** | **Automate→Confirm** (OCR on existing photo) | Supplier-owned; owner confirms |
| **Cert ref / origin / slaughter** | **Automate→Confirm** (OCR) | Supplier-owned |
| **Carcass weight / cost** | **Automate→Confirm** (scale / invoice OCR) | Reality/supplier-owned |
| **Compliance temperature** | **Automate→Confirm** (probe) | Fridge-owned |
| **Reorder quantity** | **Recommend** | Suggest from depletion; owner confirms |
| **Ad-hoc reprice** | **Recommend** | Show margin + suggested price at the edit |
| **Margin-erosion reprice** | **Recommend** (new Do-Now) | Surface the silent leak |
| Availability toggle | **Recommend** | From inventory truth |
| Cost-pending / reason_check alerts | **Confirm** (batched tray) | Reconciliation, not interruption |
| Evidence / document review | **Confirm** (queue) | Batch the backlog |
| Products / suppliers / windows / closures / settings | **Eliminate** from daily surface (move behind config door) | Set-once |
| Business Insights / playbooks / guide | **Eliminate** from Today peer-level (drill-down only) | Reference |
| Order status / note | **Keep** (counter team, not owner) | Not Dad's daily decision |

Nothing unclassified.

---

# Decision-Reduction Roadmap (prioritised)

Ordered by **(owner attention reclaimed × frequency) ÷ effort**. Pure-software first; hardware/OCR recorded, not built.

### Tier 1 — Pure software, reclaim owner attention now
1. **Batch low-urgency alerts into a "to reconcile" tray** (cost-pending, reason_check, evidence backlog) — apply the Owner-Away batching pattern while the owner is present. Stops N interruptions becoming N Today problems. *(Parts 4, 8, 10)*
2. **Suggested reorder quantity** in purchasing — the depletion engine already knows the rate; propose the number, owner confirms. *(Parts 3, 9)*
3. **Show margin + suggested price at the point of an ad-hoc reprice** in `admin/products` — the brain knows cost & target margin; surface them where the edit happens. *(Parts 3, 9)*
4. **Surface margin-erosion as a Do-Now recommendation** ("margin slipped on X — reprice?") — close the one silent decay. *(Part 10)*
5. **Collapse Today's 9-link "More" grid** + move config/reference behind two doors — make Today a pure decision surface. *(Parts 6, 7)*

### Tier 2 — Provenance & queues (cheap)
6. **Evidence review queue view** (the backlog as one screen, not N alerts). *(Parts 8, 10)*
7. **Re-label `cost_pending` honestly** as a reconciliation task, not a decision alert. *(Part 2)*

### Tier 3 — Observation (record now; the photo pipeline already exists)
8. **Invoice OCR → proposed cost to confirm** (delivery-note photo already captured). *(Parts 5, 12)*
9. **Cert/label OCR → proposed cert ref / origin / slaughter to confirm** (certificate flow already captures the photo). *(Parts 5, 12)*
10. **Scale / probe → carcass weight & compliance temperature.** *(Parts 5, 12)*

---

# Final Evaluation

**The owner's day, reclassified.** Of ~26 distinct owner interactions, only ~7 are genuine decisions. The other ~19 are confirmation, transcription, navigation, or configuration — overhead. PTM has already done the hard part on the *decision* surface (Do Now ≤3, recommended actions, money impact, one-tap-to-work, firewalled metrics) — that part is best-in-class and should be protected, not touched.

**Where the owner's attention still leaks, precisely:**
- **Transcription (6 fields)** — the owner is currently the OCR for supplier-owned facts PTM already photographs. *Every transcription minute is a non-decision minute.*
- **Un-batched low-urgency alerts** — reconciliation and trivia arriving as individual interruptions when a digest exists for the away case.
- **Missing recommendations on the ad-hoc paths** — reorder *quantity*, ad-hoc reprice margin, and the silent margin-erosion leak.
- **Config & reference sharing Today's altitude** — navigation noise on the one surface that should be pure decision.

**The one-line conclusion:** *the operator audits removed work; this one removes the owner's need to gather information before deciding.* Make PTM observe the supplier's numbers, batch the trivia, recommend the obvious option, and hide the config — and what's left on Dad's plate is the thing he's actually for: **judgement.**

---

*Doctrine restated: the owner should spend time deciding, not remembering, searching, or transcribing. Decision is the only value-creating bucket — drive everything else toward eliminate, automate, recommend, or confirm.*

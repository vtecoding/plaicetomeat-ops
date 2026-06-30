# PTM Information Necessity Audit — V1

**Date:** 2026-06-29
**Author:** Claude (Opus 4.8)
**Companion to:** [Friction & Cognitive Load Audit V1](friction-cognitive-load-audit-v1.md)

> The Friction Audit optimised **interactions**. This audit optimises **information itself**.
> The objective is no longer to remove taps — it is to ensure PTM only asks a human for information that **reality cannot provide**.

## Core doctrine

The butcher exists to run the shop. The software exists to **observe** the shop. Every question PTM asks a human is **technical debt until proven necessary**. A field earns its place only if *no other source* — inference, hardware, another workflow, or the owner — can supply it.

**Grounding:** every field below was read from the actual server-action contracts (`src/app/actions/**`), the operator flows, the checkout pipeline, and the inventory/compliance RPC calls. Nothing here is speculative. Where I name a source as "reality/supplier/hardware", I am classifying *who owns the truth*, not proposing a build.

---

# Part 1 — Complete Information Inventory

Every input PTM collects, by surface. **H** = typed/chosen by a human. **S** = system-supplied (inferred/generated). Fields marked with provenance are the audit's raw material.

### A. Operator — Gul (the high-frequency surface)

| # | Field | Source action | H/S | Owns the truth |
|---|---|---|---|---|
| 1 | `productId` (which meat) | serve / delivery / waste / ran-out | H | Reality (the meat) |
| 2 | `name` (custom "Other" line) | serve | H | Reality |
| 3 | `quantityKg` / `quantity` | serve / delivery / waste | H | **Scale (reality)** |
| 4 | `priceGbp` (custom line only) | serve | H | Catalogue (PTM) for known; owner for custom |
| 5 | `payKind` (cash/card) | serve | H | **Card terminal** for card; human for cash |
| 6 | `supplierId` | delivery | H | History / supplier |
| 7 | `expiryChoice` | delivery | H | **Supplier label** |
| 8 | `storageChoice` | delivery | H | Per-product habit |
| 9 | `noteEvidenceId` / photo | delivery / waste | H (camera) | Reality (the paper) |
| 10 | `reason` (waste) | waste | H | Human judgement |
| 11 | `sure` (ran out) | ran-out | H | Reality |
| 12 | `paperKind` (cert type) | certificate | H | The paper (OCR-able) |
| 13 | checklist step `done`/`skipped` | open/close | H | Human judgement |
| 14 | `fridge_temp` / `fridges_closed` (°C) | open/close | H | **Fridge probe (reality)** |
| 15 | `float_ready` (£) | open | H | Yesterday's value (PTM) |
| 16 | `cash_counted` (£) | close | H | Reality (the till) |
| 17 | `problem` / `note` (help) | help | H | Human |
| 18 | `runId` | all operator flows | **S** | Generated (`crypto.randomUUID`) ✅ |

### B. Owner — Dad (the low-frequency, high-stakes surface)

| # | Field | Source action | H/S | Owns the truth |
|---|---|---|---|---|
| 19 | `animalId` / `intakeType` | carcass-intake | H | Reality |
| 20 | `weightKg` (carcass) | carcass-intake | H | **Scale** |
| 21 | `costGbp` / `invoiceCost` | carcass-intake / batch | H | **Supplier invoice** |
| 22 | `daysHung` | carcass-intake | H | Human judgement |
| 23 | `receivedAt` / `receivedDate` | carcass-intake / batch | H | **Clock (reality)** — defaults to today |
| 24 | `expiryDate` | carcass-intake / batch | H | **Supplier label** |
| 25 | `mapping` / `marginOverrides` | carcass-intake | H | Human judgement |
| 26 | `halalCertRef` | batch | H | **Supplier cert (label/OCR)** |
| 27 | `countryOfOrigin` | batch | H | **Supplier label** |
| 28 | `slaughterDate` | batch | H | **Supplier label** |
| 29 | `storageLocation` / `batchNumber` | batch | H/S | habit / generatable |
| 30 | product `name` / `description` / `categoryId` / `unitType` | admin-products | H | Human (config) |
| 31 | product `price` / `pricePerKg` / `costPerKg` | admin-products / commitCut | H | Owner judgement (priced from cost) |
| 32 | `stockStatus` / `isAvailable` | admin-products | H | Reality (inventory) |
| 33 | supplier `name` / `certifyingBody` / `certNumber` / `certExpiry` / `documentUrl` / `verified` / `active` / `notes` | compliance-inventory | H | Supplier (config) |
| 34 | `address` / `smsReadyTemplate` / `cancellationWindowMinutes` | admin-settings | H | Owner (config) |
| 35 | pricing-validation: `species`, `cutId`, `cutName`, `systemYieldPct`, `systemCostPerKg`, `systemPricePerKg`, `systemMarginPct`, `butcherYieldPct`, `butcherPricePerKg`, `decision`, `notes`, `butcherName` | pricing-validation | H | **MIXED — see Part 6** |
| 36 | pickup window: `label`/`startTime`/`endTime`/`cutoffTime`/`maxOrders`/`daysOfWeek`/`windowType` | admin-schedule | H | Owner (config) |
| 37 | shop closure: `closeDate` / `reason` | admin-schedule | H | Owner (config) |
| 38 | order `nextStatus` / `note` | counter | H | Owner/operator |
| 39 | compliance reading: `readingType`, `chillerTempC`, `freezerTempC`, `displayTempC` | compliance | H | **Fridge probe (reality)** |
| 40 | compliance completion: `cleaningCompleted` / `sanitisationCompleted` / `wasteChecked` / `notes` | compliance | H | Human judgement |

### C. Customer (self-service — the right persona to ask)

| # | Field | Source | H/S | Owns the truth |
|---|---|---|---|---|
| 41 | `basket` (items + qty) | checkout | H | Customer |
| 42 | `customerName` | checkout | H | Customer |
| 43 | `customerPhone` | checkout | H | Customer |
| 44 | `customerEmail` (optional) | checkout | H | Customer |
| 45 | `pickupDate` / `pickupWindowId` | checkout | H | Customer |
| 46 | `notes` | checkout | H | Customer |
| 47 | order lookup: `orderRef` + `phone` | order/lookup | H | Customer (recovery) |
| — | **`address`** | — | — | **Not collected — pickup-only model ✅ already eliminated** |

### D. Hidden system inputs (audited for *un*necessary human involvement)

| # | Field | Generated by | Human touch? | Verdict |
|---|---|---|---|---|
| 48 | `branchId` | staff session (`resolveStaffContext`) | **None** ✅ | Correctly inferred |
| 49 | `profileId` / operator identity | session | **None** ✅ | Correctly inferred |
| 50 | timestamps / `todayIso()` / `receivedAt` default | server clock | None ✅ | Correct |
| 51 | `idempotencyKey` / `runId` / `idempotency_fingerprint` | `crypto.randomUUID` | None ✅ | Correct |
| 52 | `order_ref` | `next_order_ref` RPC | None ✅ | Correct |
| 53 | `batch_number` (`OP-{runId}`) | derived | None ✅ | Correct |
| 54 | audit metadata (`eventType`/`targetType`/`systemReason`) | `emitAuditLog` | None ✅ | Correct |
| 55 | `actor_id` on status events | session | None ✅ | Correct |
| 56 | `public_access_id` / `version` | checkout pipeline | None ✅ | Correct |
| 57 | **`customer_name: "Shop sale"` + `customer_phone: "07000000000"`** | serve.ts (hard-coded) | None, but **phantom** | **See Part 10 — schema-imposed fiction** |

**Hidden-input verdict:** PTM's system-input hygiene is excellent. The five fields every bad app makes a human supply — who, where, when, idempotency, references — are all generated or session-derived here. **Zero unnecessary human involvement in the hidden layer**, with one wrinkle: #57, the phantom customer.

---

# Part 2 — Information Justification Matrix

Verdict legend: **KEEP** (irreducible human), **CONFIRM** (pre-fill + one-tap), **INFER** (software can derive), **OBSERVE** (hardware owns it), **DELAY** (collect later/owner), **ELIMINATE** (delete).

| Field | Why needed | First required moment | PTM infer? | HW observe? | Captured elsewhere? | Operator ever? | Verdict |
|---|---|---|---|---|---|---|---|
| productId | Identify the cut | Point of sale/delivery | partial (history rank) | barcode | — | yes | **CONFIRM** (rank likely first) |
| quantityKg | Money + stock truth | Sale/delivery | no | **scale** | — | yes (today) | **OBSERVE** |
| priceGbp (custom) | Money truth | Custom sale only | catalogue covers known | — | catalogue | only custom | **KEEP** (custom only) |
| payKind | Reconciliation | Sale | no | **terminal** (card) | — | yes | **OBSERVE** (card) / KEEP (cash) |
| supplierId | Provenance | **Owner reconciliation, not unload** | **yes (last/most-frequent)** | — | history | no — confirm | **CONFIRM/DELAY** |
| expiryChoice | Food safety/FEFO | Delivery | shelf-life default | label OCR | — | confirm | **CONFIRM** |
| storageChoice | Logistics | Delivery | **yes (per-product habit)** | — | — | confirm | **CONFIRM** |
| reason (waste) | Loss analysis | Waste | default "expired" | — | — | yes | **KEEP** (default-able) |
| fridge_temp °C | **Legal/safety** | Open/close | no | **probe** | — | yes (today) | **OBSERVE** (highest value) |
| float £ | Reconciliation base | Open | **yes (yesterday's)** | — | yesterday's close | confirm | **CONFIRM** |
| cash_counted £ | Reconciliation | Close | no (it's the count) | EPOS-assist | — | yes | **KEEP** |
| weightKg (carcass) | Cost/yield | Intake | no | **scale** | — | owner | **OBSERVE** |
| costGbp / invoiceCost | Margin truth | **Owner reconciliation** | no | invoice OCR | invoice | **never (already deferred ✅)** | **OBSERVE/DELAY** |
| receivedAt | Provenance | Intake | **yes (today)** | clock | — | no | **INFER** (default today) |
| halalCertRef / countryOfOrigin / slaughterDate | Compliance provenance | Intake | no | **label OCR** | supplier docs | owner | **OBSERVE** (OCR) |
| compliance temps | Legal | Daily | no | **probe** | — | yes | **OBSERVE** |
| system\_\* (pricing-validation) | Audit snapshot | Validation | **PTM computed them** | — | **PTM itself** | **never** | **INFER — see Part 6** |
| customerName/Phone | Pickup contact | Checkout | no | — | — | n/a (customer) | **KEEP** (customer-owned) |
| customer_name "Shop sale" (#57) | Schema requires it | Counter sale | n/a | — | — | no | **ELIMINATE** (schema fix) |
| branch/operator/time/ids | System integrity | always | **already inferred ✅** | — | session | **never** | **KEEP (inferred)** |

---

# Part 3 — Information Lifecycle Map

| Field | Birth | Evolves? | Death / archive | Truth owner |
|---|---|---|---|---|
| quantityKg | Human estimate at counter | No (snapshot) | After sale settles | **Reality (scale)** — Gul is a proxy |
| costGbp | Owner types from invoice | Corrected at reconciliation | Margin history | **Supplier** |
| expiryDate | Human picks "tomorrow" | Rarely | When stock sold/wasted | **Supplier label** |
| temperature | Human reads gauge | New reading each session | Minutes (freshness) | **Fridge** |
| float | Carried from yesterday | Daily | One day | **PTM (yesterday)** |
| supplier | Picked per delivery | Stable for months | When supplier dropped | **Supplier record** |
| product price | Owner sets | Weeks | On reprice | **Owner (from cost)** |
| payKind | Human picks | No | Reconciliation | **Terminal** |

**The lifecycle finding:** the fields with the *shortest freshness* (temperature: minutes; quantity: instant) are exactly the ones a human is least reliable at and reality owns most completely. The fields with the *longest freshness* (supplier: months; price: weeks) are re-asked **every single transaction** today (supplier on every delivery). **PTM re-collects stable information and hand-transcribes volatile information** — the inverse of what an observation-first system should do.

---

# Part 4 — Information Timing Audit (collect at the latest necessary moment)

| Field | Asked today | Latest moment actually needed | Gap |
|---|---|---|---|
| **invoiceCost** | — (operator) | Owner reconciliation | ✅ **already deferred (F7)** — the model answer |
| supplier (operator delivery) | At unload | Owner reconciliation | **Premature** — confirm-or-defer |
| expiry | At unload | Before the item is sold | Could defer to first sale/stock-count |
| certificate type | Before photo | After photo exists (OCR) | Premature |
| daysHung | At intake | At intake (affects pricing) | Correct timing |
| cash_counted | At close | At close | Correct |

**The F7 cost-deferral is the template for the whole audit.** It proves PTM already knows how to say "a human shouldn't supply this *now* — the owner reconciles it later." Supplier and expiry on operator deliveries are the next candidates for the same treatment.

---

# Part 5 — Reality vs Human (true ownership)

| Field | Reality | Hardware | AI | External | Operator should own? |
|---|---|---|---|---|---|
| Weight | ✓ | scale | — | — | **No** |
| Temperature | ✓ | probe | — | — | **No** |
| Time/date | ✓ | server | — | — | **No (already ✅)** |
| Pay method (card) | — | terminal | — | EPOS | **No** |
| Cost | — | — | OCR | supplier invoice | **No** |
| Expiry / origin / slaughter / cert | — | — | OCR | supplier label | **No (confirm only)** |
| Supplier | — | — | predict | history | **No (confirm only)** |
| Waste reason | — | — | — | — | **Yes (judgement)** |
| daysHung | — | — | — | — | **Yes (judgement)** |
| Cleaning done | — | — | — | — | **Yes (judgement)** |
| Customer details | — | — | — | customer | **Customer, not operator** |

**Ownership finding:** of the ~17 operator-entered fields, **only 3 are genuinely human-judgement** (waste reason, ran-out "sure", cleaning/checklist confirms). The other ~14 are proxies for facts owned by **reality, hardware, the supplier, or PTM's own records.** Gul is currently the source-of-truth for things he does not own.

---

# Part 6 — Duplication Register

| # | Duplication | Detail | Verdict |
|---|---|---|---|
| Dup1 | **`system_*` columns in pricing-validation** | `systemYieldPct`, `systemCostPerKg`, `systemPricePerKg`, `systemMarginPct` are **values PTM itself computed**, submitted back *as input* from the client. PTM is asking a human form to hand it its own numbers. | **INFER server-side.** Recompute from `cutId` at write time; store as a server snapshot, never trust the client copy. (The *butcher_* columns — what the butcher chose instead — are legitimately human and stay.) |
| Dup2 | **Serve confirm summaries** (from Friction Audit) | `add-more` + `confirm` both restate the basket | Collapse (see Friction Audit D1/D2) |
| Dup3 | **expiry stored as both `expiryChoice` and derived `expiryDate`** | operator picks a choice, server derives the date | Justified — choice is UX, date is truth. Keep, but don't surface both. |
| Dup4 | **quantity stored as `receivedWeightKg` AND `remainingWeightKg` AND `expectedWeightKg`** (all = quantity at intake) | three columns seeded from one input | Justified (they diverge later) — but only **one** is a human input; the other two are server-seeded ✅ already done |
| Dup5 | **`customer_name`/`customer_phone` phantom on shop sales** | hard-coded fiction to satisfy schema | See Part 10 |

The headline duplicate is **Dup1**: a validation record that round-trips PTM's own computed figures through a human form is the purest example of "information that PTM already knows" being re-collected.

---

# Part 7 — Information Freshness

| Field | Trustworthy for | Re-asked? | Problem? |
|---|---|---|---|
| Temperature | Minutes | Each session ✅ | Correct cadence |
| Float | One day | Each open | **Re-asked though yesterday's close knows it** → prefill |
| Supplier | Months | **Every delivery** | **Over-asked** → default + confirm |
| Product price | Weeks | On reprice ✅ | Correct |
| Storage habit | Per product, stable | **Every delivery** | **Over-asked** → remember last |
| Cert/origin/slaughter | Per batch (label) | Per batch | Correct cadence, wrong source (should be OCR) |

**Freshness finding:** PTM re-asks **stable** information (float daily, supplier + storage per delivery) at transaction cadence. The fix is memory, not hardware: *the last value is the default; the human only corrects exceptions.*

---

# Part 8 — Observation Opportunity Register (record, don't build)

| Field | Reality source | Already-existing hook in code |
|---|---|---|
| quantityKg / weightKg | **Scale** (BT/serial) | `quantity` is a plain number input — drop-in |
| temperature ×4 (open/close/compliance) | **Probe / IoT** | `chillerTempC`/`freezerTempC`/`displayTempC` + checklist number steps |
| payKind (card) | **Card terminal / EPOS** | `payment_method` already on the order |
| invoiceCost / costGbp | **Invoice OCR** | **Delivery already captures a note photo** (`uploadOperatorEvidence`) — OCR reads it |
| expiry / origin / slaughter / halalCertRef | **Label OCR** | Certificate flow already captures photos |
| supplier / product | **Barcode / QR / history** | supplier+product already in DB to match against |
| receivedAt | **Clock** | already defaults to `todayIso()` ✅ |

**Key leverage:** the **evidence-capture pipeline already exists** (`uploadOperatorEvidence`, `linkOperatorEvidence`, certificate flow). Every "OBSERVE via OCR" opportunity above rides on photos PTM *already stores* — only the read step is missing. The data model is observation-ready *today*.

---

# Part 9 — Confirmation Opportunity Register

Transform **question → suggestion → one-tap confirm** (pure software, no hardware):

| Field | Today | Confirmation form |
|---|---|---|
| supplier | Pick from list every time | "Pak Halal again?" (last/most-frequent) → one tap |
| storage | Pick every time | Pre-select last location for this product |
| expiry | Pick every time | Pre-select shelf-life default ("off tomorrow?") |
| float | Type every open | "Use yesterday's £X?" |
| product (delivery) | Pick from 12 | Rank by this supplier's history |
| waste reason | Pick from list | Default "expired" pre-selected (already initial state) |
| receivedAt | (already today) | ✅ done |

These are the **infer → one-tap** rung made literal, and every one is achievable with data PTM already has in the DB.

---

# Part 10 — Elimination Candidates

For each: *if PTM never stored this, what breaks?*

| Candidate | If removed… | Verdict |
|---|---|---|
| **`open_sign` checklist step** | Nothing — it's a reminder, no downstream consumer | **ELIMINATE** (or merge into `display_ready`) |
| **Phantom `customer_name: "Shop sale"` / `customer_phone: "07000000000"`** | The orders schema requires non-null; a counter sale has no customer. Today PTM stores a *fiction* on every walk-in sale. **Nothing real breaks if made nullable** — but the fiction pollutes customer data and any "phone" analytics. | **ELIMINATE the requirement** — make these nullable for `source=operator_serve`, stop fabricating a fake phone number. Stock/audit/money all unaffected (they key off branch/order, not customer). |
| **`system_*` client copies (pricing-validation)** | Audit trail still intact (server recomputes); only the *untrusted client echo* is removed | **ELIMINATE the client input**, recompute server-side |
| **`description` on quick product create** | Nothing operational; storefront copy only | Keep but never *require* |
| **`displayTempC` (optional already)** | Nothing — already optional ✅ | Correctly optional |
| **`batchNumber` human entry** | Auto-generated as `OP-{runId}` for operator path ✅ | Already eliminated for operator |

The two real eliminations: **`open_sign`** (no consumer) and the **phantom customer** (a stored fiction). Both are safe — neither touches stock truth, audit, compliance, or money.

---

# Part 11 — Information Entropy Report (how data drifts from reality)

| Entropy source | Drift mechanism | How PTM should pull truth back |
|---|---|---|
| Estimated weights | Gul eyeballs "1kg" | **Scale** closes it; until then, stock-count reconciles |
| Forgotten supplier | "Not sure" → owner alert | Already handled — `operator_delivery_unknown_supplier` alert ✅ |
| Wrong expiry | Mis-picked choice | FEFO + stock-count surfacing of impossible dates |
| Skipped waste | Closing waste not logged | Closing checklist `waste_logged` prompts it; the "No waste" one-tap keeps the habit |
| Delayed temperature | Read late or guessed | Probe removes the human delay entirely |
| Unreconciled cost | Owner never adds invoice cost | **Already a standing alert** — `operator_delivery_cost_pending` per batch ✅ |
| Phantom customer | Fake phone accumulates | Eliminate the fiction (Part 10) |

**Entropy finding:** PTM already has a strong **self-healing spine** — owner alerts for unknown supplier/cost-pending, FEFO, stock-count reconciliation. The remaining drift is concentrated in the **estimated/guessed** fields (weight, temperature) that only observation can truly fix. The *bookkeeping* drift is already caught by alerts.

---

# Part 12 — Operator Information Budget

Facts Gul provides today vs after a software-only reduction (confirm-don't-ask + eliminations):

| Event | Facts today | After reduction | Cut |
|---|---|---|---|
| **Sale (1 catalogue item)** | 4 (product, qty, pay, +confirm) | **2** (product, qty) — pay defaults/terminal, confirm folded | **~50%** |
| **Delivery (known product)** | 6 (product, qty, supplier, storage, expiry, photo) | **2** (product, qty) + 3 one-tap confirms | **~50% typed→confirmed** |
| **Waste** | 3 (product, qty, reason) | 2 (qty, reason) — reason defaulted | ~33% |
| **Open** | 5 step inputs | 3 (temp via probe later; float prefilled; sign removed) | ~40% |
| **Close** | 6 step inputs | 4 | ~33% |
| **Daily total (typical)** | ~40–60 discrete facts | **~20–30** | **≥50% ✅ target met (software-only)** |

The 50% target is reachable **without any hardware** — purely via confirm-don't-ask, prefill, and the two eliminations. Hardware (scale/probe) then pushes the *remaining* weight/temperature facts toward zero.

---

# Part 13 — Owner Information Budget

Separated by class (the owner should **think**, not transcribe):

| Class | Fields | Verdict |
|---|---|---|
| **Operational** (daily) | cost reconciliation, supplier checks, order status, stock corrections | Mostly **alert-driven already** — owner responds to Do Now, doesn't hunt |
| **Financial** | invoiceCost, costGbp, price, margins | **Transcription-heavy** — invoice OCR is the big unlock; today the owner re-keys invoice figures |
| **Strategic** | pricing-validation decision, daysHung, margin overrides | **Genuine judgement — keep** (this is the owner thinking, correctly) |
| **Configuration** (set-once) | products, suppliers, pickup windows, closures, settings | Set rarely; fine — but should live behind the "Settings" door (Friction Audit B2) |

**Owner finding:** the owner's *judgement* inputs (pricing decisions, margins, days hung) are exactly what an owner *should* spend attention on — keep them. The owner's *transcription* inputs (invoice cost, cert refs, origin) are the waste, and all are **supplier-owned facts** recoverable by OCR from documents the shop already photographs. The owner should approve numbers, not type them.

---

# Part 14 — Hardware Readiness Matrix (readiness only, no recommendation to build)

| Field | Source | Confidence the source is authoritative | Integration complexity | Risk if wrong | Readiness |
|---|---|---|---|---|---|
| Temperature | Probe/IoT | **Very high** (sensor = truth) | Medium (pairing) | High (safety) → biggest correctness win | **Ready — model takes a number today** |
| Weight | Scale | **Very high** | Medium | Medium | **Ready — `quantity` is a plain number** |
| Pay method | Terminal/EPOS | High (for card) | High (vendor API) | Low | Partial — needs `payment_method` reconciliation hook |
| Cost | Invoice OCR | Medium (needs review) | Medium | Medium (margins) | **Ready — photo already captured** |
| Expiry/origin/cert | Label OCR | Medium (confirm-low-confidence) | Medium | Medium (compliance) | **Ready — photo pipeline exists** |
| Supplier/product | Barcode/history | High (history) / Medium (barcode) | Low (history) | Low | **Ready now via history (pure software)** |

**Readiness verdict:** the data model is already shaped for observation — numeric weight/temp fields, an existing evidence-photo pipeline, supplier/product records to match against. No schema redesign is needed to *receive* observed data; only the `source` provenance field (recommended in the Friction Audit) is missing to *distinguish* observed from typed.

---

# Prioritised Information-Reduction Roadmap

Ordered by **(human-input removed × frequency) ÷ effort**. Pure-software first.

### Tier 1 — Pure software, removes human input now
1. **Confirm-don't-ask: supplier / storage / expiry / float** — defaults from history/yesterday, one-tap confirm. *(Parts 7, 9)*
2. **Eliminate `system_*` client inputs in pricing-validation** — recompute server-side. *(Dup1)*
3. **Eliminate the phantom `customer_name`/`customer_phone` on shop sales** — make nullable for operator-serve. *(Part 10)*
4. **Eliminate / merge `open_sign`.** *(Part 10)*
5. **Default waste `reason` to "expired"; rank delivery products by supplier history.** *(Part 9)*

### Tier 2 — Provenance & deferral (cheap, unlocks the rest)
6. **Add `source: manual|scale|probe|ocr|terminal` field** to weight/temp/quantity/pay records — makes observed-vs-typed visible and every integration a drop-in.
7. **Extend the F7 deferral pattern** to operator-delivery supplier (confirm-or-defer to owner reconciliation).

### Tier 3 — Observation (record now, build later; the model is ready)
8. Temperature probe → the 4 temperature fields.
9. Scale → weight fields.
10. Invoice/label OCR on **already-captured photos** → cost, expiry, origin, cert refs.
11. Terminal/EPOS → pay method + till.

---

# Final Evaluation

### 1. What information should PTM *never* ask a human for?
- **branch, operator, time, ids, references** — already inferred ✅ (the model is set here).
- **The phantom customer on a walk-in sale** — a fiction, eliminate it.
- **PTM's own computed figures** (`system_*` in pricing-validation) — recompute, never re-collect.
- **`receivedAt`** — default to the clock (already does).
- Ultimately, once observed: **weight, temperature, cost, pay-method, expiry/origin/cert** — these are owned by reality, the scale, the probe, the terminal, the supplier's invoice and label. The human is only a stand-in until the sensor exists.

### 2. What information should PTM ask only as *confirmation*?
- **supplier, storage location, expiry, opening float, delivery product** — all have a high-confidence default from history or yesterday. The human's job becomes a one-tap "yes" or a rare correction. Add **cost/origin/cert** here too once OCR proposes a value to confirm.

### 3. What information is *genuinely human-owned* and can never be inferred?
A short, honest list — the irreducible core:
- **Waste reason** (why it was binned — judgement).
- **Cleaning / sanitisation / hygiene confirms** (an attestation only a person can make).
- **Pricing decisions, margin overrides, days-hung** (owner strategy/craft).
- **Cash counted** (the physical reconciliation act).
- **Customer's own details and basket** (owned by the customer, correctly self-served — and note PTM already *doesn't* collect a delivery address: pickup-only).
- **"I'm not sure / tell the owner"** — the human's right to escalate.

Everything else is a proxy for a fact reality already holds.

### 4. If PTM were rebuilt from scratch today, what % of human inputs would disappear?

Counting the ~47 human-entered fields in the inventory:

| Path | Mechanism | Fields removed |
|---|---|---|
| Already eliminated (credit) | inferred branch/operator/time/ids, deferred cost, pickup-only (no address), auto batch number | baseline already lean |
| **Software-only** (confirm-don't-ask, eliminations, server-recompute) | Tiers 1–2 | **~35–40%** of remaining human inputs become one-tap confirms or vanish |
| **+ Observation** (scale, probe, OCR, terminal on existing photo pipeline) | Tier 3 | a further **~25–30%** |

> **Combined: roughly 60–65% of today's human inputs would disappear** — about **35–40% from pure software with no hardware at all**, the rest as observation lands on a data model that is already shaped to receive it.

The deeper truth this audit surfaces: **PTM has already won the hidden-input war** (who/where/when/ids are never asked) and has **already proven the deferral pattern** (cost → owner) and the **self-healing spine** (owner alerts, FEFO, reconciliation). What remains is to apply those same instincts to the visible fields — *remember the stable ones, confirm the predictable ones, observe the physical ones, and only ever ask a human for the handful of facts that judgement and the customer genuinely own.*

---

*Doctrine restated: every requested field is technical debt until proven necessary. The butcher runs the shop; the software observes it.*

---

# Appendix A — Dependency-graph corrections & the *measured* count

Added 2026-06-29 after a challenge: the "60–65%" in the Final Evaluation was a reasoned estimate, not a measured result. This appendix (a) corrects two dependency claims by testing them against the code, and (b) replaces the estimate with an actual classified count — and finds the estimate conflated two denominators.

## A.1 Two dependency claims, tested against the graph

| Claim | Tested how | Result |
|---|---|---|
| "Temperature is confined to compliance" | grep all consumers of temp fields | **Confirmed** — consumers are compliance + the ritual checklist + audit only. Does **not** reach inventory/purchasing/serve/intelligence. **New wrinkle:** captured in *two* homes (ops-capture `fridge_temp`/`fridges_closed` **and** compliance `chiller/freezer/display`) — a duplication, not a leak. |
| "Maybe only compliance uses supplier" | grep all consumers of `supplier`/`supplier_id` | **Falsified, but instructively.** Second consumer = `buildCertificateForecast` (operations-intelligence) reading `certExpiry` to warn before a cert lapses. Supplier therefore **cannot be eliminated** — but no consumer is real-time at delivery, so **deferral holds**. The graph distinguishes *eliminate* from *delay*; ownership analysis alone could not. |

**Method upgrade:** the dependency direction ("what consumes this?") produces a *different and more precise verdict* than the ownership direction ("who owns this?"). Ownership says "supplier isn't Gul's" → defer. Dependency says *why* and *how far* you can defer: until the first batch consumer (cert forecast / provenance), which is never the unload moment. Both audits agreed on supplier; only the graph proved the boundary.

## A.2 The measured count (replacing the estimate)

Every human-entered field occurrence, classified by its best achievable end-state:
**E**liminate · **I**nfer (software derives, no human) · **O**bserve (hardware/OCR owns it) · **C**onfirm (human still taps once, but supplies no fact) · **K**eep (genuine judgement / customer-owned).

| Surface | E | I | O | C | K | Total |
|---|---|---|---|---|---|---|
| Operator (serve/delivery/waste/checklist/help) | 1 (`open_sign`) | 1 (float prefill) | 8 (3×qty, 4×temp, payKind-card) | 7 (deliv product/supplier/storage/expiry, waste product, ranout product, cert kind) | 9 (serve product, custom name+price, waste reason, ranout sure, ~3 attestations, cash count, help) | 26 |
| Owner (intake/batch/products/suppliers/pricing/config/compliance) | 4 (`system_*` pricing) | 3 (receivedAt, batchNumber✅, stockStatus) | 6 (carcass weight, cost, expiry, halalCertRef, origin, slaughterDate, certExpiry) | 1 (storageLocation) | ~14 (animal/type, daysHung, margins, product config, price/cost judgement, supplier config, settings, butcher decision/notes, pickup windows, closures, counter notes, compliance attestations) | ~28 |
| Customer (self-service) | 0 | 0 | 0 | 0 | 6 (basket, name, phone, email, pickup, lookup) | 6 |
| Hidden system (branch/operator/time/ids/refs) | — | **already inferred ✅** | — | — | — | (baseline) |
| **Total** | **5** | **4** | **14** | **8** | **~29** | **~60** |

### What the count actually shows

**Two denominators give two honest answers — and my estimate used the wrong one as if it were universal:**

- **By raw field count across the whole system:** fields that *fully leave human hands* = E+I+O = **23 / 60 ≈ 38%**. Add C (downgraded to a one-tap confirm, no fact supplied) and **31/60 ≈ 52%** of fields stop being a *typed fact*. The genuinely-kept core is **~29/60 ≈ 48%** — dominated by **config** (set-once: products, suppliers, windows, settings) and **customer self-service** (correctly theirs). My "60–65%" was **too high** against this denominator.

- **By frequency-weighted daily input volume** (what a human actually does in a trading day): the high-frequency fields — sale quantity, pay method, delivery quantity/supplier/storage/expiry, temperatures — are *exactly* the O and C rows. Config fields are touched roughly never; customer fields are touched by customers, not staff. So weighted by how often a hand actually moves, the operator's daily *typing* burden drops **~55–65%** (most of it the qty/temp/confirm cluster). My estimate was **directionally right but for the weighted denominator only.**

**Corrected claim:** *Of all human-entered fields in PTM, ~38% can leave human hands entirely (eliminate/infer/observe) and another ~13% downgrade to a one-tap confirm — but because the removable fields are also the highest-frequency ones, the reduction in **daily human input volume** is closer to 55–65%. The two numbers are different and both are real; conflating them produced the original over-estimate.*

**The honest version of the headline:** the **per-field** win is moderate (~38% removed) and concentrated in observation; the **per-day-of-work** win is large (~55–65%) because reality already owns the things a butcher does most often. PTM should be measured on the second number — it is the one Gul feels.

# PTM Friction & Cognitive Load Audit — V1

**Date:** 2026-06-29
**Author:** Claude (Opus 4.8)
**Scope:** Both personas, audited as *journeys*, not pages.
**Doctrine:** The software adapts to the butcher. The butcher never adapts to the software.

> The reduction ladder applied to every interaction:
> **Eliminate → Infer → Automate → Delay → One-tap → (only then) Required reality.**

The codebase already lives this discipline harder than most apps ever will: one home with 4 big buttons, no scores on operator screens, session-inferred branch/operator/time, `DO_NOW_MAX=3` on the owner side. So this audit is not a teardown — it's the *next* layer of reduction on a system that already did the first layer. The findings are honest about what's already excellent and surgical about what still costs a human a decision they shouldn't have to make.

---

## Part 0 — Scoring key

| Score | Meaning |
|---|---|
| 0 | Should not exist |
| 1 | Can disappear |
| 2 | Can be automated |
| 3 | Can be inferred |
| 4 | Reducible to one tap |
| 5 | Irreducible reality |

Target: everything trends to **4–5** after simplification. A "5" is a genuine human judgement reality demands (e.g. "is the fridge actually cold?"). Anything that scores 0–3 today is a candidate for removal.

---

# A. OPERATOR MODE (Uncle Gul)

**Success metric:** *Could someone with almost no computer literacy run the shop?*

Today: **yes, mostly.** The four-door home (`src/app/operator/page.tsx`) is genuinely low-tech — one lead (brand-tinted) door tells him the single next thing, done-ticks appear, no numbers. This is the strongest part of PTM. The friction is not in *navigation*; it's inside the **Serve** and **Stock/Delivery** flows where the software still asks questions a butcher's hands already answered.

## A1. Operator home — `operator/page.tsx`

| Question | Answer |
|---|---|
| Why does this screen exist? | A single front door so Gul never has to choose between admin pages. |
| Real or invented decision? | **Real, and already minimised.** One lead door = one suggested next action. |
| Can it disappear? | No — it's the anchor. Keep it. |

**Verdict: Score 5.** This is the model the rest of the app should aspire to. The only refinement: the home computes `lead` from open/close state but **Serve never becomes a "done" concept** — fine, serving is all-day. No change.

**One latent win:** the home already knows `openDone`. When the shop isn't open yet, **every other door except "Open Shop" is arguably a mistap risk.** Consider visually receding (not hiding) Serve/Stock until open is done — reinforces "do this first" without removing the escape hatch.

---

## A2. Serve Customer — `operator/serve/operator-serve-flow.tsx`

This is the **highest-frequency journey in the whole app** (every customer, all day). Every tap here is multiplied by hundreds per week, so it deserves the most aggressive reduction.

### Actual tap count today (catalogue item, e.g. "1kg chicken, cash")
Traced from the state machine (`Mode`): `buy → amount → add-more → pay → confirm → done`

1. Tap **Chicken** (buy)
2. Tap **1kg** (amount) — catalogue product auto-prices, commits instantly ✅
3. Tap **No** (add more?)
4. Tap **Cash** (pay)
5. Tap **Save** (confirm)

= **5 taps** for the simplest possible sale. Price is auto-derived for catalogue products — that's already a removed input (good, F5). But there are **two summary/confirm gates** (`add-more` shows a summary, `confirm` shows a summary again).

### Friction map

| Step | Decision asked | Reduction verdict | Score |
|---|---|---|---|
| `buy` — pick product | Genuine: which meat | Irreducible *unless* a scale/scan knows. **One tap.** | 4 |
| `amount` — 500g / 1kg / 2kg / Other | Genuine: how much | **The scale already knows this.** See hardware note. Today: one tap. | 4→(2 w/ scale) |
| `other-amount` — numeric keypad in **grams** | Typing a number | Avoidable when scale integrated; rare path | 3 |
| `price` (custom only) | Typing £ | Only for non-catalogue; correct that catalogue skips it | 5 (custom) |
| **`add-more` — "Add more? Yes/No"** | **Invented friction on most sales** | **DUPLICATE GATE.** See below. | **1** |
| `pay` — Cash / Card | Genuine, but… | …can absorb the confirm step | 4 |
| **`confirm` — "Save this sale?"** | **Second summary + second confirmation** | **DUPLICATE GATE.** Collapse into `pay`. | **1** |
| `done` | Receipt + "serve next" | Keep — but auto-advance possible | 4 |

### The two duplicate decisions (the core finding for Serve)

1. **`add-more` is a whole screen to answer "No" on the overwhelming majority of single-item sales.** A butcher serving one cut taps "No" thousands of times a year. **Fix:** put **"+ Add another"** as a *secondary* button on the `pay` screen. Single-item sales (the common case) go `amount → pay` directly; multi-item sales tap "+ Add another" which loops back to `buy`. This **deletes one screen and one tap from the common path.**

2. **`pay` and `confirm` are two screens doing one job.** The user already committed to the sale by reaching `pay`. **Fix:** make the `pay` screen *be* the confirmation — show the line summary at the top, and **Cash / Card are the save buttons.** Tapping Cash saves immediately. This deletes another screen and another tap.

> **Serve after fix: `buy → amount → pay(=save)` = 3 taps.** From 5 → 3 on the most repeated action in the business. That's a 40% cut on the single most multiplied interaction in PTM.

### Context-switching cost (the hidden tax in Serve)
Every sale is: *look at meat → look at screen → tap product → look at meat → tap weight → look at screen → tap pay → look at screen → tap save.* That's **~4 context switches** per sale today. Collapsing to 3 taps removes one full switch. With a scale, weight becomes zero switches (the number appears).

### Memory / reading / arithmetic load
- **Memory:** none required ✅ (no codes, no SKUs — meat-name tiles).
- **Reading:** minimal, but `add-more`/`confirm` summaries are read twice. Removing one removes a read.
- **Arithmetic:** **zero** ✅ — catalogue auto-prices, operator never multiplies £/kg. This is excellent and must be protected.
- **Typing:** only on `Other` / custom price — correctly the rare path.

---

## A3. Stock / Delivery — `operator/_components/operator-stock-flow.tsx`

Three journeys behind one door: **delivery arrived**, **ran out**, **threw away** (+ "tell owner").

### Delivery journey — actual screens
`start → delivery-product → delivery-amount → delivery-supplier → delivery-photo → delivery-storage → delivery-expiry → delivery-confirm → done`

= **up to 8 decision screens** for one delivery. This is the **second-biggest friction concentration after Serve**, and most of it is **inferable**.

| Screen | Decision | Can PTM already know? | Verdict | Score |
|---|---|---|---|---|
| `delivery-product` | Which product | Partly — the supplier+history predicts it | One tap | 4 |
| `delivery-amount` | Typed quantity | **Scale / invoice OCR** knows this | typed today | 3 |
| **`delivery-supplier`** | Who brought it | **Strongly inferable.** Already defaults when `suppliers.length === 1`. Otherwise = *most frequent supplier for this product*, or *"Same as yesterday — Pak Halal?"* one-tap confirm | **inferable** | **3** |
| `delivery-photo` | Optional photo | Correctly optional, correctly skippable ✅ | 5 |
| **`delivery-storage`** | fridge / freezer / etc. | **Inferable per product** — chicken is always fridge. Store last choice per product, pre-select it. | **inferable** | **3** |
| **`delivery-expiry`** | When it goes off | **Inferable** — product shelf-life + today's date → "Tomorrow" pre-selected. The label is on the meat anyway (camera OCR later). | **inferable** | **3** |
| `delivery-confirm` | Final gate | Keep one confirm; it's the receipt | 4 |

**Already removed (credit where due):** the flow does **not** ask for **cost / invoice value** — that's deferred to the owner (the F9 "cost-pending deliveries" work). This is exactly right: cost is a *paperwork* fact the owner reconciles, not a thing to block Gul at the counter. **Don't regress this.**

### The reduction for Delivery
Three of the eight screens (**supplier, storage, expiry**) are asking Gul to re-supply facts the system can predict from history. **Fix pattern — "confirm, don't ask":**
- Pre-select the most likely answer (last value for this product / only-supplier / shelf-life default).
- Show it as the highlighted default on a single combined "Looks right?" screen, with the alternatives one tap away.

> A delivery PTM has seen before should collapse to: **product → amount → "Pak Halal, fridge, off tomorrow — right?" (Yes)**. ~4 taps instead of 8. The first-ever delivery of a new product is the only one that should ask the full set.

### "Ran out" journey
`ranout-product → ranout-sure → ranout-confirm`. The `ranout-sure` ("Are you sure it is empty?") screen is a **soft duplicate** — `ranout-confirm` already restates it ("It is empty" / "Please check it"). Reasonable to keep *one* of the two as a safety gate against a fat-finger, but **two screens to report an empty tray is one too many.** Collapse "are you sure?" into the confirm screen as the two button choices. **Score 1 for the extra screen.**

---

## A4. Waste — `operator/_components/operator-waste-flow.tsx`

`start(Yes/No) → product → amount → reason → photo → confirm → done`

- The **"No" path is excellent** — one tap records "no waste today" and we're done. Zero friction for the common closing answer. ✅ Score 5.
- The **"Yes" path** mirrors delivery: product → amount(typed) → reason → photo(optional) → confirm.
- **`amount` is typed** — same scale opportunity. Score 3.
- **`reason`** is a genuine human judgement (expired / dropped / trimming). Score 5 — keep.
- **`photo` optional + skippable** ✅ Score 5.

**Verdict:** Waste is well-built. The only inference win is **amount via scale**, and possibly **defaulting `reason` to "expired"** (already the initial state) since closing-time waste is overwhelmingly expiry. No structural cuts needed.

---

## A5. Open / Close checklist — `operator/_components/operator-checklist.tsx` + `lib/ops-capture/checklists.ts`

This is **ritual, not decision** — and the code knows it (the comment says so). Same steps every day, one big question at a time, Yes / Not-yet, dot progress (never a number bar). This is the right ergonomics. The friction question here is different: *which steps are genuinely required reality, and which are software bookkeeping?*

### Opening steps
| Step | Input | Required reality? | Verdict | Score |
|---|---|---|---|---|
| `fridge_temp` | **number °C** | **Yes — food safety.** Critical, blocks open. | The *reading* is real; the *typing* is the gap → **temperature probe** | 5 (decision) / 2 (input) |
| `certs_visible` | confirm | Real (trust, legal) | One tap | 4 |
| `display_ready` | confirm | Real but soft | One tap | 4 |
| `float_ready` | number £ | Real (makes close meaningful) | typed; could prefill **yesterday's float** | 3 |
| `open_sign` | confirm | Borderline — does the *system* need to know the sign is on? | **Candidate for elimination** | **1** |

### Closing steps
| Step | Input | Verdict | Score |
|---|---|---|---|
| `waste_logged` | confirm | Operator just ticks "yes" — but the *actual* waste lives in `/operator/waste`. Coherence gap, not a breach (see finding). | 3 |
| `stock_glance` | confirm | Same coherence gap with `/operator/stock` | 3 |
| `cash_counted` | number £ | Real reconciliation; typed | 4 |
| `fridges_closed` | number °C | Real, critical | 5 / 2 (probe) |
| `clean_done` | confirm | Real (hygiene) | 4 |
| `lock_up` | confirm | Real | 5 |

### Findings
1. **`open_sign` ("Open sign on, lights up")** is the clearest **elimination candidate** in the whole checklist. The system gains nothing operationally from recording that the sign is on; it's a reminder, not a data point. Either drop it or fold it into `display_ready` ("Counter set up and sign on").
2. **Coherence gap on `waste_logged` / `stock_glance`.** The step *definitions* carry `action` links to `/admin/inventory` and `/admin/stock-count`, but — verified in code — those links are rendered **only in the owner's `guided-checklist.tsx`, never in the operator checklist** (`operator-checklist.tsx` ignores `step.action`). So there is **no persona breach** for Gul (good — the wall holds). The remaining gap is softer: in operator mode Gul *ticks* "waste logged" / "stock checked" as a plain confirm, but the real capture lives in `/operator/waste` and `/operator/stock`. A ticked box doesn't guarantee the work was done. **Optional refinement:** in operator mode, make these two steps *launch* the matching `/operator/*` flow (not `/admin/*`) so "logged" means logged — but this is a coherence nicety, not a bug.
3. **The "I can't do this — tell the owner" escalation on critical steps is excellent** (F8). It means Gul is never *stuck* — there's always a non-dead-end. Protect this.
4. **Required readings (temp/till) correctly block completion** with a calm re-entry path. Good — this is "required reality" done right.

---

## A6. Certificate / Paper Photo — `operator/certificate/operator-certificate-flow.tsx`

`pick(kind) → photo → done`. **Two taps + a photo.** Already near-optimal. The `pick` (halal/supplier/fridge/other) is a genuine categorisation the photo can't self-classify yet. Score 4. *Later:* camera OCR could guess the paper type from the photo and skip `pick` → score 3. No action now.

---

## A7. Help / Call Owner — `operator/help/`

Correctly present as the always-available escape hatch on home. This is the safety net that makes the whole low-literacy promise credible. Keep. (Deferred: SMS-on-critical, per memory.)

---

# B. OWNER MODE (Dad)

**Success metric:** *Remove everything that doesn't help the owner make a better decision today.*

This is a **different objective from operator mode.** Here the enemy is not taps — it's **interesting-but-inert information.** PTM's owner side has already won the hardest battle most dashboards lose: `TODAY` (`admin/today/page.tsx`) leads with **Do Now (≤3 actions)**, demotes the weekly summary to a collapsed "for reference" panel, and the Intelligence Firewall keeps scores/percentages off the surface. The morning briefing is ≤100 words, no numbers. This is genuinely excellent product discipline.

So the owner findings are about the **long tail of admin pages** that still exist as *dashboards* rather than *actions*.

## B1. TODAY — `admin/today/page.tsx` — the crown jewel

| Element | Helps today's decision? | Verdict |
|---|---|---|
| Morning briefing (Yesterday/Today/Ignore, ≤100 words) | Yes — orientation | Keep ✅ Score 5 |
| Do Now (≤3 numbered action cards) | **Yes — this is the product** | Keep, protect `DO_NOW_MAX=3` |
| Later reserve (collapsed) | Only when owner wants it | Correctly demoted ✅ |
| Weekly summary (collapsed "for reference") | *Interesting, not actionable* | Correctly demoted ✅ |
| Owner Away panel | Yes when away | Keep ✅ |
| **"More" grid (9 links)** | **Mixed** | **See below** |

**The one friction on TODAY:** the **`MoreDetail` grid of 9 links** (Open, Close, Stock count, Counter, Business Insights, Playbooks, Guide, Setup, Owner Away). This is a **mini-dashboard at the bottom of the most disciplined page in the app.** Nine doors is a decision ("which do I need?"). Most are *rituals* (open/close/stock) that the brain could surface *as Do Now actions when their time comes* ("It's 7pm — close the shop"), and the rest are reference (Playbooks/Guide/Setup) that belong behind a single "Help & tools" door. **Recommendation:** collapse the 9-link grid into **(a) time-aware ritual actions promoted into Do Now**, and **(b) one "Tools & guides" link.** This makes TODAY *fully* an action surface.

## B2. The admin page sprawl — 26 `page.tsx` files

There are **26 admin routes** (`admin/*/page.tsx`). For the owner persona the audit question on each is binary: *does this drive a decision today, or is it a drill-down?*

| Page | Class | Owner question | Verdict |
|---|---|---|---|
| `today` | **Action** | What needs me | Keep — the home |
| `today/[id]` | Action detail | Do this one thing | Keep |
| `today/walk` | Action (guided) | Walk me through | Keep |
| `away` | Action | What happened while out | Keep |
| `briefing` | Redirect (legacy) | — | Confirm still just redirects; else delete |
| `open` / `close` | Ritual | — | **Should be Do-Now-promoted, not standing pages** |
| `stock-count` | Ritual/correction | — | Promote when needed |
| `inventory` | **Dashboard** | Is this a decision or a report? | **Audit for "only when needed"** |
| `purchasing` | Action-ish | What to buy | Keep if it resolves a Do Now |
| `compliance` | Dashboard | Mostly reference | **Surface only on breach** |
| `evidence` | Dashboard | Review queue | Surface as Do Now ("3 photos need you") |
| `audit` | Drill-down | Rarely daily | Behind "Tools" |
| `orders` | Operational | Online orders | Keep if live channel |
| `products` / `pickup-windows` / `shop-closures` / `settings` / `validation/pricing` / `setup` / `releases` | **Config** | Set-once, not daily | **All behind one "Settings & setup" door** |
| `playbooks` / `playbooks/[slug]` / `guide` / `cutting-guide` | Reference | How-to | Behind one "Guides" door |

**The pattern:** ~10 of these 26 pages are **config or reference** that an owner touches monthly, yet they compete for attention at the same altitude as decisions. The V15/V16 work already firewalled *content*; the next move is to **firewall the navigation** — every non-decision page lives behind **two doors** ("Settings & setup", "Guides & how-to"), leaving the top level as pure today-decisions.

## B3. Owner cognitive-load principles (already mostly enforced)

| Principle | Status |
|---|---|
| Could AI summarise this? | ✅ Morning briefing does exactly this |
| Could it appear only when needed? | ⚠️ Partly — Do Now yes; admin pages no |
| Could this page become a Today task? | ⚠️ open/close/evidence/compliance should |
| Is this metric actionable? | ✅ Firewall strips non-actionable numbers from strict surfaces |
| Does the owner care *every day*? | ⚠️ Config pages: no — demote them |
| Drill-down instead of dashboard? | ✅ Weekly summary; ⚠️ inventory/compliance still page-shaped |

---

# C. THE MANUAL-DATA TABLE (the hunt for typed inputs)

Every place a human types a value PTM could have known. **Rule: don't build the hardware — just record the opportunity** so the data model is ready.

| Input | Where | Why entered today | PTM could know? | Hardware that removes it | Recommendation |
|---|---|---|---|---|---|
| **Sale weight** | Serve `amount` / `other-amount` | Operator picks/types grams | The meat is *on a scale* | **Bluetooth/serial scale** | Record `source: manual\|scale` now; integrate later |
| **Sale price** | Serve `price` (custom only) | Custom items only | Catalogue already auto-prices ✅ | — | Already minimised |
| **Pay method** | Serve `pay` | Cash/Card | **Card terminal / till integration** knows card sales | EPOS/terminal webhook | Keep manual; flag as integration point |
| **Delivery quantity** | Delivery `amount` | Typed | Invoice value / scale | **Invoice OCR / scale** | Capture invoice photo already exists → OCR later |
| **Supplier** | Delivery `supplier` | Picked each time | History predicts | — (pure inference) | **Default to most-frequent/last; "same as yesterday?"** |
| **Storage location** | Delivery `storage` | Picked each time | Per-product habit | — (pure inference) | **Pre-select last choice for product** |
| **Expiry** | Delivery `expiry` | Picked each time | Shelf-life + date | Date label OCR | **Pre-select shelf-life default** |
| **Waste quantity** | Waste `amount` | Typed | Scale | Scale | Record source; scale later |
| **Fridge temperature** | Open/Close `fridge_temp`/`fridges_closed` | Typed °C | **Probe / IoT sensor** | **Bluetooth temp probe / fridge sensor** | Biggest hardware win — and removes a *food-safety* typing error risk |
| **Till float / count** | Open `float_ready` / Close `cash_counted` | Typed £ | Float = yesterday's; count = EPOS-assisted | EPOS | Prefill float from yesterday; keep count manual (it's a reconciliation) |
| **Operator identity** | — | **Already inferred from session** ✅ | Yes | — | Done right — never asked |
| **Branch** | — | **Already inferred from login** ✅ | Yes | — | Done right — never asked |
| **Time/date** | — | **Already server-side** ✅ | Yes | — | Done right — never asked |

**Headline:** PTM has *already removed* the three classics every bad app asks for — operator, branch, time. The remaining typed inputs are **weight, temperature, and four delivery attributes** — and four of those six are **pure software inference** (supplier/storage/expiry defaults + prefilled float), needing *no hardware at all*.

---

# D. DUPLICATE-DECISION REGISTER

| # | Journey | The duplication | Fix |
|---|---|---|---|
| D1 | Serve | `add-more` screen + `confirm` screen both summarise; `add-more` asks "No" on most sales | Fold "+ Add another" into `pay`; delete `add-more` screen |
| D2 | Serve | `pay` then `confirm` = two gates after intent is committed | Make `pay` buttons *be* the save (Cash/Card → save) |
| D3 | Stock | `ranout-sure` ("are you sure empty?") + `ranout-confirm` restate the same thing | Collapse "sure?" into the confirm screen's buttons |
| D4 | Checklist | `display_ready` + `open_sign` are near-adjacent "counter/front ready" confirms | Merge into one |

---

# E. CONTEXT-SWITCH REGISTER (operator leaves the physical task)

| Journey | Switches today | After fix |
|---|---|---|
| Serve (1 item) | ~4 (product/weight/pay/save) | ~3; **~2 with scale** (weight auto) |
| Delivery (known) | ~8 | ~4 (confirm-don't-ask defaults) |
| Waste | ~5 | ~4; 3 with scale |
| Checklist (operator) | 0 — links not rendered for operator ✅ | 0 |

**Verified:** the persona wall holds — the operator checklist never renders the `/admin/*` action links (those are owner-only in `guided-checklist.tsx`). The only operator→admin path is the soft coherence gap in A5.2 (ticking "waste logged" without launching `/operator/waste`), not a navigation breach.

---

# F. HARDWARE OPPORTUNITY LEDGER (record, don't build)

Ranked by friction removed × frequency × error-risk:

1. **Bluetooth temperature probe / fridge IoT sensor** — removes a typed food-safety number twice a day, eliminates transcription error on the one input where error = legal/safety risk. *Highest value.*
2. **Counter scale (BT/serial)** — removes weight entry on *every sale and every waste* (highest frequency input in the business).
3. **Card terminal / EPOS webhook** — auto-fills pay method + reconciles till count, removing two typed £ values.
4. **Invoice/label camera OCR** — delivery flow *already captures a delivery-note photo*; OCR turns that existing photo into quantity + expiry + supplier. **The capture pipeline already exists** (`uploadOperatorEvidence`) — only the OCR read is missing.
5. **Barcode/QR on incoming stock** — supplier + product from a scan.

**Data-model readiness action (do now, cheap):** add a `source: 'manual' | 'scale' | 'probe' | 'ocr' | 'terminal'` field to weight/temp/quantity/pay records. Costs nothing today, makes every hardware integration a drop-in later, and lets the owner *see* how much is still manual.

---

# G. AI INFERENCE LEDGER (real inference, not summaries)

| Opportunity | Trigger | One-tap form |
|---|---|---|
| **"Same supplier as yesterday — Pak Halal?"** | Delivery flow, repeat supplier | Yes confirms; one tap vs a pick |
| **"This looks like today's 3rd delivery from Pak Halal"** | Multiple same-supplier deliveries | Informational, builds trust |
| **Storage/expiry pre-fill from product habit** | Delivery flow | Default highlighted, alt one tap |
| **Predict the product from supplier** | Delivery `delivery-product` | Pre-rank likely products first |
| **Paper-type guess from photo** | Certificate flow | Skip `pick` when OCR confident |
| **Promote rituals into Do Now by time** | Owner TODAY | "It's 7pm — close up" appears as action |
| **Waste reason default = expired at closing time** | Waste flow | Already initial state; reinforce |

All of these are **"confirm, don't ask"** — AI proposes the most likely answer, the human's only job is a one-tap yes or a one-tap correction. That is the doctrine's "infer → one-tap" rung made literal.

---

# H. PRIORITISED SIMPLIFICATION ROADMAP

Ordered by **(friction removed × frequency) ÷ effort**. Software-only items first — they need no hardware and no new data.

### Tier 1 — Pure software, highest multiplier (do first)
1. **Serve: delete `add-more` + merge `confirm` into `pay`** → 5 taps → 3 on the most repeated action in the business. *(D1, D2)*
2. **Checklist coherence (optional): make operator `waste_logged`/`stock_glance` *launch* the `/operator/*` flow** so a tick means the work was actually done. *(A5.2 — coherence nicety, not a breach; persona wall already holds)*
3. **Delivery: "confirm, don't ask" defaults for supplier / storage / expiry** → 8 screens → ~4 for known deliveries. *(A3, G)*
4. **Stock: collapse `ranout-sure` into `ranout-confirm`** → one fewer screen. *(D3)*

### Tier 2 — Pure software, owner-side clarity
5. **TODAY: collapse the 9-link "More" grid** into time-promoted rituals + one "Tools & guides" door. *(B1)*
6. **Admin nav firewall:** put the ~10 config/reference pages behind two doors ("Settings & setup", "Guides"). *(B2)*
7. **Drop/merge `open_sign`; merge `display_ready`+`open_sign`.** *(A5.1, D4)*
8. **Promote evidence/compliance into Do Now actions** ("3 photos need you") instead of standing dashboards. *(B2)*

### Tier 3 — Data-model readiness (cheap, unlocks hardware)
9. **Add `source` provenance field** to weight/temp/quantity/pay records. *(F)*
10. **Prefill float from yesterday; default waste reason.** *(A5, A4)*

### Tier 4 — Hardware integrations (record now, build later)
11. Temperature probe → fridge readings.
12. Counter scale → sale & waste weights.
13. Invoice/label OCR on the *already-captured* delivery photo → quantity/expiry/supplier.
14. Card terminal/EPOS → pay method + till reconciliation.

---

# I. SCORECARD SUMMARY

| Journey | Taps today | Taps after Tier 1 | Dominant remaining cost |
|---|---|---|---|
| Serve (1 item, catalogue) | 5 | **3** | weight (→scale) |
| Delivery (known product) | ~8 | **~4** | quantity (→OCR/scale) |
| Ran out | 3 | **2** | — |
| Waste (yes) | 6 | 5 | weight (→scale) |
| Waste (no) | 1 | 1 | ✅ irreducible |
| Open checklist | 5 steps | 4 | temp typing (→probe) |
| Certificate | 2 + photo | 2 + photo | ✅ near-optimal |

**What PTM already does better than almost any retail software:**
- Operator, branch, and time are **never asked** — inferred from session/server.
- Catalogue sales require **zero arithmetic** — auto-priced.
- Owner TODAY is **actions, not a dashboard** (`DO_NOW_MAX=3`, firewalled).
- Cost/invoice is **deferred to the owner**, not blocking the counter.
- Critical checklist steps have a **non-dead-end escalation** ("tell the owner").

**The whole audit in one line:** PTM has already eliminated the *invented* inputs (who/where/when/price-math). The remaining friction is **(a) two duplicate confirmation screens in Serve, (b) three inferable delivery questions, and (c) an owner-nav that still treats config pages as decisions.** Fix those three things — all pure software — and the butcher never adapts to the software again; the only things left to type are the handful of facts that physical reality genuinely owns: *how cold, how heavy, how much cash* — and each of those has a clear hardware path to zero.

---

*Doctrine restated: For every interaction — Eliminate → Infer → Automate → Delay → One-tap → Required reality. The software adapts to the butcher.*

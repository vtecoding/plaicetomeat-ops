# V15 — 00 · Architecture Roadmap: V14.3 → V15.5

## The Owner Brain Program — *the full shape, before any code*

Status: Strategic Architecture Roadmap (planning only — **no code, no migrations**)
Supersedes the planning intent of: V14.2A TODAY Compression, ad-hoc operator-guidance work
Governed by: [The Owner Brain Doctrine](owner-brain-doctrine.md)
Date: 2026-06-09

> This document does for V15 what [docs/v14/10](../v14/10-v14-implementation-roadmap.md) did for V14: it defines the slices, their order, their boundaries, their dependencies, and their exit gates — *and nothing more*. Reading it should not feel like authorisation to start. It should feel like being able to **see the whole building before laying the first brick.**

---

## 0 · How to read this roadmap

The doctrine states the destination in the operator's words:

> *The butcher says "I always know what to do" — without understanding why.*

This roadmap states the destination in the **system's** words, because that is the thing we have to build:

> *Every signal in the shop competes in one ranked contest. The three winners become "DO NOW." Everything else is hidden but not lost. The operator sees verbs and nouns — "Count Chicken Breast today" — never the contest that produced them.*

Everything below is in service of that one sentence. There is exactly **one architectural spine** — the **Action Pipeline** — and each version builds one stage of it. If you only remember one diagram from this document, remember §3.

A note on the number "V14.3". The original V14 pack ([docs/v14/10](../v14/10-v14-implementation-roadmap.md)) used "V14.3" to mean *optional reservation + intelligence overlays*. This program **re-uses that slot** for *Finish Operator Intelligence*. They are not in conflict: the old V14.3 "read-only intelligence over the truth ledger" is precisely the raw material the new V14.3 translates into operator language. We are spending the same slice number on the consumer of that intelligence rather than its producer. §1.1 reconciles this explicitly.

---

## 1 · The destination, stated as a system

### 1.1 What already exists (measured, not assumed)

The audit that triggered this program found the foundation is **right** and the surface is **wrong**. Precisely:

| Layer | State | Evidence |
|---|---|---|
| Reality Engine (Layer 1) | ✅ Built & trustworthy | `truth-hardening.ts` keeps `internalScore` internal; operator only ever receives `operatorMessage` plain English. V14.1/V14.2 ledger is reconstructable & self-checking. |
| Decision Engine (Layer 2) | ⚠️ Partial | `operator-guidance.ts` translates signals into butcher language correctly, but `findings.ts` → `brain.ts` still ranks **within three buckets** rather than one global contest. |
| Operator Layer (Layer 3) | ❌ Still a dashboard | `today/page.tsx` renders up to **21** decisions (`MAX_URGENT 5 + MAX_IMPORTANT 10 + MAX_OPPORTUNITIES 6`, `brain.ts:17-19`) plus `ShopStatusPanel`, `WeeklySummaryPanel`, and an 8-tile `MoreDetail` grid. `/admin/purchasing` is a standalone four-section dashboard. |

So the program is not "build intelligence." The intelligence largely exists. The program is **"make the intelligence decide, then make the surface obey the decision."**

### 1.2 The five through-lines

Five numbers (or states) move monotonically across every version. They are the program's vital signs. If a version doesn't move at least one of them in the right direction, it doesn't belong in the program.

| # | Through-line | Today | V14.3 | V15 | V15.1 | V15.2 | V15.3 | V15.4 | V15.5 |
|---|---|---|---|---|---|---|---|---|---|
| **A** | Max primary actions on TODAY | ~11 (cap 21) | ~11 | **3** | 3 | 3 | 3 | 3 | 3 |
| **B** | TODAY informational panels | 4 | 4 | 4 | **0–1** | 0–1 | 0–1 | 0–1 | 0 |
| **C** | Taps from "problem" → "done" | navigate chain | chain | chain | chain | **1** | 1 | 1 | 1 |
| **D** | Operator-visible calculations | some leak | **0** | 0 | 0 | 0 | 0 | 0 | **0, audited** |
| **E** | Standalone dashboards reachable | 2+ | 2+ | 2+ | **1** | 1 | 1 | 1 | **0 (or evidence-only)** |

Read the table top to bottom for a single version, or left to right for a single discipline. This *is* the roadmap; everything after it is detail.

---

## 2 · The one rule that orders the whole program

> **Truth before ranking. Ranking before compression. Compression before execution. Execution before retirement.**

This is the V15 analogue of V14's *"truth-foundation before behaviour, behaviour before optimisation."* You cannot:

- **rank** actions whose language and source-of-truth aren't yet aligned (→ V14.3 first),
- **compress** to three before there is a single field to rank in (→ V15 before V15.1),
- give a **one-tap** button to an action that hasn't won its place on the surface (→ V15.1 before V15.2),
- **retire** a dashboard before TODAY can do that dashboard's job (→ retirement trails capability, never leads it).

Every sequencing decision below is a consequence of this one rule.

---

## 3 · The architectural spine — the Action Pipeline

This is the heart of the document. Every version builds, hardens, or presents one stage of this single pipeline. There is no second architecture.

```
┌────────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — REALITY ENGINE  (invisible; built in V14, hardened ongoing)    │
│                                                                          │
│  ① SIGNALS                                                               │
│     inventory truth · expiry/FEFO · purchasing · sales velocity ·        │
│     waste history · compliance.   Each signal carries an INTERNAL        │
│     confidence (truth-hardening.ts internalScore) that never leaves L1.  │
└───────────────────────────────┬──────────────────────────────────────────┘
                                 │
┌───────────────────────────────▼──────────────────────────────────────────┐
│ LAYER 2 — DECISION ENGINE  (invisible)                                    │
│                                                                          │
│  ② CANDIDATE ACTIONS        ◄── built/finished in V14.3                   │
│     translate each signal into a candidate action, in butcher language.  │
│     CONFIDENCE ROUTES THE VERB:                                          │
│        high-confidence truth  → "Sell / Order"                           │
│        low-confidence  truth  → "Count"   (never sell/order on a guess)  │
│                                                                          │
│  ③ SCORING                  ◄── built in V15                             │
│     one comparable score per candidate =                                 │
│        doctrine_rank(loss>waste>stock-out>sales>time)                    │
│        × money_at_stake × urgency × confidence_weight                    │
│                                                                          │
│  ④ COMPETITION              ◄── built in V15                             │
│     ALL candidates ranked in ONE field (urgent/important/opportunity     │
│     buckets collapse into a single contest).                             │
│                                                                          │
│  ⑤ COMPRESSION              ◄── built in V15                             │
│     top 3 → DO NOW.  rest → "Later" (hidden, not deleted).               │
└───────────────────────────────┬──────────────────────────────────────────┘
                                 │
┌───────────────────────────────▼──────────────────────────────────────────┐
│ LAYER 3 — OPERATOR LAYER  (the only visible layer)                        │
│                                                                          │
│  ⑥ EXECUTION                ◄── built in V15.2                           │
│     each action owns a one-tap handler: Sell→offer, Count→count,         │
│     Order→order-list.   Problem → Action, no navigation chain.           │
│                                                                          │
│  ⑦ PRESENTATION             ◄── reshaped in V15.1, briefed in V15.3,     │
│     verb + noun only. "Count Chicken Breast today."     audited in V15.5 │
│     No score. No confidence. No panel that doesn't create an action.     │
└────────────────────────────────────────────────────────────────────────┘
```

**The single most important design idea in this whole program** lives at stage ②: *confidence does not get shown — it gets spent on choosing the verb.* This is how V15 honours the doctrine ("the butcher never sees confidence") **and** stays safe (we never tell a butcher to sell or order based on stock we don't trust). It is also the clean seam between the V14 truth work (already done) and the V15 decision work (to come).

---

## 4 · Version-by-version

Each version below carries the same seven fields, so they can be compared at a glance: **Boundary · Depends on · Operator-impact goal · Pipeline stage · What changes · Out of scope · Exit gate.**

---

### V14.3 — Finish Operator Intelligence

> *Make every signal speak the butcher's language, from real data, with no contradictions — so it is fit to be ranked.*

- **Boundary.** Language, translation, and truth-alignment only. **No ranking change, no compression, no UI restructure.** This is the "make it sayable" slice, not the "make it fewer" slice.
- **Depends on.** V14.1/V14.2 truth ledger (done). Nothing else.
- **Operator-impact goal.** Anywhere the system speaks about stock, it speaks like a butcher and agrees with V14 truth. *Measurable:* zero surfaces containing legacy phrasing ("stock not updating", "manual inventory", old-model wording); "Order tomorrow" demonstrably appears from a **real operator journey** on seeded low-stock data, not only from a unit test.
- **Pipeline stage.** ① → ② — perfect the *signal-to-candidate* translation, and lock in the **confidence-routes-the-verb** rule.
- **What changes.**
  1. **Action translation completeness.** Every internal condition in `truth-hardening.ts` (`repeated_shortfall`, `cache_mismatch`, `failure_trend`, stale-count) maps to a butcher sentence in `operator-guidance.ts`. No internal reason ever reaches a surface untranslated.
  2. **Confidence→verb routing** made explicit and tested: a low-confidence signal must generate a **"Count"** candidate, never a "Sell"/"Order" one. (Today the routing is implicit in `confidenceSignal`; V14.3 makes it the named contract between L1 and L2.)
  3. **Legacy-language sweep.** Grep every operator surface for old-inventory-model wording and replace it. Establish a lint/test guard so it cannot return.
  4. **Inventory-truth alignment.** `/admin/purchasing`, counter messaging, TODAY, decision detail — all must agree with the V14 ledger. The purchasing "Collected orders are already taken off stock" stamp becomes a *system-wide* invariant of wording, not a one-off banner.
  5. **Real-data validation harness.** Extend the verify-ops style: seed a low-stock scenario, run the operator journey, assert "Order tomorrow" surfaces. This is the proof the doctrine demands ("Real operator journeys. Not tests.").
- **Out of scope (pushed later).** Reducing the *number* of actions (V15). Touching panels (V15.1). One-tap (V15.2).
- **Exit gate.** (a) Legacy-language guard green across all operator surfaces. (b) Every `internalReason` has a mapped butcher sentence. (c) The low-stock real-journey harness shows "Order tomorrow" from data. (d) No operator surface contradicts V14 truth. Existing unit/e2e suites stay green.

---

### V15 — Action Compression Engine

> *Eleven actions become three. The software chooses; the butcher does not.*

- **Boundary.** The **ranking and compression brain** only. It changes *which* and *how many* actions exist — not yet how the page looks (that's V15.1) and not how they execute (V15.2). After V15, TODAY may still carry its old panels; it will simply have ≤3 decisions in the action region.
- **Depends on.** V14.3 (you can only rank candidates that are correctly translated and confidence-routed).
- **Operator-impact goal.** TODAY feels **calm**. *Measurable:* through-line **A** hits **3**. At most three primary actions are presented at any time; everything else is reachable but hidden.
- **Pipeline stage.** ③ Scoring → ④ Competition → ⑤ Compression. This is the version that *builds the contest.*
- **What changes.**
  1. **One score, one field.** Introduce a single comparable action score in the Decision Engine: `doctrine_rank × money_at_stake × urgency × confidence_weight`. The doctrine ladder is the primary key: **prevent loss > prevent waste > prevent stock-out > protect sales > save time.** Money and urgency break ties within a rung.
  2. **Collapse the three buckets into one contest.** Today `brain.ts` ranks *within* urgent/important/opportunity and caps each (5/10/6). V15 makes all candidates compete in **one** ranking; the urgent/important/opportunity labels, if kept at all, become *derived presentation tags*, not separate capped lists.
  3. **Compress to three.** Replace `MAX_URGENT/IMPORTANT/OPPORTUNITIES` (and `operator-guidance.ts maxCards ?? 6`) with a single **`DO_NOW_MAX = 3`**. The other candidates are not discarded — they flow to a "Later" reserve the surface can reveal on demand.
  4. **Explainable internally, silent externally.** Each winning action records *why it won* (its score components) for diagnostics and tests — never for the operator. This is the audit trail that lets us trust the compression without showing it.
- **Out of scope.** Retiring panels (V15.1). One-tap (V15.2). Briefing (V15.3).
- **Exit gate.** (a) `DO_NOW_MAX = 3` enforced end-to-end; no path can present a 4th primary action. (b) A ranking test proves the doctrine ladder ordering (a loss-prevention action always outranks a time-saving one, etc.). (c) Snapshot/seed scenarios show the *right* three winning. (d) The "Later" reserve contains the remainder, losslessly.

---

### V15.1 — TODAY Operating System

> *TODAY stops being a dashboard and becomes the business.*

- **Boundary.** **Surface restructure only.** The brain from V15 is unchanged; this version changes what the operator *sees*. DO NOW becomes the page; everything informational collapses or leaves.
- **Depends on.** V15 (you cannot make "three actions" the entire page until the brain reliably produces three).
- **Operator-impact goal.** The operator can run most of the day from TODAY without opening anything else. *Measurable:* through-line **B** → 0–1 panels; through-line **E** → 1 dashboard remaining.
- **Pipeline stage.** ⑦ Presentation (first pass).
- **What changes.**
  1. **DO NOW is the page.** The three winning actions are the primary and dominant content of `today/page.tsx`. No competing visual weight above or around them.
  2. **Dashboard-thinking removed unless it creates an action.** Apply the doctrine test — *"a metric may only exist if it changes behaviour"* — to `ShopStatusPanel` and `WeeklySummaryPanel`. Anything that only *informs* is either deleted or demoted into a collapsed "Everything else" drawer. A status that *generates* an action becomes an action and joins the contest instead.
  3. **Secondary collapsed.** `MoreDetail`'s 8 tiles, the "Later" reserve, and any retained status become a single collapsed secondary region — present for navigation, absent from the eye-line.
  4. **Begin dashboard retirement (see §6, Track C).** `/admin/purchasing`'s *decision* ("Order chicken tomorrow") is already an action in the contest after V15; V15.1 starts routing operators to the TODAY action rather than the purchasing dashboard, leaving the dashboard reachable as evidence only.
- **Out of scope.** One-tap execution (V15.2). The owner briefing (V15.3).
- **Exit gate.** (a) TODAY presents ≤3 actions as the dominant surface with ≤1 informational panel. (b) Every retained panel passes the "changes behaviour" test or is collapsed. (c) An operator e2e journey completes a representative day touching only TODAY + action handlers. (d) Exactly one standalone dashboard remains reachable.

---

### V15.2 — One-Tap Action Layer

> *Guidance becomes execution. Problem → Action, with no navigation chain.*

- **Boundary.** **Execution wiring only.** It does not change what the three actions are (V15) or the page shape (V15.1); it gives each action a button that *does the thing.*
- **Depends on.** V15.1 (the action has to own the surface before it owns a one-tap button).
- **Operator-impact goal.** The software removes operator steps. *Measurable:* through-line **C** → **1 tap** from problem to done for the three core verbs.
- **Pipeline stage.** ⑥ Execution.
- **What changes.** Each action verb gets a handler attached at the decision-detail seam (`today/[id]`) and inline on the DO NOW card:
  - **"Sell this first"** → create offer / markdown (one tap).
  - **"Count this item"** → open the count for exactly that product (`/admin/stock-count` pre-scoped).
  - **"Order tomorrow"** → add to order list (no retype, no navigation to the purchasing dashboard).
  Each handler closes the loop back into the Reality Engine (a count writes a count; an order writes to the order list), so the *next* pipeline run reflects the action just taken.
- **Out of scope.** Briefing (V15.3); the deep intelligence firewall audit (V15.4).
- **Exit gate.** (a) Each of the three core verbs completes in a single tap from TODAY. (b) Each handler writes back to the truth layer so the action self-clears on the next run. (c) No one-tap handler can act on stale/low-confidence data without the action having been a "Count" in the first place (the V14.3 routing invariant holds through execution).

---

### V15.3 — Owner Briefing Engine

> *The owner understands the whole business in under 60 seconds, before opening.*

- **Boundary.** A **time-shifted rendering of the same pipeline** — not a new engine. The briefing is "yesterday's outcomes + today's three." It is decisions, never dashboards.
- **Depends on.** V15 (the contest) and V15.2 (so the "today" half of the briefing links straight to one-tap actions).
- **Operator-impact goal.** A 60-second read tells the owner what happened and what matters now. *Measurable:* the one-minute rule (a new owner understands the day in ≤1 minute) holds on the briefing in usability checks.
- **Pipeline stage.** ⑦ Presentation (scheduled/summarised view).
- **What changes.**
  1. **Yesterday, in outcomes:** sold · wasted · missed · improved — each a plain sentence, each tied to a cause, never a chart.
  2. **Today, in priorities:** the same three DO NOW actions, linked to their one-tap handlers.
  3. **No dashboards.** The briefing obeys the same "decisions only" rule as TODAY; any number that appears must be the *reason for an action*, not a metric for its own sake.
- **Out of scope.** SMS/WhatsApp delivery (future roadmap, post-doctrine). For now the briefing is the top of TODAY / a dedicated calm view.
- **Exit gate.** (a) Briefing renders yesterday-outcomes + today-three in butcher language. (b) No chart/metric exists that doesn't justify an action. (c) Usability check passes the one-minute rule.

---

### V15.4 — Intelligence Translation Layer

> *All advanced intelligence may be used internally and must be invisible externally.*

- **Boundary.** Harden the **Layer 2 ↔ Layer 3 firewall.** Internally the engine may use confidence, velocity, waste rates, forecasting, profitability, trends. Externally it may show only: sell this · count this · order this · fix this. This version makes that boundary *structural*, not merely *conventional*.
- **Depends on.** V15.2 (the visible vocabulary — the four verbs and their handlers — must be settled before we can prove nothing else leaks).
- **Operator-impact goal.** The operator never sees a calculation. *Measurable:* through-line **D** holds at 0 *by type-level construction*, not by reviewer vigilance.
- **Pipeline stage.** The ②–⑤ → ⑦ seam, hardened.
- **What changes.**
  1. **Strip decision-engine fields from the operator-facing type.** Today `OperatorGuidanceCard` still carries `confidence`, `priority`, `severity`, `health` (`operator-guidance.ts:36-49`). They aren't rendered, but they cross the firewall. V15.4 splits the type: an internal `ScoredAction` (carries the math) and an external `OperatorAction` (verb + noun + one-tap handler only). The external type *cannot* express a confidence score.
  2. **Velocity / forecast / margin become inputs to scoring, never outputs to surface.** Any new intelligence (the old V14.3 read-only overlays) plugs into stage ③ and is forbidden, by type, from reaching stage ⑦.
  3. **One firewall test.** A single guard test asserts the external action type has no numeric/score field, so future intelligence can grow internally without ever leaking.
- **Out of scope.** New intelligence *features* themselves (those are post-doctrine roadmap); this version is the *containment*, so they're safe to add later.
- **Exit gate.** (a) `OperatorAction` type provably carries no calculation. (b) Firewall guard test green. (c) All new/old intelligence enters only at stage ③.

---

### V15.5 — Owner Brain Maturity Pass

> *Audit every screen against the doctrine. Verify the system continuously reduces thinking.*

- **Boundary.** A **whole-product conformance audit** and the closing of any remaining gaps — no new capability, only the guarantee that the doctrine holds everywhere.
- **Depends on.** All prior versions.
- **Operator-impact goal.** A new butcher operates with minimal training; an experienced butcher knows what matters in **≤10 seconds**; the product is an operational advantage, not a management tool. *Measurable:* through-lines **D** and **E** audited to 0; the ten-second and one-minute rules pass on every operator screen.
- **Pipeline stage.** The whole spine, verified end to end.
- **What changes.**
  1. **Screen-by-screen doctrine audit.** Every operator surface is scored against: does it require interpretation? calculation? training? technical understanding? Anything that does is removed or rewritten.
  2. **Retire the last dashboards.** Any standalone dashboard still reachable becomes evidence-only (explicitly "look here to verify", never "decide here") or is removed (through-line **E** → 0).
  3. **Continuous-reduction guard.** A standing check (extending the verify-ops harness) that asserts the doctrine invariants — ≤3 actions, no visible calculations, one-tap verbs, no orphan dashboards — so the system *stays* mature as features land.
- **Exit gate.** (a) Every operator screen passes the doctrine audit checklist. (b) Ten-second / one-minute usability rules pass. (c) The continuous-reduction guard is wired into the gate so regressions are caught automatically.

---

## 5 · Dependency graph

```
V14 truth ledger (done: V14.1 foundation, V14.2 depletion+reversals)
   │
   └─► V14.3  Finish Operator Intelligence      [translation + truth alignment]
          │      (signals speak butcher language; confidence routes the verb)
          │
          └─► V15   Action Compression Engine   [the contest: score→rank→top 3]
                 │      (DO_NOW_MAX = 3)
                 │
                 └─► V15.1  TODAY Operating System   [surface obeys the three]
                        │      (panels collapse; dashboard retirement begins)
                        │
                        └─► V15.2  One-Tap Action Layer   [problem → action, 1 tap]
                               │
                               ├─► V15.3  Owner Briefing Engine   [pipeline, time-shifted]
                               │
                               └─► V15.4  Intelligence Translation Layer   [firewall hardened]
                                      │
                                      └─► V15.5  Owner Brain Maturity Pass   [audit everything]
```

Note the only fork: **V15.3 (briefing)** and **V15.4 (firewall)** both depend on V15.2 but not on each other, so they can be built in either order or in parallel. Everything else is a strict chain, enforced by the §2 rule.

---

## 6 · The five evolution tracks

The version sections describe *slices*; these tracks describe *disciplines* evolving across slices. This is the "validate the full shape" view — read each track top-to-bottom to confirm the progression is monotonic and nothing regresses.

### Track A — Action-compression evolution

| Version | Mechanism | Result |
|---|---|---|
| Today | Three capped buckets (5/10/6) ranked independently | up to 21 |
| V14.3 | unchanged count; candidates now fully translated & confidence-routed | ~11, but *sayable* |
| V15 | one global contest; `DO_NOW_MAX = 3`; remainder → "Later" reserve | **3** |
| V15.1+ | three held as invariant; surface enforces it | 3 |

### Track B — TODAY evolution

| Version | TODAY is… |
|---|---|
| Today | A dashboard: 3 decision sections + DayShape + ShopStatus + Weekly + 8-tile grid |
| V15 | Same layout, but the action region holds ≤3 |
| V15.1 | **DO NOW is the page**; informational panels collapse into one "everything else" drawer |
| V15.2 | DO NOW actions are now *executable* in place (one tap) |
| V15.3 | Gains a 60-second briefing head (yesterday-outcomes + today-three) |
| V15.5 | Audited: nothing on it requires interpretation, calculation, or training |

### Track C — Dashboard retirement strategy

Retirement **trails** capability — a dashboard is only retired once TODAY can do its job.

| Version | `/admin/purchasing` | `ShopStatusPanel` / `WeeklySummaryPanel` | Other dashboards |
|---|---|---|---|
| Today | Primary place to decide an order | On TODAY, informational | reachable |
| V14.3 | Wording aligned to V14 truth | unchanged | aligned |
| V15 | Its decision now competes in the contest | unchanged | — |
| V15.1 | Demoted to **evidence-only**; operators routed to the TODAY action | Collapsed or converted-to-action | collapsed |
| V15.5 | Evidence-only or removed (Track E → 0) | Removed unless action-generating | audited to 0 |

### Track D — One-tap action progression

| Version | "Sell this first" | "Count this" | "Order tomorrow" |
|---|---|---|---|
| Today | navigate → create offer manually | navigate → stock-count → find product | navigate → purchasing → retype |
| V14.3 | wording correct, still a chain | same | same |
| V15 | wins its place in the three | same | same |
| V15.1 | owns the DO NOW card | same | same |
| **V15.2** | **one tap → offer** | **one tap → pre-scoped count** | **one tap → order list** |
| V15.4 | handler reads internal data, shows none | same | same |

### Track E — Owner Brain maturity (intelligence visibility)

| Version | Internal intelligence | What the operator sees | Firewall |
|---|---|---|---|
| Today | confidence, ledger, FEFO | mostly verbs; some leak fields on the card type | convention only |
| V14.3 | + confidence routes verb | verbs only; legacy language gone | convention |
| V15 | + scoring/ranking math | verbs only (≤3) | convention |
| V15.4 | + velocity, forecast, margin, trends | **only**: sell / count / order / fix | **type-level (structural)** |
| V15.5 | anything | audited: zero calculations anywhere | guarded in the gate |

---

## 7 · Risk register & guardrails

| # | Risk | Where it bites | Guardrail |
|---|---|---|---|
| R1 | **Garbage-in ranking.** Compression to 3 is only as trustworthy as the signals beneath it; the V14 memory's top risk (each/box→kg conversion) feeds directly into stage ①. | V15 ranks confidently on shaky truth. | The stage ② **confidence-routes-the-verb** rule (locked in V14.3): low-confidence truth can only ever produce a "Count" action, never a "Sell"/"Order". Bad truth degrades *gracefully* into "count this", not into a confident wrong instruction. |
| R2 | **Hiding the wrong thing.** Compression to 3 could bury something that mattered. | V15 / V15.1. | The doctrine ladder (loss>waste>stock-out>sales>time) is the primary sort key and is *tested*; the "Later" reserve is lossless (hidden, never deleted); internal "why it won" trail makes mis-ranking diagnosable. |
| R3 | **Dashboard retired before TODAY can replace it.** | V15.1 / V15.5. | §2 rule: retirement trails capability. A dashboard becomes evidence-only only after its decision is a one-tap action on TODAY (Track C gating). |
| R4 | **Calculation leak.** A future intelligence feature surfaces a score. | V15.4 onward. | Structural firewall: external `OperatorAction` type cannot express a number; one guard test enforces it; new intelligence may only enter at stage ③. |
| R5 | **Over-collapse.** Hiding so much the operator can't find a needed secondary path. | V15.1. | "Everything else" is collapsed, not removed; navigation remains one tap away; usability checks in V15.5. |
| R6 | **Regression drift.** A later feature quietly reintroduces a 4th action or a metric panel. | After V15.5. | Continuous-reduction guard in the verify-ops gate asserts the doctrine invariants on every run. |

**Cross-cutting guardrails (every slice must carry), inherited from the V11/V12/V14 house style:**

- **Green verify-gate before merge**; build-ahead; deploy separately.
- **No operator-visible number without a behaviour it changes** (the doctrine's metric test, enforced from V15.1, guarded from V15.5).
- **Confidence is spent on the verb, never shown** (from V14.3).
- **Additive first** — new fields/types before behaviour change; never a big-bang surface rewrite.

---

## 8 · Program-level definition of done

The program is complete when **all five through-lines** have reached their final column **and stay there under the V15.5 guard**:

- **A** — TODAY never presents more than 3 primary actions.
- **B** — TODAY carries no purely-informational panel.
- **C** — each core verb completes in one tap.
- **D** — no operator-visible calculation exists anywhere, enforced by type.
- **E** — no standalone decision dashboard remains; any dashboard is evidence-only.

And when the two human tests pass on every operator screen:

- **One-minute rule** — a new butcher understands what matters today within a minute, untrained.
- **Ten-second rule** — an experienced butcher knows what to do next within ten seconds.

At that point the doctrine's final metric is met: the butcher says *"I always know what to do"* — and the software has become an operational advantage rather than a management tool.

---

## 9 · What this document is *not*

It is not authorisation to start V14.3. It is the shape, so that when V14.3 *is* authorised, every later slice already has a defined boundary, a dependency, an operator-impact goal, an exit gate, and a place on the spine in §3. Implementation begins only when this roadmap is signed and the V14.3 boundary is owner-confirmed — exactly as V14.0 required before V14.1.

> Next planning artifacts, when this is signed: `docs/v15/owner-brain-doctrine.md` (the doctrine, verbatim, as the canonical reference this roadmap is governed by) and a V14.3 task breakdown.

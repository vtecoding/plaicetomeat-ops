# PTM Owner-First Operational Improvement Audit

## 1. Document Control

| Field | Value |
| --- | --- |
| Report | `docs/audits/ptm-owner-operational-improvement-audit.md` |
| Generated | 2026-07-13 (Europe/London) |
| Canonical input | `docs/audits/ptm-operational-audit-input.md` (dossier), status `AUDIT_INPUT_READY_WITH_DECLARED_GAPS` |
| Dossier commit | `f7d4380f12648cf6495675fd0941f519a38d5093` |
| Audit performed at | `418c1d5fb815c935f8c91ee75ab8d1cce4d31845` (HEAD; differs from the dossier commit only by documentation commits — no application code changed between them) |
| Method | Dossier-first; implementation inspected only to verify dossier claims, resolve ambiguity, and count workflow friction. No application code, migration, test, workflow or configuration was modified. The pre-existing local modification to `docs/reports/disaster-recovery-certification.md` was preserved and not staged. |
| Author role | Principal operational systems architect / retail-workflow auditor (bounded product-operations audit; explicitly **not** a security audit) |
| Implementation spot-checks performed | `src/lib/ops-capture/checklists.ts`, `src/app/operator/page.tsx`, `src/app/operator/serve/operator-serve-flow.tsx`, `src/app/actions/operator/serve.ts`, `src/app/actions/operator/escalation.ts`, `src/app/operator/_components/operator-checklist.tsx`, `src/app/operator/_components/operator-stock-flow.tsx`, `src/app/operator/_components/operator-waste-flow.tsx`, `src/lib/server/owner-away.ts`, `src/lib/server/reconciliation.ts`, `src/lib/domain/reconciliation.ts`, `src/lib/operator/workflows/serve-lines.ts`, `src/components/counter-dashboard.tsx`, plus repo-wide searches for tender/variance/expected-cash code (none exists) |

New verification performed for this audit (beyond the dossier):

* The closing checklist till step is a bare number (`cash_counted`, "Counted total") with **no expected figure, no comparison, and no variance anywhere in `src/`** (searches for `expected_cash`, `expectedCash`, `till_variance`, `tillVariance`, `expectedCard` return nothing). `VERIFIED_IMPLEMENTATION`
* The operator serve flow **never displays a price**: catalogue lines are summarised as name + weight only, and the save result message is literally `"Saved."` (`src/app/actions/operator/serve.ts:381`). `VERIFIED_IMPLEMENTATION`
* Serve refuses non-kg products with `"That item is sold each, not by weight. Tell owner."` (`src/lib/operator/workflows/serve-lines.ts:89`). `VERIFIED_IMPLEMENTATION`
* The reconcile tray batches **exactly two** alert kinds (`operator_delivery_cost_pending`, `operator_waste_reason_check`) — pinned by its own unit test (`src/lib/domain/reconciliation.test.ts:12`). `VERIFIED_IMPLEMENTATION`, `VERIFIED_TEST`
* `createOwnerAlert` dedupes only on an open `entity_ref`, writes an in-app row + audit log, and calls **no external dispatcher** (`src/app/actions/operator/escalation.ts:71-124`). `VERIFIED_IMPLEMENTATION`
* Owner Away summary queries are capped at orders 20 / workflows 50 / evidence 50 / movements 200 / alerts 20 / documents 50 (`src/lib/server/owner-away.ts:193-234`). `VERIFIED_IMPLEMENTATION`
* The counter "Collected" button transitions directly with no tender question; only Cancel has a `window.confirm` (`src/components/counter-dashboard.tsx:316-330`). `VERIFIED_IMPLEMENTATION`
* The closing checklist's "Log today's waste" and "Quick stock check" steps carry `action.href` values pointing to `/admin/inventory` and `/admin/stock-count` (`src/lib/ops-capture/checklists.ts:65,73`), but the operator checklist skin renders **no action links at all** (`src/app/operator/_components/operator-checklist.tsx` contains no `action.href` usage) — the operator is asked to confirm work with no in-place way to do it. `VERIFIED_IMPLEMENTATION`
* The operator home renders five work doors plus Help (the file's own comment still says "Four big buttons" — matching dossier conflict CF-11). `VERIFIED_IMPLEMENTATION: src/app/operator/page.tsx`

No implementation finding contradicted the dossier. One dossier nuance is sharpened: margin metrics do handle missing cost honestly (dossier §17), so the operational cost-pending risk is confined to the owner having to visit the reconcile tray, not to false profit figures.

## 2. Executive Verdict

**Overall operational verdict: PTM is a truthful record-keeper that is not yet a complete shop operating system.** The order/inventory/audit spine is genuinely strong — server-priced checkout, exactly-once collection depletion, FEFO, append-only movements, explicit shortfalls, resumable rituals, and a certified recovery drill. But the system currently cannot answer the owner's most basic end-of-day question — *"did the money in the till match what we sold?"* — cannot serve a customer buying anything sold by `each` or `box`, cannot record a refund, cannot adjust an online order to the weight actually cut, and cannot get a critical escalation to the owner unless the owner happens to open the app.

* **Are Dad's requirements currently met?** Partially. 14 of 30 owner requirements are fully met, 15 are technically present but operationally weak, partial, or unproven with real people, and 1 (owner away for a week, OR-11) is not met as an operating capability. See §6.
* **Can Uncle Gul operate without excessive dependence on Dad?** For kg trade on a good day, plausibly yes — the operator flows are the best-designed part of the system. But every each/box customer, every mistake discovered after saving, every certificate question at opening, and every mid-flow interruption becomes owner work or lost work. `FIELD_VALIDATION_REQUIRED` — no real session with Uncle Gul has ever been observed (GAP-04).
* **Is Owner Away currently credible?** No. Alerts and summaries exist only inside the app; nothing is dispatched (CF-13); critical help alerts have no delivery channel or phone fallback (GAP-12); summary queries are capped and can undercount a busy week; there has been no absence trial (GAP-05).
* **Are payment and closing figures trustworthy?** No. Walk-in orders record a cash/card method with no amounts reconciled to anything; online-order tender at collection is never captured (GAP-06); the closing till count is stored and never compared; refunds don't exist. PTM's revenue figure and the till's contents are two unconnected numbers.
* **Does inventory match butcher reality?** For kg batch trade: yes, unusually well (FEFO, shortfall-explicit, count-reconciled). For everything else a butcher actually does — each/box items, catch-weight adjustment at handover, substitutions, carcass-to-counter transformation as a live chain — no (dossier §11 `NOT_MODELLED` list, GAP-10).

**Three strongest system qualities**

1. **Truth discipline.** Server-authoritative pricing, idempotent writes everywhere, append-only ledgers, explicit shortfall instead of silent negatives, and failures that never pretend success (INV-01–INV-19). This is the hard part and it is done.
2. **The operator design language.** One question at a time, 72px targets, prefilled floats with provenance, plain butcher language enforced by static guards, and idempotent completed runs. `/operator` is a real answer to "maximum capability, minimum skill" for the flows it covers.
3. **Recovery evidence.** An owner-independent, drilled, encrypted full restore with row-hash parity (OR-30, `VERIFIED_DRILL`). Few shops this size have anything comparable.

**Five largest operational gaps**

1. **No money truth** — tender, expected cash/card, till variance, terminal totals, refunds all absent (PTM-OPS-001, -005).
2. **Non-kg trade is blocked or invisible** — each/box products can't be sold at the counter and never touch stock truth (PTM-OPS-002).
3. **Escalation doesn't escalate** — most alert kinds have no owner action or resolution, none leave the app, and Owner Away has no dispatch or trial (PTM-OPS-003, -004).
4. **Collected online orders record estimates, not what was handed over** — no weigh-at-collection, no substitution, no amendment (PTM-OPS-006).
5. **Zero field evidence** — not one workflow has been observed with Dad or Uncle Gul on a real device in the real shop (GAP-03, GAP-04, GAP-09).

**The single most important next change:** introduce the minimum payment-truth model — record tender (cash/card) at every collection, compute expected cash and expected card for the day, and turn the existing closing till count into an expected-versus-counted comparison with a recorded variance. Everything else the owner wants to trust (revenue, closing, absence summaries, refunds) sits on top of this.

This report deliberately does **not** declare production readiness.

## 3. Goals and Non-Goals

**Goals of this audit.** Determine how PTM can satisfy the 30 registered owner requirements substantially better; make Dad able to understand and control the business in under 30 seconds; make Uncle Gul confident with minimal computer skill; let staff handle real butcher exceptions without corrupting business truth; make the system less visible during ordinary work. Every recommendation traces to at least one of those outcomes and applies the primary principle: **maximum operational capability, minimum operator skill.**

**Non-goals.** No cybersecurity, penetration, secrets, or access-control-hardening evaluation (roles are mentioned only to explain who may perform a business action). No re-audit of the completed disaster-recovery work — the 2026-07-13 drill is treated as established evidence; only owner-facing recovery visibility is examined (§20, PTM-OPS-016). No framework/dependency/hosting/code-style recommendations. No statutory accounting system. No implementation was performed; the report is the only repository change.

## 4. Evidence and Limitations

Evidence states used: `VERIFIED_IMPLEMENTATION`, `VERIFIED_TEST`, `VERIFIED_DRILL`, `DOCUMENTED_REQUIREMENT`, `FIELD_VALIDATION_REQUIRED`, `INFERRED`, `CONFLICTED`, `ABSENT`. Dossier labels map as follows: `DOCUMENTED_ONLY` → `DOCUMENTED_REQUIREMENT`; `UNKNOWN`/`NOT_MODELLED` → `ABSENT` (capability) or `FIELD_VALIDATION_REQUIRED` (human/physical fact).

Hard limitations, inherited from the dossier and unchanged by this audit:

* **No human observation exists.** Every claim about what Dad or Uncle Gul understands, how fast a flow is in a queue, or whether gloved hands can use a screen is `FIELD_VALIDATION_REQUIRED` (GAP-03, GAP-04). This report never presents a repository inference as confirmed human behaviour; friction numbers derived from code are counts of screens/taps, not measured task times.
* **No live production probe** was made (GAP-01, GAP-02); live deployment identity and backup freshness remain as the dossier left them.
* **No hardware inspection** (till, terminal, scale, printer) was possible (GAP-07, GAP-14); the payment recommendations in §14 are designed to be valid regardless of terminal model.
* All 15 dossier gaps (GAP-01–GAP-15) and all 16 conflicts (CF-01–CF-16) were considered; the ones that drive findings are cited in place. Where implementation conflicted with older documents, current implementation was taken as truth per the dossier's conflict register.

## 5. Current Target-User Model

| User | Reality (per dossier §3) | What they need from PTM | Biggest current mismatch |
| --- | --- | --- | --- |
| **Dad (owner)** | Non-technical; hesitant with dense screens; supervises + does manager work; wants to trust numbers and delegate | 30-second morning picture, one clear next action, trustworthy money/stock answers, credible absence | Money questions unanswerable; alert work scattered; nothing pushed to him |
| **Uncle Gul (operator)** | Low computer literacy; manager-rank account locked to `/operator`; busy counter, gloves, queues | Big buttons, one question at a time, no dead ends, safe mistakes | Each/box dead end ("Tell owner"); no price shown; mid-flow work lost on interruption; no post-save fix path |
| **Counter staff** | `staff` role; runs the online-order board and daily compliance | Fast prep→ready→collect, exception handling at handover | Collect is one tap but captures no tender, no actual weight, no substitution |
| **Customer** | Pay-on-collection, click-and-collect | Clear status, fair price at handover, simple cancellation | Price fixed at order time even for catch-weight; post-collection issues = "call the shop" with no traceable next action |
| **Manager (future hire)** | Full `/admin` minus owner-only | Same as owner minus governance | Inherits the same metric-rich analysis hub; acceptable |

The stakeholder model itself is sound and should not change. The Counter role remains justified as a *specialised online-order board* (see §11) — the overlap problem is duplicated order surfaces, not the existence of the role.

## 6. Owner Requirement Scorecard

Statuses: `FULLY_MET` / `TECHNICALLY_MET_OPERATIONALLY_WEAK` (TMOW) / `PARTIALLY_MET` / `DOCUMENTED_ONLY` / `NOT_MET` / `FIELD_VALIDATION_REQUIRED` (FVR). Per the audit rules, no requirement describing real human operation is marked `FULLY_MET` on unit tests alone.

| Requirement | Current status | Operational proof | Failure or friction | Recommended change | Validation required |
| --- | --- | --- | --- | --- | --- |
| OR-01 max capability, min skill | TMOW | `VERIFIED_IMPLEMENTATION` operator adapters + guards | Each/box, refunds, corrections and money all fall back to owner; till double-entry | PTM-OPS-001/-002/-007; keep adapter architecture | Gul field test (§25.2) |
| OR-02 one guided front door | FULLY_MET | `VERIFIED_IMPLEMENTATION`+`VERIFIED_TEST` middleware/route lock | Production account provisioning unevidenced | None (verify prod provisioning during pilot) | Prod login check |
| OR-03 operator cannot enter admin/counter | FULLY_MET | `VERIFIED_IMPLEMENTATION`+`VERIFIED_TEST` route-protection | — | None | Real-device session check |
| OR-04 very few, big choices | FVR | `VERIFIED_IMPLEMENTATION` 5 doors + Help (CF-11: spec said 4) | Whether 5+Help is "few" for Gul is a human fact | Update V17 wording; test with Gul | §25.2 |
| OR-05 plain butcher language | FULLY_MET | `verify:operator-language` guard, `VERIFIED_TEST` | Admin client components outside sweep (owner-facing, acceptable) | None | Wording comprehension in field test |
| OR-06 no analytics on operator surface | FULLY_MET | Intelligence firewall, `VERIFIED_TEST` | — | None | — |
| OR-07 one clear next step | FVR | `VERIFIED_IMPLEMENTATION` DO_NOW_MAX=3; lead door | Completion time never human-measured | None to code | Dad 30-second test (§25.1) |
| OR-08 one tap to the work | FULLY_MET | `VERIFIED_TEST` action-target | No real-owner confirmation yet | None | §25.1 |
| OR-09 only actionable priority info | TMOW | Today clean; `/admin` hub metric-rich | Hub panels that neither decide nor confirm health | PTM-OPS-018 metric census | Dad interview |
| OR-10 owner understands day quickly | FVR | Briefing ≤100 words, `VERIFIED_TEST` | "Under 30s" untimed with a human | None to code | §25.1 timed |
| OR-11 owner away a week, shop continues | **NOT_MET** | Operator independence real; summary exists; **no dispatch, no external alerts, capped queries, no trial** (CF-13, GAP-05, GAP-12) | Owner learns nothing unless he opens the app; a week's alerts accumulate unresolvable | PTM-OPS-004 + operating contract §13 | Staged away trial (§25.4) |
| OR-12 uncertainty has a tell-owner route | TMOW | `VERIFIED_IMPLEMENTATION` alert adapter everywhere | Alert lands in-app only; most kinds unresolvable (two-kind tray) | PTM-OPS-003/-004 | Alert-receipt drill |
| OR-13 failures plain, never fake success | FULLY_MET | `VERIFIED_IMPLEMENTATION`+`VERIFIED_TEST` typed results, partial-checkout state | Many errors reduce to "Try again." (acceptable for operator) | None | — |
| OR-14 operator recovers after interruption | PARTIALLY_MET | Checklists resume from DB; completed runs idempotent | Serve/delivery/waste mid-flow state is browser-local and lost (CONFLICTED in register) | PTM-OPS-009 draft persistence | Device-swap drill (§25.5) |
| OR-15 operator actions create normal truth | FULLY_MET | `VERIFIED_IMPLEMENTATION` same RPCs as admin | — | None | — |
| OR-16 stock reflects physical reality | PARTIALLY_MET | kg engine `VERIFIED_TEST`; each/box `ABSENT`; physical accuracy unobserved (GAP-09) | Non-kg products have no stock truth at all | PTM-OPS-002 policy per product | Blind count day (§25.3) |
| OR-17 stock never silently negative | FULLY_MET | INV-07 guards `VERIFIED_TEST` | — | None | — |
| OR-18 oversell visible to owner | TMOW | Shortfall alert live (`202607111100`), `VERIFIED_TEST` | Alert has no resolution path; nothing prevents promising stock twice | PTM-OPS-003 (resolve), PTM-OPS-012 (promised-kg signal) | — |
| OR-19 collection consumes stock once | FULLY_MET | Unique depletion keys `VERIFIED_TEST` | — | None | — |
| OR-20 FEFO | FULLY_MET | `VERIFIED_IMPLEMENTATION` ordering under locks | Staff physical batch choice unobserved | None (accept divergence; counts reconcile) | §25.3 |
| OR-21 corrections stay traceable | FULLY_MET | Append-only + compensating RPCs `VERIFIED_TEST` | Reversal RPC has no UI (CF-16) — capability, not workflow | PTM-OPS-005 gives it a workflow | — |
| OR-22 delivery and waste easy | TMOW | Guided kg flows with defaults `VERIFIED_IMPLEMENTATION` | Each/box/carcass deliveries escalate; interruption loses form | PTM-OPS-002/-009 | §25.2 |
| OR-23 operator not responsible for certificates | PARTIALLY_MET | Certificate photo flow correct; **opening step `certs_visible` (critical) still makes operator confirm certificate state**; no expiry alert (CF-12) | Contradicts owner amendment A0.2 | PTM-OPS-008 | — |
| OR-24 open/close simple and resumable | TMOW | Ritual resumable `VERIFIED_TEST` | Closing asks confirmations with no in-place path (admin-only hrefs unrendered in operator skin); till number meaningless | PTM-OPS-001/-010 | §25.2 |
| OR-25 required readings can't be skipped | FULLY_MET | Migration `202606291000` + guard `VERIFIED_TEST` | Till amount captured but unreconciled (scored under OR-27/001) | PTM-OPS-001 adds meaning | — |
| OR-26 counter service fast and rehearsed | FVR | Serve flow exists, 6 taps counted from code | Never physically rehearsed (A0.3 outstanding); price invisible forces till double-entry | PTM-OPS-007; rehearsal | §25.2 timed |
| OR-27 walk-in cash/card recorded | TMOW | `payment_method` written `VERIFIED_IMPLEMENTATION` | Method without amounts/terminal result reconciles nothing; online tender never captured | PTM-OPS-001 | §25.3 |
| OR-28 clear pay-on-collection status | FULLY_MET | Public status routes `VERIFIED_TEST` | No receipt/support case (deferred, §29) | None now | — |
| OR-29 owner can explain why a number changed | PARTIALLY_MET | Movements/audit retain actor+reason (INV-25 CONFLICTED: data exists, UI trace incomplete) | Explaining stock change = visiting 3+ screens | PTM-OPS-014 day receipt; movement trace links | §25.1 trace task |
| OR-30 recovery restores schema + records | FULLY_MET | `VERIFIED_DRILL` 2026-07-13 | Owner cannot see freshness/drill state without reading JSON (§20) | PTM-OPS-016 | Quarterly drill calendar |

**Totals: FULLY_MET 14 · TMOW 7 (OR-01, -09, -12, -18, -22, -24, -27) · PARTIALLY_MET 4 (OR-14, -16, -23, -29) · FVR 4 (OR-04, -07, -10, -26) · NOT_MET 1 (OR-11) · DOCUMENTED_ONLY 0.**

## 7. Complete Shop-Day Simulation

Simulated from the current implementation at the audited commit. Decisions = judgement calls, Typing = text/numeric entries, Memory = facts the user must hold in their head. Counts verified from code where a file is cited; otherwise estimates. "PTM truth?" asks whether PTM remains the source of truth for what physically happened.

| # | Stage | Actor | Route | Decisions | Typing | Memory | External tools | Failure behaviour | Correction path | Owner dependency | PTM truth? | Improved workflow |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Owner checks business before opening | Dad | `/admin/today` | 1 (pick Do-now) | 0 | 0 | none | degraded banner on data failure | n/a | n/a | Yes | Pushed morning digest so he needn't remember to open it (PTM-OPS-004) |
| 2 | Operator opens shop | Gul | `/operator/open` | 1–2 (unusual reading?) | 2 numeric (fridge °C; float prefilled) | thermometer value | thermometer | resumes from DB; critical skip → alert | re-answer before finish; immutable after | only on critical skip | Yes | Keep; certificate step removed (PTM-OPS-008) |
| 3 | First walk-in pays cash | Gul | `/operator/serve` (6 screens verified) | 2 (product, amount match) | 0 (preset) | scale reading | scale + till | idempotent retry; "Try again." | none post-save | none | **No for money** (till holds price; PTM shows none) | Show computed price at confirm; PTM becomes price authority (PTM-OPS-007) |
| 4 | Second walk-in pays card | Gul | same + card terminal | 3 | 0–1 | scale + terminal outcome | scale, terminal | terminal failure invisible to PTM | none | none | No for payment result | Tender event with amount (PTM-OPS-001) |
| 5 | Online order arrives | Customer→board | `/checkout` → `/counter` | 0 staff | 0 | 0 | none | realtime→polling fallback | n/a | none | Yes | None needed |
| 6 | Staff begins preparation | Staff | `/counter` Start Prep | 1 | 0 | which card | none | safe error | **no undo to incoming** | none | Yes | Accept (low harm); note in corrections §18 |
| 7 | Supplier delivery during queue | Gul | `/operator/stock` (13 modes; ~7 screens happy path) | 3–5 (product, amount, accept defaults) | 1 numeric | invoice details | none | mid-flow state lost on interruption | restart flow | unknown supplier/product → escalate | Yes (cost pending) | Draft persistence + "finish later" (PTM-OPS-009) |
| 8 | Delivery quantity differs from expectation | Gul | same | 1 | 1 | expected qty (paper) | supplier note | records actual only; no expected exists | owner reviews alert | yes (review) | Actual yes; discrepancy process-only | Keep process-only; PO matching deferred (§29) |
| 9 | Invoice cost missing | Gul→Dad | alert → `/admin/reconcile` | Dad: 1 | Dad: 1 numeric | invoice | paper invoice | works (claim-on-submit, reopen on failure) | re-enter cost | yes by design | Yes | Keep — this is the model other alerts should follow |
| 10 | Fridge reading unusual | Gul | open/close step or `/operator/help` | 1 | 1 numeric | reading | thermometer | critical alert created **in-app only** | n/a | yes — but may never see it in time | Yes (recorded) | External critical ping + owner phone on Help (PTM-OPS-004) |
| 11 | Customer asks substitution | Staff | — | n/a | n/a | n/a | phone | **no workflow**: note or cancel whole order | cancel/rebook | often | No | Amend-at-collection line swap (PTM-OPS-006) |
| 12 | Each/box product requested | Gul | `/operator/serve` | blocked | — | — | till only | "Sold each, not by weight. **Tell owner.**" | sale bypasses PTM via till | yes | **No** | Each-unit serve lines + per-product policy (PTM-OPS-002) |
| 13 | Catch-weight differs from expected | Staff | `/counter` collect | 0 offered | 0 | actual weight | scale | order keeps snapshot price | none | none | **No** — subtotal is an estimate | Weigh-at-handover adjustment (PTM-OPS-006) |
| 14 | Stock runs out | Gul | `/operator/stock` ran-out (3 steps) | 1 | 0 | product | none | alert created; purchasing recomputes separately | n/a | yes (buying) | Yes | Link ran-out → purchasing task (PTM-OPS-015) |
| 15 | Online order collected | Staff | `/counter` Collected (1 tap) | 1 | 0 | 0 | till/terminal for money | depletion exact-once; **tender not asked** | no undo (terminal state) | none | Stock yes; **money no** | Collect asks Cash/Card (+1 tap) (PTM-OPS-001) |
| 16 | Collection reveals missing stock | Staff | same | 0 | 0 | 0 | none | `completed_with_shortfall` + owner alert | stock count later | yes (alert) | Yes — best-in-class | Give shortfall alert a resolve action (PTM-OPS-003) |
| 17 | Waste recorded | Gul | `/operator/waste` (7 modes) | 2 (product, reason) | 1 numeric | what was binned | camera optional | uncertain reason → review alert | none post-save | on "not sure" | Yes | Keep |
| 18 | Operator enters wrong quantity | Gul | any flow, post-save | — | — | that it's wrong | none | **no operator path**; owner uses count/adjust | owner-only correction | yes, always | Yes (correctable) | Operator "I made a mistake" flag → owner task (§18) |
| 19 | Owner unavailable | Gul | `/operator/help` | 1 | ≤200 chars | owner's phone number (not shown) | own phone | durable alert; **no delivery guarantee** | wait | total | Yes (recorded) | Show `owner_contact` + external ping (PTM-OPS-004) |
| 20 | Card terminal / device unavailable | Gul | — | 1 | 0 | fallback drill | cash drawer | PTM unaffected; sales recorded as cash | closing terminal-total absorbs card gap | maybe | Partial | Process card in §13 contract; terminal total at close (PTM-OPS-001) |
| 21 | Network weak/unavailable | all | any | — | — | what was mid-flow | none | actions error w/ retry; checklists resume; **flows lose state**; no offline queue | redo | maybe | At risk | Draft persistence + visible pending state (PTM-OPS-009/-017) |
| 22 | Customer requests cancellation/refund | Staff | `/counter` cancel (pre-collection) or nothing | 1 | 0 | window rules | phone | pre-collection cancel fine; **post-collection: nothing** | none — reversal RPC unreachable (CF-16) | yes | **No** after collection | Refund workflow: compensating money + stock events (PTM-OPS-005) |
| 23 | Till counted | Gul | `/operator/close` `cash_counted` | 0 | 1 numeric | counted total | till | number stored, **compared to nothing** | re-enter before finish | none | **No** — no expected figure exists | Expected vs counted + variance (PTM-OPS-001) |
| 24 | Shop closes | Gul | `/operator/close` (6 steps) | 2 | 2 numeric | — | keys/alarm | resumable; receipt | immutable after finish | on critical skip | Yes for ritual; no day summary | Day-close receipt w/ money line (PTM-OPS-014) |
| 25 | Owner reviews day remotely / next morning | Dad | `/admin/today`, `/admin/away` | several | 0 | what to check | none | request-time only; away caps may undercount; no payment split | n/a | n/a | Partial | Digest + day receipt + money answer (PTM-OPS-001/-004/-014) |

The simulation shows the pattern precisely: **stages that touch stock are excellent; every stage that touches money, non-kg units, exceptions after saving, or the absent owner leaves PTM (rows 3–4, 11–13, 15, 18–19, 22–23, 25).**

## 8. Operational Friction Matrix

Tap/screen counts for operator flows are derived from the verified mode graphs (§1); times are **not** claimed. Rows marked ~ are estimates. "Current friction" summarises the dominant cost; "Target friction" states the post-recommendation shape.

| Workflow | Actor | Screens | Taps | Typed fields | Judgement decisions | Memory burden | Owner dependence | Error recovery | Current friction | Target friction |
| -------- | ----- | ------: | ---: | -----------: | ------------------: | ------------: | ---------------: | -------------- | ---------------- | --------------- |
| Serve kg sale (catalogue, preset amount) | Gul | 6 | 6 | 0 | 2 | scale value | none | idempotent retry; no post-save fix | Double entry with till; price invisible | 4–5 taps; price shown at confirm; PTM = price authority |
| Serve custom item | Gul | 8 | ~10 | 2 (name, £) + grams | 3 | scale + price | none | same | Custom price honesty is good | unchanged |
| Serve each/box item | Gul | blocked | — | — | — | — | **total** | sale exits PTM | Dead end ("Tell owner") | quantity picker, 5 taps (PTM-OPS-002) |
| Delivery (known product, defaults) | Gul | ~7 | ~7 | 1 | 3–5 | invoice facts | cost always queued | mid-flow loss on interruption | Good defaults; fragile mid-flow | drafts persist; unchanged taps |
| Ran-out report | Gul | 4 | 4 | 0 | 1 | product | buying follows | safe | Fine | + links into purchasing task |
| Waste | Gul | ~6 | ~6 | 1 | 2 | item + reason | on uncertainty | safe | Fine | unchanged |
| Open shop | Gul | 1 rolling (5 steps) | ~7 | 2 numeric (1 prefilled) | 1–2 | thermometer | on critical skip | resumable | Fine; certificate step misplaced | 4 steps; cert step removed |
| Close shop | Gul | 1 rolling (6 steps) | ~8 | 2 numeric | 2 | till count | on critical skip | resumable | Confirmations without in-place work; dead-end till number | + expected-cash shown; waste/stock reachable in flow; +1 numeric (terminal total) |
| Counter: collect online order | Staff | 1 | 1 | 0 | 1 | which card | none | no undo | Fast but tender lost | 2 taps (adds Cash/Card) — deliberate +1 tap for money truth |
| Counter: cancel order | Staff | 1 + confirm | 2 | 0 | 1 | reason | none | no undo | Fine | unchanged |
| Owner morning read | Dad | 1 | 0–1 | 0 | ≤3 | none | n/a | degraded states | ~Good — unproven with Dad | + money line + day receipt link |
| Owner: resolve delivery cost | Dad | 2 | ~3 | 1 numeric | 1 | invoice | by design | claim/reopen safe | Good pattern | template for all alert kinds |
| Owner: respond to help/shortfall alert | Dad | 2–3 | — | — | — | context | — | **no action exists** | Read-only dead end | resolve/act per kind (PTM-OPS-003) |
| Refund after collection | Dad | **none exists** | — | — | — | — | total | — | Impossible in system | 3-tap counter/admin refund w/ reason (PTM-OPS-005) |
| Physical stock count | Dad/Gul | ~1 rolling | per-batch | 1 numeric × batches | per-variance | fridge layout | apply is manager | stale-guarded | Typing-heavy | risk-ordered list (PTM-OPS-021, deferred) |

## 9. Surface and Navigation Audit

**Current surface map (55 handlers; dossier §6):** Public (13 incl. 3 redirects + 2 API) · Auth/exception (3) · Operator (8) · Counter (3) · Admin (25) · Health API (1). No route is dead; the three redirects are deliberate.

Assessment against "fewer decisions, less navigation" (not "fewer routes"):

* **Defensible and correctly separated:** `/operator` (doing, low-literacy), `/counter` (online-order board — realtime, column workflow), `/admin/today` (owner decisions), `/admin` analysis hub (secondary depth), public store. The three-family model matches the three genuinely different jobs; merging operator and counter would re-expose Gul to board complexity for zero gain. `VERIFIED_IMPLEMENTATION`
* **Duplicated action, should merge:** `/admin/open` and `/admin/close` render the same checklist definitions through a denser `GuidedChecklist` skin — two skins for one ritual (dossier: "duplicates operator skin"). Merge to the operator skin with role-aware step links; retire the two admin pages (redirects). Managers lose nothing: same backend records (WF-01/02).
* **Duplicated information, keep but demote:** `/admin/orders` is a read-only history overlapping Counter (dossier). Keep as history/search (it answers "what sold on the 4th"), remove any live-work implication by linking prominently to Counter for anything not collected.
* **Should become contextual panels, not routes:** `/counter/orders/[id]` (detail duplicates card content — fold into an expanding card); `/admin/reconcile` should absorb the general alert inbox rather than a new `/admin/alerts` route existing beside it (PTM-OPS-003) — one owner work tray, one banner from Today.
* **Exists mainly for technical history:** `/admin/briefing` (redirect — fine); dual audit tables surfacing as one `/admin/audit` (fine); `/admin/setup` observational checklist — keep until pilot completes, then retire to `/admin/guide`.
* **Workflows split across locations:** waste lives in `/operator/waste`, `/admin/inventory` (form) and the closing confirmation step — the closing step must deep-link the operator flow (PTM-OPS-010). Temperatures live in checklist payloads *and* `/counter/compliance` readings (PTM-OPS-011).
* **Screens exposing internal structure:** none materially on operator/counter; `/admin/releases` and `/api/health` are legitimately technical and correctly owner-only.

**Proposed target surface map** (route deltas only — everything unlisted is unchanged):

| Surface | Change | Why |
| --- | --- | --- |
| `/operator/*` | unchanged routes; serve gains each-unit path; close gains money step + in-flow waste/stock links | OR-01/-24 |
| `/counter` | Collect asks tender; card gains "Adjust at handover" (weight/substitute) and "Refund" (manager) | PTM-OPS-001/-005/-006 |
| `/counter/orders/[id]` | retire → expanding card | duplication |
| `/admin/open`, `/admin/close` | retire → redirect to `/operator/open|close` | one ritual, one skin |
| `/admin/reconcile` | becomes the single **Owner work tray** (all alert kinds, per-kind actions) | PTM-OPS-003 |
| `/admin/today` | + money line in briefing, + day receipt card, + tray badge | OR-10/-29 |
| `/admin/orders` | keep; add day view w/ tender totals + variance | §19 |
| No new top-level routes | — | Simplification rule 6 |

Net: −3 routes, +0 new routes, one new counter dialog, one extended tray.

## 10. Operator Mode Audit

Verdict: **the strongest surface in the system, undermined at its edges.** Evidence: mode graphs and components verified (§1); all human claims `FIELD_VALIDATION_REQUIRED`.

* **Home:** five doors + Help with exactly one lead door computed from the day state (open → serve → close) — genuinely good "one next step" design (OR-07). The V17 "4-button" spec text is stale (CF-11); update the document, not the screen.
* **Opening:** 5 steps, two numeric, float prefilled from history with provenance recorded when accepted unchanged (`operator-checklist.tsx:102-111`) — exemplary. Defect: `certs_visible` (critical) makes the operator vouch for certificate state, contradicting owner amendment A0.2 (PTM-OPS-008).
* **Walk-in service:** 6 taps, zero typing for a preset catalogue sale — but the operator never sees a price ("Saved." — `serve.ts:381`), so PTM cannot tell the customer what to pay and the till remains the real point of sale (PTM-OPS-007). Each/box = hard dead end during a queue (PTM-OPS-002). Custom "Other" lines requiring an explicit price is correct (never £0).
* **Delivery:** defaults for supplier/storage/expiry cut typing to one number; missing cost honestly queued to the owner. Correct behaviour, kept.
* **Ran-out:** 4 taps; creates an alert that dead-ends (PTM-OPS-015).
* **Waste:** product→amount→reason→optional photo; auto-picks the matching active batch — right trade-off for this user; uncertain reason escalates for review.
* **Paper/photo:** broad classification + upload; failures shown; no retry queue (PTM-OPS-017).
* **Closing:** the two confirmations ("Log today's waste", "Quick stock check") have no reachable action in the operator skin (verified §1) — the operator can only confirm or "Not now", which trains ritual theatre (PTM-OPS-010). Till count is a dead-end number (PTM-OPS-001).
* **Help/escalation:** calm, 200-char note, durable alert — but in-app only, and the owner's phone number is not displayed even though `owner_away_settings.owner_contact` exists (`owner-away.ts:10`) (PTM-OPS-004).
* **Interruption/incorrect input/repeats:** completed runs idempotent (INV-17, "Already saved"); pre-save Back/Change consistent; **mid-flow state is browser-local** — a refresh during a 7-screen delivery discards everything (PTM-OPS-009); post-save mistakes have no operator path at all (§18).
* **Physical conditions** (gloves, wet hands, small screens, noise, rush, language): 64–72px targets, one-question rhythm, no scroll-critical actions — plausibly right, `FIELD_VALIDATION_REQUIRED` (GAP-04, GAP-13/14 for devices).

**Decisions the system still asks that it could infer, default, prefill or eliminate:** certificate confirmation at opening (eliminate — owner duty); "Add more?" as a separate screen (fold into a running-basket amount screen, saving 1 screen/tap per sale); supplier/storage/expiry on repeat deliveries (already defaulted — keep); waste batch choice (already inferred — keep); till count expectation (compute it — never ask Gul to know what "should" be in the till); payment method for the second consecutive card sale (do **not** prefill — method is money truth and must be a deliberate tap each time).

## 11. Counter and Online-Order Operations

`/counter` is correctly retained (CF-10 resolved: only the admin query-mode was removed). The board (incoming/prepping/ready/collected, realtime with polling fallback, notes, honest SMS state) is `VERIFIED_IMPLEMENTATION` + E2E-tested, and is the right specialised surface for online orders — it should **not** merge into Operator Mode (Gul escalates online-order problems rather than working the board; merging would violate OR-04).

Gaps, all at the handover moment:

1. **Collected ≠ paid.** One tap collects, depletes stock exactly once — and records nothing about money (PTM-OPS-001).
2. **Collected ≠ what was handed over.** No weigh-at-handover for catch-weight lines, no substitution, no line removal — the snapshot subtotal is fiction whenever the cut differs (PTM-OPS-006).
3. **After collected, nothing can be fixed.** Mistaken collection, refunds, complaints have no workflow; the reversal RPC is unreachable (PTM-OPS-005; CF-16).
4. Start-Prep misclick has no undo to incoming — accepted as low-harm (status history stays truthful; a compensating "back to incoming" transition is a §29 nice-to-have, not a finding).
5. SMS "ready" honesty is good; provider presence should surface in setup/health so "customer never notified" is a visible configuration state, not a discovered one (PTM-OPS-020).

## 12. Owner Today and Decision System

The owner operating view is close to right: briefing ≤100 words above ≤3 Do-now actions, one-tap targets to the work, no scores/percentages (INV-20), weekly panel collapsed, reconcile and Owner Away banners. `VERIFIED_IMPLEMENTATION` + strong test coverage; human comprehension `FIELD_VALIDATION_REQUIRED` (OR-07/-10).

Against the metric bar (§5.3 — every metric must cause a decision, confirm health, explain a discrepancy, or support a required process):

* **Today passes** — its content is already action-compressed by design.
* **The analysis hub (`/admin`) partially fails** — 5 snapshot KPIs plus expandable business panels; several panels (e.g. basket-pattern depth, long-window product tables) inform curiosity rather than decisions. They should move behind progressive disclosure or into `/admin/purchasing` where they already drive buying (PTM-OPS-018, O3 — V16's firewall means this is polish, not danger).
* **Missing from Today, and it matters:** yesterday's money line (takings, split, till variance — impossible until PTM-OPS-001), the day-completeness receipt (PTM-OPS-014), and the owner work tray badge with all alert kinds (PTM-OPS-003).
* The guided walk (`/admin/today/walk`) never marks anything done — browser-only progress (PTM-OPS-019, O3).
* A manager sees Owner Away summary computed on Today while being denied `/admin/away` — harmless inconsistency; fold into PTM-OPS-003 tray work.

30-second understanding is credible **only after the money line exists**: today Dad can see orders, stock risk and actions in one screen, but the question he will actually ask first ("what did we take?") has no trustworthy answer anywhere.

## 13. Owner Away Audit

Current state: toggle + `away_since` window + aggregate panels (open/close, sales, deliveries, waste, sale kg, evidence, certificates, last-20 unresolved alerts). `VERIFIED_IMPLEMENTATION`. What makes it **not credible for a week** (OR-11 NOT_MET):

* Nothing is ever sent — the documented daily dispatch does not exist (CF-13); the owner must remember to open the app on holiday.
* Critical alerts (fridge, help) are in-app rows with no delivery channel and no owner-phone fallback shown to Gul (GAP-12).
* Query caps (20 orders/20 alerts/200 movements — verified `owner-away.ts:193-234`) mean a busy week's summary can silently undercount; counts must come from aggregate queries, not capped row fetches.
* Most accumulated alerts cannot be resolved even when the owner *does* look (two-kind tray).
* No field trial has ever run (GAP-05).

**Owner Away operating contract** (the deliverable §5.10 demands — to be agreed with Dad, then encoded in the alert taxonomy §17 and validated §25.4):

| Category | Contents |
| --- | --- |
| **Operator may decide alone** | All kg sales; deliveries from known suppliers (cost queued); waste with a confident reason; ran-out reporting; opening/closing incl. recorded unusual-but-explained readings; taking paper photos |
| **Requires remote owner approval** | New/unknown supplier or product; any refund; price change; cancelling a customer's order staff didn't create; skipping a critical checklist step |
| **May wait for return** | Delivery costs (queued); waste-reason reviews; certificate filing; stock-count variances below an agreed kg threshold |
| **Stops trade** | Fridge above safe temperature with no resolution; inability to open/close the ritual at all; till physically unavailable |
| **Urgent alert (immediate, external)** | critical severity: fridge/equipment help, critical checklist skip, shop not opened by HH:MM, closing till variance beyond £X |
| **Daily digest (external, scheduled)** | opened/closed by whom; takings + split + till variance; deliveries & missing costs; waste; shortfalls; open alert count; "nothing needs you today" when true |
| **On return review** | Owner work tray (all unresolved), stock-count prompt, week money summary, certificate expiries |

Undercount fix, dispatch channel, and the urgent list are PTM-OPS-004; tray resolution is PTM-OPS-003. Do not claim OR-11 until the staged trial (§25.4) completes.

## 14. Orders, Payments and Reconciliation

The order lifecycle itself (creation → prep → ready → collected; idempotent creation; pre-collection cancellation; server pricing) is `VERIFIED_IMPLEMENTATION`/`VERIFIED_TEST` and needs no structural change. The money layer around it is the largest gap in the system.

**Current payment truth (dossier §12, re-verified):** `orders.payment_method` (`cash/card/online`) set only by operator walk-in sales; no amount-tendered, terminal result, payment state, refund, or settlement record; closing captures one uncompared till number; "call the shop" is the entire post-collection service model.

**Required minimum payment model — recommendation: manual tender recording + daily terminal-total reconciliation (Option B).** Compared options:

| Option | Shape | Verdict |
| --- | --- | --- |
| A. Process-only | Paper till roll + Z-report filed; PTM unchanged | Rejected: leaves OR-27/OR-11/GAP-06 open; owner reconciles by hand forever; PTM never answers "what did we take?" |
| B. Manual tender + daily terminal-total reconciliation | Record cash/card at every collection; compute expected totals; compare counted till + typed terminal Z-total at close | **Recommended**: smallest model preserving trustworthy totals; no hardware dependency; +1 tap per online collection, +1 numeric at close |
| C. Terminal integration | Card reader API posts results | Rejected for now: hardware unknown (GAP-07/14), high integration cost, and B already yields daily card reconciliation to the Z-report. Revisit only with field evidence (§29) |

The specification §5.7 answers, under Option B:

* **When tender is recorded:** at the moment money changes hands — walk-in serve save (already chosen there) and counter Collect (new Cash/Card tap). Never earlier (online orders stay `online/pay-on-collection` until collected).
* **What is captured:** append-only `payment_events`: order id, direction (`sale`/`refund`), method, amount (server-derived from the order's final subtotal — staff never type sale amounts), actor, timestamp, idempotency key, optional reason (refunds).
* **Online orders record tender at collection:** yes — one extra tap on the Collected action; the transition and the payment event commit together.
* **Expected cash** = opening float (already captured) + Σ cash sale events − Σ cash refunds. **Expected card** = Σ card events − card refunds. Both are day-window server computations; no new state.
* **External terminal totals:** closing gains one numeric step — "Terminal total from the card machine (Z-report)" — compared to expected card.
* **Till variance:** closing shows *"Expected in till: £X. You counted £Y."*; variance is stored in the closing payload and raises a warning alert beyond a configured threshold. **Never block closing on variance** — blocking teaches operators to type the expected number (failure-first §11 rule: don't invite figure-fitting; capture honestly, escalate).
* **Corrections attributable:** payment events are append-only; a wrong method is corrected by a compensating pair (reverse + re-record), actor-stamped, same pattern as inventory (INV-10/-11).
* **Refunds:** a `refund` payment event paired (optionally) with the existing `admin_reverse_order_inventory` stock reversal — money truth and stock truth move by separate explicit compensating events, never by editing history (PTM-OPS-005).
* **Closing shows:** expected cash, counted cash, variance; expected card, terminal total, variance; sales count. **Next morning the owner sees:** one money sentence in the briefing ("Took £412 yesterday — till matched" / "till £9 short — tap to see") plus the day receipt (PTM-OPS-014).

Failure-first review of Option B: double-tap → idempotency key per collection; two staff collect simultaneously → transition already serialised, payment event keyed to the transition; operator picks wrong method → compensating correction visible to owner; terminal disagrees with expected card → variance recorded + alert, no silent adjustment; missing tender (staff skipped dialog) → collection without payment event appears on the day receipt as "uncollected tender" line, cannot be marked reconciled. No path duplicates a sale, loses a payment, or marks an incomplete day complete.

## 15. Inventory and Butcher-Reality Audit

Classification of every §5.8 scenario against the current model (dossier §11 + spot checks):

| Physical scenario | Classification | Basis |
| --- | --- | --- |
| kg products | **Adequately modelled** | batches/movements/FEFO/counts, `VERIFIED_TEST` |
| each products | **Not modelled** (catalogue/order only; serve blocked) | `serve-lines.ts:89`; depletion filters kg |
| box products | **Not modelled** (same) | same |
| Catch-weight sales — walk-in | Adequately (actual weight typed) | serve flow |
| Catch-weight sales — online at handover | **Not modelled** (snapshot fixed) | dossier §12; PTM-OPS-006 |
| Carcass intake | Adequately (manager-grade) | cutting guide, `VERIFIED_IMPLEMENTATION` + E2E |
| Primal → retail cuts as live chain | Partially (intake mappings only, no transformation ledger) | dossier §11 `INFERRED` |
| Trimming | Partially (`trim_loss` waste reason) | waste model |
| Bones / offcuts | Process-only (waste "other"; no byproduct products) | `ABSENT` as products |
| Expected vs actual yield | Partially (carcass intake only; not post-batch) | dossier §11 |
| Batch selection (physical vs FEFO) | Adequately system-side; **needs owner validation** physically (counts reconcile divergence) | GAP-09 |
| FEFO | Adequately modelled | INV-08 |
| Substitutions | **Not modelled** | dossier §11 `ABSENT` |
| Stock held for online orders | **Not modelled** (no reservation; oversell explicit after the fact) | INV-15; PTM-OPS-012 |
| Stock missing at collection | **Adequately modelled** (shortfall + alert) | WF-18, `VERIFIED_TEST` |
| Damaged deliveries | Partially (receive then waste `damaged`) | waste reasons |
| Supplier shortages | Process-only (record actual; no expected/PO) | dossier §11 |
| Delivery discrepancies | Partially (expected/actual fields + review notes on admin intake; no invoice matching) | `VERIFIED_IMPLEMENTATION` |
| Waste | Adequately modelled | WF-16 |
| Physical counts | Adequately (kg only) | WF-34 |
| Price-label discrepancies | Process-only | `ABSENT` |
| Product recalls | Partially (trace fields on batches exist; recall **workflow** absent) | dossier §11 |
| Transfers between storage locations | Not modelled (location captured at intake only) | dossier §11 |
| Uncertain traceability | Partially (optional fields); needs owner validation | GAP-10 |

**Model comparison (§5.8 requirement):**

| Model | Contents | Verdict |
| --- | --- | --- |
| **Minimal single-shop (recommended)** | Keep the kg batch/movement engine exactly as is. Add: per-product `inventory_policy` (`kg_batch` / `untracked`), each/box **sellable** at serve and online with order-truth only, "not stock-tracked" labelled honestly in inventory/purchasing, weigh-at-handover amendment, substitution as pre-collection amendment | Smallest model that unblocks trade and keeps every displayed stock figure honest. No unit-conversion engine, no fake each-batches |
| Complete butcher traceability | + each/box count ledgers, transformation (carcass→primal→retail) ledger, recall workflow, transfer moves, PO/invoice matching | Rejected now: each element demands data-entry Gul cannot supply during service; adopt pieces only on field evidence (§29) |
| Multi-branch | + branch transfer, per-branch policy | Out of scope for a single shop; schema already branch-scoped, nothing to do today |

The each/box design doc (`docs/v14/11-each-box-conversion-design.md`, `DOCUMENTED_REQUIREMENT`) describes full conversion; this audit explicitly recommends **not** building it yet — order and money truth first (PTM-OPS-002), count-tracking later only for products Dad names (§27, §29).

## 16. Opening, Closing and Compliance

Step-by-step classification (§5.11 — measurement vs confirmation vs system check vs duplicate vs ritual):

| Step | Today | Classification | Recommendation |
| --- | --- | --- | --- |
| Opening: fridge °C | numeric, critical | **Meaningful measurement** | Keep mandatory; sensor automation is Phase D evidence-led |
| Opening: certificates on show | confirm, critical | Human confirmation **duplicating an owner duty** (A0.2, CF-12) | **Remove from operator ritual**; replace with automatic expiry→owner alert (PTM-OPS-008) |
| Opening: display ready | confirm | Ritual confirmation, low consequence | Keep optional (non-critical) — cheap and habit-forming |
| Opening: float | numeric, prefilled | Measurement (feeds expected cash) | Keep mandatory; prefill already exemplary |
| Opening: open sign | confirm | Ritual close | Keep |
| Closing: waste logged | confirm (admin-only href unrendered for operator) | **Confirmation without the work** | Exception-only: system checks today's waste events; if none → "Any waste today?" Yes launches the operator waste flow inline; No records an explicit no-waste claim (PTM-OPS-010) |
| Closing: stock glance | confirm (same problem) | Confirmation | Keep optional with an operator-reachable link |
| Closing: till count | numeric, uncompared | Measurement **without meaning** | Becomes reconciliation: show expected, capture counted, record variance (PTM-OPS-001) |
| Closing: (new) terminal total | — | — | Add one numeric step: card machine Z-total (PTM-OPS-001) |
| Closing: fridge °C | numeric, critical | Meaningful measurement | Keep mandatory |
| Closing: cleaned | confirm, critical | Hygiene attestation | Keep mandatory |
| Closing: lock up | confirm | Ritual close | Keep |

**Compliance duplication (WF-03):** the operator checklist stores a generic "coldest reading" in checklist payloads while `/counter/compliance` writes structured chiller/freezer/display readings through the compliance RPC — two temperature truths that never meet. Recommendation (PTM-OPS-011): the checklist temperature steps should write through the same compliance-reading path (or an adapter to it) so the owner's compliance picture is one dataset; `/counter/compliance` remains for richer staff capture. Incomplete rituals already resume; skipped criticals already alert; unusual values should additionally pre-fill the help flow ("fridge reading looks high — tell owner?") rather than relying on the operator judging criticality alone.

## 17. Alerts and Escalation Lifecycle

Current model (verified): durable `owner_alerts` rows, warning/critical, dedupe only on open `entity_ref`, no `acknowledged_at`/expiry/snooze/action URL, in-app only, resolvable in UI for exactly two kinds. Alerts accumulate: help, shortfall, checklist-skip, low-stock and questionable-sale rows can never be closed from any screen (WF-23/24). During absence this is the escalation backbone — and it is a one-way letterbox.

**Recommended lifecycle** — implement only the stages that earn their keep (§5.9): `created` (exists) → `delivered` (**critical severity only**: one external channel — see PTM-OPS-004) → `seen` (stamped when rendered in the owner tray; cheap, powers the escalation timer "critical unseen for 30 min → re-ping / show phone fallback to operator") → `claimed` (exists for reconcile kinds; extend the same claim-on-submit pattern) → `acted/resolved` (per-kind action, below) → `reopened` (exists as reconcile self-heal; keep). **Rejected stages:** assignment (one owner), snooze, and blanket expiry — instead, per-kind auto-resolve rules so alerts close themselves when the underlying work completes.

**Alert taxonomy** (every kind gets reason / recipient / required response / direct action / resolution condition / escalation / retention — §5.9):

| Kind | Keep as alert? | Direct action | Resolution | Escalation / retention |
| --- | --- | --- | --- | --- |
| Help: fridge/equipment (critical) | Yes — **the** urgent kind | Call operator; view note | Owner marks handled with note | External ping immediately; re-ping if unseen 30 min; retain 1 yr |
| Help: ran out / unsure / other (warning) | Yes | Open related flow | Owner marks handled | Daily digest; retain 90 d |
| Critical checklist skip | Yes (critical) | View ritual receipt | Auto-resolves when step later completed; else owner note | External ping; retain 1 yr |
| `operator_delivery_cost_pending` | Yes (model citizen) | Inline cost entry (exists) | Cost saved (exists) | Digest; auto-resolve on cost via any path |
| `operator_waste_reason_check` | Yes (exists) | Confirm reason (exists) | Confirmed (exists) | Digest |
| Delivery details check (unknown supplier/product) | Yes | Open batch edit | Owner confirms details | Digest |
| Questionable sale (serve repair mismatch / owner check) | Yes | Open order | Owner confirms or refunds (PTM-OPS-005) | Digest |
| `inventory_shortfall` | Yes | Start stock count for product (one tap) | **Auto-resolve when a count/adjust touches that product**; or dismiss-with-reason | Digest; recurring product → weekly rollup |
| Low stock during sale | **No — reclassify** | — | — | Becomes a purchasing/digest line; as an alert it is fatigue (it duplicates purchasing intelligence) |
| Certificate expiring (new, PTM-OPS-008) | Yes | Open supplier compliance | New certificate recorded (auto) | Digest at 30/7 days; critical at expiry |

Fatigue controls: dedupe stays entity-scoped; the tray groups by kind with counts; anything older than the owner's last "returned from away" review is flagged stale rather than deleted. Alerts that should instead be **workflow blockers** already are (required numeric readings); none of the current alert kinds should silently become automatic decisions — auto-resolve only fires when the *underlying work is actually recorded* (failure-first rule: never resolve an alert without completing the work).

## 18. Corrections, Refunds and Exception Handling

Doctrine (already correct in the data model, incomplete in workflow): **originals stay visible; corrections are explicit compensating events; nothing rewrites history** (INV-10/-11/-14). The gaps are UI paths and the money side.

| Wrong thing recorded | Current recovery path | Original visible? | Stock/money/audit consistent? | Who | UI explains consequence? | Needs dedicated workflow? |
| --- | --- | --- | --- | --- | --- | --- |
| Wrong sale weight | Owner: stock count / `admin_adjust_inventory_remaining`; money: nothing | Yes | Stock yes; **money no** | Owner | No | Compensating refund+re-record (PTM-OPS-005); operator flag (below) |
| Wrong product on sale | Same | Yes | Same | Owner | No | Same |
| Wrong payment method | **None** (method is silent data) | Yes | n/a today; matters once 001 lands | — | — | Compensating payment-event pair (001) |
| Duplicate sale | Prevented (runId idempotency, `VERIFIED_TEST`); header-only repair exists | Yes | Yes | system | n/a | No — solved |
| Wrong delivery quantity | Stock count / adjust; intake idempotency blocks duplicates | Yes | Yes | Owner/manager | Partially (adjust asks reason) | No — compensating is sufficient |
| Wrong supplier on delivery | Limited (no batch supplier edit) | Yes | Trace slightly wrong | Owner | No | Batch-details edit w/ audit (fold into details-check alert action) |
| Wrong expiry date | Same | Yes | FEFO order affected | Owner | No | Same |
| Wrong delivery cost | Reconcile tray (exists, good) | Yes | Yes | Owner | Yes | No |
| Wrong waste quantity | Count/adjust compensates stock; waste event stands | Yes | Yes w/ explanation trail | Owner | No | Acceptable: compensating count + note; inverse-waste UI not justified yet |
| Wrong waste reason | Review alert confirm (exists) | Yes | Yes | Owner | Yes | No |
| Wrong temperature | Re-enter before finish; after finish immutable | Yes | Compliance record wrong | — | No | Exception-only: owner annotation on reading (XS, Phase C) |
| Wrong stock count | Re-count; stale guard protects | Yes | Yes | Manager | Yes | No |
| Wrong status transition | Forward-only; cancel pre-collection | Yes | Yes | Staff | Confirm on cancel only | Prepping→incoming compensating step is nice-to-have (§29) |
| Mistaken collection | **None** (collected terminal; reversal RPC unreachable, CF-16) | Yes | Stock recoverable via RPC nobody can call | — | — | **Yes** — PTM-OPS-005 |
| Refund after collection | **None** | Yes | Money truth breaks silently | — | — | **Yes** — PTM-OPS-005 |

Missing piece for the operator: a **"Tell owner I made a mistake"** path — after "Saved.", one door (inside Help) that references the last completed run and creates a correction task for the owner. It writes nothing to stock or money itself, so it is safe at operator skill level, and it converts today's silent wrong records into owner work items. (Included in PTM-OPS-005's scope.) Corrections deliberately stay **in context** (counter card → refund/adjust; alert → fix) rather than a standalone corrections centre — see §26.

## 19. Reporting and Business Understanding

The §5.13 owner questions, answered honestly:

| Owner question | Today | After Phase A+B |
| --- | --- | --- |
| What did we sell? | Yes (orders/analysis) — operational estimate | unchanged |
| What money did we actually receive? | **No** (method w/o amounts; online tender absent) | Yes — payment events + day receipt |
| What remains unpaid/unreconciled? | **No** | Yes — uncollected tender + unreconciled days listed |
| What stock changed / why? | Yes, fragmented across screens (INV-25) | Day receipt links each stock line to movements |
| What was wasted / cost? | Yes | unchanged |
| What requires attention? | Partially (Today + 2-kind tray) | Full tray, all kinds actionable |
| Which orders incomplete? | Yes (Counter/awaiting) | unchanged |
| Which products profitable / only apparently (missing cost)? | Yes — margin says "cost missing" honestly (`VERIFIED_IMPLEMENTATION`, dossier §17) | unchanged |
| Which supplier issues recur? | Partially (cert status only; delivery quality absent) | Deferred (§29 PO matching) |
| What changed while away? | Partially (caps; nothing pushed) | Digest + uncapped counts |
| Is today complete? | **No single answer** (CONFLICTED, dossier §16) | Day receipt = the answer |
| What must happen tomorrow? | Yes (Do now / purchasing) | unchanged |

Boundary ruling (§5.13): PTM figures are **operational estimates** — request-time calculations with query windows (dossier §17), and must keep saying so. Do not build statutory accounting. The clean boundary is a **period export** (orders + payment events + refunds + waste + closing variances as CSV) for Dad's accountant — Phase C, XS-S scope. Nothing in the UI should present an estimate as a confirmed fact; the day receipt shows "counted", "expected" and "variance" as three separate numbers, never a merged one.

## 20. Hardware, Weak-Network and Continuity Requirements

No hardware requirement is currently established anywhere in the repo (GAP-07, GAP-14) — this section defines the requirement classes; §25.5 validates them.

| Class | Items | Ruling |
| --- | --- | --- |
| **Required for pilot** | One touch device (tablet or large phone) at the counter; existing till drawer; existing card terminal (any model — Option B needs only its Z-total); fridge thermometer; counter scale (external, price authority until PTM-OPS-007 lands, weight authority always) | Pilot cannot start without these; PTM must not assume more |
| **Useful, optional** | Second device (owner's phone for Today/tray); device charging station; screen wipes/stylus for gloves | Encouraged |
| **Future integration, evidence-led** | Receipt printer; scale integration; barcode; terminal API; fridge temperature sensor | §29 — only after field observation shows the manual step is a real bottleneck |
| **Unnecessary complexity** | Kitchen display systems, label printers, multi-till setups | Do not build for |

**Weak-network / continuity rulings per workflow (§5.15):**

| Workflow | Requirement |
| --- | --- |
| Serve / delivery / waste mid-flow | **Persisted drafts** via the existing `operator_workflow_runs` in-progress state (`saveOperatorRun` already supports `status:"in_progress"` + `steps` — the flows simply never call it before completion; verified `escalation.ts:31-56`). Resume banner on the flow's entry screen. (PTM-OPS-009) |
| All saves | Safe retries — already idempotent (INV-02/-17); keep |
| Photo upload | **Visible pending state + one-tap retry**; failure never blocks the parent record (already true); no background queue (PTM-OPS-017) |
| Checklists | Server-authoritative resume — already correct |
| Counter board | Realtime→polling fallback — already correct; add a visible "working offline, refresh when back" banner state |
| Device swap | Follows from persisted drafts + server resume; validate in §25.5 |
| Full offline-first | **Rejected** — a click-and-collect shop with a single counter device does not justify an offline write queue; the paper fallback in the Owner Away contract (§13) covers a dead connection: serve by till + paper pad, back-fill PTM after (an explicit, owner-visible degraded mode, not silent divergence) |

## 21. Data, API and Workflow Contract Gaps

Minimum contracts for every recommended change (no migrations written here; existing entities reused wherever safe):

1. **`payment_events`** (new, append-only — no existing entity can hold money direction safely): `id, branch_id, order_id, direction ('sale'|'refund'), method ('cash'|'card'), amount_pence (server-derived), actor_id, reason (refunds), idempotency_key (unique), created_at`. Written in the same server action as serve-save / counter-collect / refund; compensating rows only; audit-logged. Degraded: if the event insert fails, the collect transition fails with it (one transaction boundary at the action level) — never a collected order with silently missing tender.
2. **Closing reconciliation** (no new table): closing session completion payload gains `expected_cash_pence, counted_cash_pence, cash_variance_pence, expected_card_pence, terminal_total_pence, card_variance_pence`; variance beyond threshold raises a warning `owner_alert`. Expected values are day-window computations over `payment_events` + the opening float payload.
3. **`order_amendments`** (new, append-only): `id, order_id, order_item_id, kind ('weight_adjust'|'substitute'|'remove'), old/new quantity + line totals, actor_id, reason, created_at`; order gains derived `final_subtotal`. Item snapshots stay immutable (INV-11 doctrine); collection uses final subtotal for the payment event. Idempotent per (item, kind, key).
4. **Refund workflow** (reuses): `payment_events(direction='refund')` + existing `admin_reverse_order_inventory` for the stock half (manager-gated; UI decides whether stock returns — refund without restock allowed, e.g. quality complaint where meat is discarded → refund + waste event instead).
5. **Alert lifecycle** (extends `owner_alerts`): `delivered_at, seen_at, claimed_by/claimed_at` (generalising the reconcile claim), `resolution_note`; per-kind action spec table in domain code (extending `RECONCILE_KINDS` into a full `ALERT_KINDS` registry — the two-kind tray already proves the pattern).
6. **External dispatch** (new, small): `alert_dispatches` log (`alert_id, channel, target, status, attempted_at`) + one configured channel for critical alerts and the daily digest; `owner_away_settings.owner_contact` already exists as the target field. Dispatch is at-least-once with the log making duplicates visible; digest send is idempotent per (branch, date).
7. **Product sale/inventory policy** (extends `products`): `inventory_policy ('kg_batch'|'untracked')`; serve/checkout allow each/box lines (order items already carry `unit_type` — verified `serve.ts:134-146`); all stock surfaces label untracked products explicitly. No each-batch or conversion tables now.
8. **Draft persistence** (no schema change): flows call `saveOperatorRun(status:'in_progress', steps)` at each mode transition; entry screens offer resume/discard from the run row.
9. **Compliance single path** (no schema change): checklist temperature steps write a compliance reading through the existing RPC alongside the checklist payload.
10. **Day receipt** (no new table): a server computation over existing sessions/orders/payment events/waste/alerts rendered on Today and linked from the closing receipt.

**Workflow coverage check (all 40 dossier workflows):** audited directly — WF-01/02 (§16), WF-03 (§16), WF-04 (§10), WF-05 (§14), WF-06/07 (§14), WF-08–WF-11 (§11), WF-12 (§18), WF-13–WF-17 (§10, §15, §18), WF-18/19 (§15), WF-22–WF-27 (§12, §13, §17), WF-28 (§18), WF-29 (§14, §16), WF-33 (§11), WF-34 (§15), WF-36 (§20). Explicitly grouped as adequate-and-unchanged after review — WF-20/21 (product/price administration: controlled RPCs + audit; no operational finding), WF-35 (supplier certificates — touched only by PTM-OPS-008), WF-37 (carcass intake: correct manager-grade tool; deliberately not operator work), WF-38/39 (schedules & pricing sign-off: adequate), WF-30–WF-32, WF-40 (backup/restore/release: out of re-audit scope per §3; owner-facing visibility only, §20/PTM-OPS-016).

## 22. Findings Register

21 findings: 2×O0, 7×O1, 8×O2, 4×O3. Priorities follow §10 definitions without inflation; confidence reflects evidence state, and every claim about real people is bounded by `FIELD_VALIDATION_REQUIRED`.

## PTM-OPS-001 — Money truth cannot be reconciled: tender, expected totals and till variance do not exist

**Priority:** O0
**Confidence:** High
**Actors affected:** Dad, Uncle Gul, counter staff, accountant
**Requirements affected:** OR-25, OR-27, OR-11, OR-29; GAP-06, GAP-15
**Workflows affected:** WF-04, WF-06, WF-07, WF-10, WF-29; simulation stages 3–4, 15, 20, 23–25
**Current evidence:** `VERIFIED_IMPLEMENTATION` — only `orders.payment_method` exists (dossier §12); counter Collect asks no tender (`counter-dashboard.tsx:316-330`); closing `cash_counted` is uncompared (`checklists.ts:76-81`); no `expected_cash`/variance code anywhere in `src/` (repo-wide search, §1); `ABSENT` — payment transaction/refund model.
**Current behaviour:** Walk-in sales record a method with no amount linkage; online collections record nothing about money; closing stores one number nobody reads; refunds unrepresentable.
**Failure scenario:** Saturday: 30 walk-ins (mixed tender), 12 online collections (tender unknown), one £15 refund given from the till. Gul counts £618. Nobody — including PTM — can say what the till *should* hold; a £40 discrepancy from theft, a mis-keyed card sale or an unrecorded refund are indistinguishable and invisible.
**Business consequence:** Takings cannot be trusted or handed to an accountant; theft/mistakes undetectable; Owner Away money summaries are unverifiable.
**Operator consequence:** Till count is meaningless labour; no confirmation the day "adds up".
**Owner consequence:** The first question every shop owner asks each evening has no answer.
**Root cause:** Payment was deliberately scoped out ("no online payment") and the pay-on-collection *till side* was never modelled at all — method was added for reporting flavour, not reconciliation.
**Recommended change:** Option B (§14): append-only `payment_events` at serve-save and counter-collect; refund direction; expected cash = float + cash sales − cash refunds; expected card = card sales − card refunds; closing shows expected vs counted plus a terminal Z-total step; variance stored and alerted past a threshold, never blocking.
**What the improved workflow looks like:** Collect = 2 taps (Collected → Cash/Card). Close: "Expected in till: £630.50. What did you count?" → variance shown plainly and saved. Morning briefing: "Took £412 yesterday — till matched."
**UI impact:** One tender dialog on the counter card; two closing step upgrades (expected shown; new terminal-total numeric); money line on Today; day receipt rows.
**Service/API impact:** Serve/collect actions write the payment event in the same boundary as the transition; closing completion computes expectations server-side.
**Data-model impact:** Contract 1–2 (§21).
**Process or training impact:** Staff learn one new tap; Gul's close gains one number to copy from the card machine; float discipline already exists.
**Migration or compatibility considerations:** Historic orders lack payment events — day receipt begins from go-live date; `payment_method` column stays as-is (events are the truth going forward).
**Validation:** §25.3 controlled reconciliation day: physical till vs expected within an agreed tolerance, deliberately seeded refund and mixed tenders all traced.
**Alternative considered:** (a) Process-only paper reconciliation — rejected, leaves PTM unable to answer money questions and Owner Away blind; (b) full terminal integration — rejected for now, hardware unknown (GAP-07) and Z-total comparison already reconciles card daily; (c) typing amounts per sale — rejected, amounts derive from server-priced orders, typing adds error surface.
**Why this is the smallest correct solution:** One append-only table + one tap + one closing step turns three numbers PTM already has (float, order subtotals, counted till) into a reconciliation. Nothing external is integrated, nothing is blocked, history is never edited.

## PTM-OPS-002 — Each/box products cannot be sold at the counter and have no stock truth

**Priority:** O0
**Confidence:** High
**Actors affected:** Uncle Gul, customers, Dad
**Requirements affected:** OR-01, OR-16, OR-22, OR-26; GAP-10; INV-09
**Workflows affected:** WF-04, WF-10; simulation stage 12
**Current evidence:** `VERIFIED_IMPLEMENTATION` — serve refusal `serve-lines.ts:89` ("Sold each, not by weight. Tell owner."); `deplete_order_inventory` filters kg (dossier §9); catalogue actively permits `each`/`box` units and online orders sell them (`ProductRow.unit_type`, `serve.ts:41`).
**Current behaviour:** A walk-in customer buying eggs, a whole chicken or a box item cannot be recorded by the operator at all; online orders containing such items collect with **no depletion and no signal** — those products simply have no physical stock representation.
**Failure scenario:** Queue of four; customer asks for a dozen eggs and 1kg of lamb. Gul records the lamb, gets "Tell owner" for the eggs, takes the money through the till anyway. PTM's revenue is now permanently short of the till's — which also poisons PTM-OPS-001's reconciliation — and it happens on the busiest days.
**Business consequence:** Revenue truth structurally incomplete for every non-kg product; owner cannot see what portion of trade bypasses the system.
**Operator consequence:** A dead end mid-queue, with escalation ("Tell owner") as the only scripted move for a perfectly ordinary sale.
**Owner consequence:** Interrupted for routine trade; blind spot in every report.
**Root cause:** INV-09 correctly refuses to *fake* each-as-kg; the sale path was blocked along with the depletion path, conflating order truth (safe to record) with stock truth (genuinely unmodelled).
**Recommended change:** Separate the two truths. (1) Serve gains a quantity picker for `each`/`box` products (1/2/3… taps), priced from the catalogue like kg lines — order and payment truth complete. (2) `products.inventory_policy = 'untracked'` for non-kg products, labelled honestly everywhere stock is shown ("not stock-tracked"). (3) Depletion continues to skip them — now by declared policy, not silence. Count-tracking for specific each-products only later, on Dad's evidence (§27, §29).
**What the improved workflow looks like:** Eggs: tap Serve → Eggs → "How many?" → 12 → Add more? → pay — same rhythm as kg, ~5 taps, no typing.
**UI impact:** One quantity screen in serve; "not stock-tracked" badges in inventory/purchasing.
**Service/API impact:** `resolveServeLines` accepts each/box with integer quantities; order items already carry `unit_type` and non-kg lines already bypass depletion safely.
**Data-model impact:** Contract 7 (§21) — one enum column; no new tables.
**Process or training impact:** One new question shape ("How many?"); Dad reviews which products are untracked during setup.
**Migration or compatibility considerations:** Existing each/box products default to `untracked` (states today's reality); INV-09's guarantee ("never silently treated as kg") is preserved and strengthened by labelling.
**Validation:** §25.2 Gul serves an each-product unprompted; §25.3 reconciliation day includes each-product sales in expected-cash maths.
**Alternative considered:** (a) Process-only — "each items go through the till only" — rejected: institutionalises the revenue blind spot; (b) full each/box conversion engine per `docs/v14/11-*` — rejected now: heavy, and stock lineage for eggs is not what blocks trade; (c) fake kg-equivalent batches — rejected: violates INV-09 honestly-held.
**Why this is the smallest correct solution:** It unblocks the sale (the O0 harm) with one enum and one screen, changes no depletion semantics, and defers stock tracking until evidence says which products need it.

## PTM-OPS-003 — Most owner alerts can never be actioned or resolved; there is no single owner work tray

**Priority:** O1
**Confidence:** High
**Actors affected:** Dad
**Requirements affected:** OR-12, OR-18, OR-09; CF-14
**Workflows affected:** WF-23, WF-24, WF-18; simulation stages 14, 16, 25
**Current evidence:** `VERIFIED_IMPLEMENTATION` + `VERIFIED_TEST` — tray pins exactly two kinds (`reconciliation.test.ts:12`); Away shows latest 8 of ≤20 unresolved read-only; no `acknowledged_at`/action route (dossier §13).
**Current behaviour:** Help, shortfall, checklist-skip, questionable-sale and details-check alerts accumulate open forever; the owner can read but never close them.
**Failure scenario:** Two weeks of normal trade produces a dozen shortfall/help/skip rows. The Away panel becomes a wall of stale red; the one new critical row is indistinguishable; Dad learns to ignore the panel — alert fatigue by design.
**Business consequence:** The escalation backbone loses signal value exactly as usage grows.
**Operator consequence:** "Tell owner" becomes a fiction Gul can sense (nothing ever comes back).
**Owner consequence:** Unbounded, unprioritisable backlog with no done state.
**Root cause:** Alerts were built per-source as write-only evidence; only the reconcile tray got the read/act/resolve half, for two kinds.
**Recommended change:** Generalise the proven reconcile pattern: extend `RECONCILE_KINDS` into a full `ALERT_KINDS` registry (per-kind action, resolution, auto-resolve — taxonomy §17); `/admin/reconcile` becomes the single owner work tray, grouped by kind, with claim/resolve/reopen; Today badge shows open count. Reclassify low-stock-during-sale out of alerts into the digest (§17).
**What the improved workflow looks like:** Today: "3 things need you" → tray → shortfall row → "Count this product" one-tap → count applied → alert auto-resolves.
**UI impact:** Tray sections + per-kind action buttons; Away's alert panel links into the tray instead of duplicating it.
**Service/API impact:** Resolve/claim server actions generalised from the existing reconcile action (claim-on-submit, reopen-on-failure semantics kept).
**Data-model impact:** Contract 5 (§21) — lifecycle columns; no new tables.
**Process or training impact:** Dad gets one place for all owner work; nothing new for Gul.
**Migration or compatibility considerations:** Existing open alerts adopt the registry; unknown historical kinds render with a generic "mark handled with note".
**Validation:** §25.1 Dad clears a seeded tray unaided; auto-resolve verified by applying a count against a shortfall alert.
**Alternative considered:** (a) Process-only — owner reviews audit log weekly — rejected: unprioritised and unresolvable; (b) new `/admin/alerts` route beside reconcile — rejected: two trays is how this problem started; (c) auto-expire old alerts — rejected: silently resolves without the work (§11 rule).
**Why this is the smallest correct solution:** The claim/resolve/reopen machinery already exists and is tested for two kinds; this extends a registry rather than building a subsystem.

## PTM-OPS-004 — Escalation and absence summaries never leave the app; Owner Away is not operationally credible

**Priority:** O1
**Confidence:** High
**Actors affected:** Dad, Uncle Gul
**Requirements affected:** OR-11 (NOT_MET), OR-12; CF-13; GAP-05, GAP-12
**Workflows affected:** WF-25, WF-26, WF-27; simulation stages 10, 19, 25
**Current evidence:** `VERIFIED_IMPLEMENTATION` — `createOwnerAlert` calls no dispatcher (`escalation.ts:71-124`); no scheduler/outbound sender exists (dossier §13); Away query caps verified (`owner-away.ts:193-234`); help flow never shows `owner_contact`; `DOCUMENTED_REQUIREMENT` — V17 §16 promised daily dispatch; `ABSENT` — any delivery proof.
**Current behaviour:** A critical fridge alert at 09:10 sits in a table until Dad happens to open the app; the "daily summary" renders only when manually visited; a busy week's counts can be silently undercounted by row caps.
**Failure scenario:** Dad is away (the headline V17 scenario). Fridge fails Saturday 08:40; Gul taps Help → "fridge problem" → calm confirmation. Dad is at the beach, app closed. Meat spoils by afternoon. The system recorded the emergency perfectly and told no one.
**Business consequence:** Stock loss, food-safety exposure; the week-away value proposition is fiction until this lands.
**Operator consequence:** Gul believes owner has been told; no phone number is shown as fallback.
**Owner consequence:** Cannot leave; or leaves blind.
**Root cause:** Alerting was built durable-first (correct) but delivery was deferred and never picked up; summary was built as a page, not a message.
**Recommended change:** (1) One external channel (SMS or WhatsApp via a single provider — Dad chooses, §27) for **critical severity only**, with an `alert_dispatches` log; (2) scheduled daily digest to the same channel implementing §13's contract ("nothing needs you today" when true); (3) help screen shows `owner_contact` with a tap-to-call button as the zero-infrastructure fallback; (4) Away counts computed by aggregate queries, caps kept only for row previews.
**What the improved workflow looks like:** Fridge help → alert row + SMS to Dad within a minute + "Call owner now" button with his number in front of Gul.
**UI impact:** Help screen phone button; Away settings gain channel config + last-dispatch status.
**Service/API impact:** One dispatch service + one scheduled job (the repo already runs scheduled GitHub workflows for backups — same pattern); digest idempotent per day.
**Data-model impact:** Contract 6 (§21).
**Process or training impact:** Dad keeps his phone on; Gul told "if it's urgent and no reply, ring — the number is on the Help screen."
**Migration or compatibility considerations:** Channel unconfigured → behaviour degrades to exactly today's (in-app only) with a visible "no delivery channel set" warning on Away/setup — never a silent half-state.
**Validation:** §25.4 staged trial: day-1 remote with seeded critical alert; receipt time measured. Do not claim OR-11 before stage 3.
**Alternative considered:** (a) Process-only — "Gul rings Dad" — partially adopted as the phone fallback, insufficient alone (depends on Gul judging severity); (b) in-app inbox only — rejected: absence means the app is closed; (c) native push app — rejected: new surface + install burden for one recipient; SMS/WhatsApp reaches Dad's existing phone.
**Why this is the smallest correct solution:** One channel, critical-only + one digest reuses the existing alert rows and scheduler pattern; the phone number on Help costs nearly nothing and de-risks everything else.

## PTM-OPS-005 — No refund, return or collected-order correction workflow exists

**Priority:** O1
**Confidence:** High
**Actors affected:** Dad, counter staff, customers
**Requirements affected:** OR-21, OR-27; CF-16; GAP-08
**Workflows affected:** WF-11, WF-12, WF-28; simulation stages 18, 22
**Current evidence:** `VERIFIED_IMPLEMENTATION` — `admin_reverse_order_inventory` exists with no calling route/action (dossier WF-12); no money-refund representation; post-collection cancel impossible; `ABSENT` — any refund UI/SOP.
**Current behaviour:** Once collected, an order is beyond correction: wrong item handed over, quality complaint, mistaken collection — PTM can record none of it. The shop will still give the customer their money back; PTM just won't know.
**Failure scenario:** Sunday roast returned Saturday 16:00 — off smell. Staff refund £22 cash from the till and bin the joint. PTM: revenue overstated by £22, till £22 "short" (once 001 exists this surfaces as an unexplained variance), waste unrecorded, no trace the complaint happened.
**Business consequence:** Money and stock truth silently diverge on exactly the events an owner most wants recorded; complaint history invisible.
**Operator consequence:** Handles the customer with no system backing; nothing to point at afterwards.
**Owner consequence:** Variances he cannot explain; disputes he cannot reconstruct.
**Root cause:** Refund was parked with "no online payment" reasoning, but pay-on-collection shops refund *cash/card at the till* — the DB half (reversal RPC) was built, the workflow half never was.
**Recommended change:** Manager-gated "Refund / fix this order" on the collected counter card and `/admin/orders` detail: choose full/partial (line-level), reason, and stock outcome (restock via existing reversal RPC / discard via waste event / no stock change); writes `payment_events(direction='refund')`; original order untouched; owner alert on refunds above a threshold. Plus the operator-side "I made a mistake" flag (§18) creating a tray task.
**What the improved workflow looks like:** Collected card → Refund → pick line(s) → reason → "Money back: £22 cash. Meat: binned." → confirm. Day receipt shows the refund; variance explains itself.
**UI impact:** One dialog on counter/admin order detail; tray task type for operator mistake flags.
**Service/API impact:** One server action orchestrating payment event + chosen stock compensation, idempotent per (order, reason).
**Data-model impact:** Contracts 1 and 4 (§21) — reuses the reversal RPC at last.
**Process or training impact:** Refund authority defined by Dad (§27); staff taught refunds go through the card, not around it.
**Migration or compatibility considerations:** None — purely additive; reversal RPC semantics (once per order+reason) already match.
**Validation:** §25.3 seeded refund traced through till variance, waste and day receipt; failure-first: double-tap refund (idempotent), refund exceeding order total (rejected server-side).
**Alternative considered:** (a) Process-only paper refund book — rejected: guarantees permanent till variance once 001 lands; (b) compensating negative order — rejected: pollutes order/revenue semantics and INV-21 filters; (c) full support-case entity — deferred (§29): a reason field on the refund covers the pilot.
**Why this is the smallest correct solution:** Composes three existing/planned primitives (reversal RPC, waste event, payment event) behind one dialog; no history rewritten, no new lifecycle states on orders.

## PTM-OPS-006 — Collected online orders record estimated weights and prices, not what was actually handed over

**Priority:** O1
**Confidence:** High
**Actors affected:** Counter staff, customers, Dad
**Requirements affected:** OR-16, OR-27, OR-28; GAP-10 (catch-weight), dossier §11 substitutions `ABSENT`
**Workflows affected:** WF-10, WF-05; simulation stages 11, 13
**Current evidence:** `VERIFIED_IMPLEMENTATION` — item snapshots immutable, price changes never rewrite orders (dossier §12); no amendment/substitution path; depletion consumes snapshot quantities.
**Current behaviour:** A 1.2kg-actual chicken sold as "~1kg est." collects at the estimated price; a substitution agreed by phone cannot be recorded; the customer pays a number PTM believes rather than the counter's scale.
**Failure scenario:** Ten catch-weight orders on a Saturday, each ±10% off estimate. Revenue misstated by up to ±£30, expected-card total (001) disagrees with the terminal by the same amount, and stock depletion consumed estimated rather than actual kg — three truths wrong from one cause.
**Business consequence:** Systematic revenue and stock error concentrated on the highest-value items; undermines 001's reconciliation from day one.
**Operator consequence:** Staff weigh, charge the real amount at the terminal, and then can't make PTM match.
**Owner consequence:** Explaining daily variance becomes normal, which teaches him to ignore variance — the worst possible lesson.
**Root cause:** Immutable snapshots (correct doctrine) with no compensating amendment event (missing half).
**Recommended change:** "Adjust at handover" on the ready/collect card: per-line actual weight (and price recomputed from the catalogue), substitution (swap to another product at its price), or line removal — all as `order_amendments` events (Contract 3); collection depletes and charges final quantities; customer-facing status shows the final line ("1.24kg @ £8.90/kg").
**What the improved workflow looks like:** Ready card → Adjust → tap line → type 1.24 → Collected → Cash/Card. Two extra taps + one number, only when weight differs.
**UI impact:** One amendment dialog on counter cards; final vs ordered shown with both visible.
**Service/API impact:** Amendment action; depletion reads final quantities (same RPC, quantity source changes at the call site); payment event uses final subtotal.
**Data-model impact:** Contract 3 (§21).
**Process or training impact:** Staff weigh at handover as they already physically do; the number now goes into PTM instead of only the till.
**Migration or compatibility considerations:** Orders without amendments behave exactly as today; amendment is optional per line.
**Validation:** §25.3 catch-weight order deliberately over/under weight, traced through depletion kg, payment event and day receipt; failure-first: amendment after collection rejected (collected is still terminal — fixes go through PTM-OPS-005).
**Alternative considered:** (a) Process-only — "charge the estimate, absorb the difference" — rejected: the shop already charges actuals at the till, PTM would stay wrong; (b) customer-facing re-approval flow for amendments — deferred: pay-on-collection means the customer is standing there agreeing in person; (c) making snapshots mutable — rejected: violates INV-11 doctrine.
**Why this is the smallest correct solution:** One append-only event type closes weight, substitution and removal simultaneously, keeps snapshots immutable, and only appears when reality differs from the estimate.

## PTM-OPS-007 — The serve flow never shows a price, so PTM cannot be the point of sale

**Priority:** O1
**Confidence:** High
**Actors affected:** Uncle Gul, customers
**Requirements affected:** OR-01, OR-26; A0.3 rehearsal
**Workflows affected:** WF-04; simulation stage 3
**Current evidence:** `VERIFIED_IMPLEMENTATION` — catalogue-line summary shows name+weight only (`operator-serve-flow.tsx:40-46`); save returns `"Saved."` (`serve.ts:381`); server computes `serveSubtotal` and shows it to no one.
**Current behaviour:** Gul must price every sale on the till/scale, take the money, then re-enter the sale into PTM — double entry with zero feedback on value.
**Failure scenario:** Rush hour: double entry is the step that gets dropped (each skipped sale silently breaks revenue and, after 001, till variance). Or the till says £11.20, PTM would have said £12.60 (stale till price) and nobody can notice because PTM never shows its number.
**Business consequence:** PTM's revenue is a shadow of the till's, drifting apart under exactly the load it exists to record; price discrepancies between catalogue and till are undetectable at the counter.
**Operator consequence:** Twice the work per sale, no payoff visible to him.
**Owner consequence:** Cannot trust that PTM's sales = actual sales.
**Root cause:** Serve was designed as a *record* of a sale already made at the till, not as the sale itself; the language firewall then hid even the total.
**Recommended change:** Show the server-computed line price on the amount screen and the order total on the confirm screen ("Save this sale? £12.60 — Paid by cash"); "Saved" repeats the total. This makes PTM the price authority the operator reads to the customer; the till becomes the cash drawer.
**What the improved workflow looks like:** Weigh on scale → tap preset → PTM shows £12.60 → customer pays → Cash → Save. One entry, not two.
**UI impact:** Price text on two existing screens; no new screens (prices are not analytics — INV-20/firewall unaffected: money the customer pays is operator-appropriate language).
**Service/API impact:** Expose the already-computed line/subtotal figures to the flow (a read of existing pricing, pre-save quote from catalogue data the page already loads).
**Data-model impact:** None.
**Process or training impact:** The rehearsal (A0.3, §25.2) now has a script: weigh → tap → read the price aloud.
**Migration or compatibility considerations:** None; `verify:operator-language` must be checked to permit "£" totals (it already permits prices in the price-entry screen).
**Validation:** §25.2 timed rehearsal target: kg sale ≤15s at the counter; till and PTM totals compared at day end (§25.3).
**Alternative considered:** (a) Keep till as price authority, PTM as log — rejected: double entry is the direct cause of missed records; (b) scale integration — deferred (§29): manual preset/typed grams is adequate at pilot volume.
**Why this is the smallest correct solution:** Displays two numbers the server already computes; removes an entire parallel workflow (till pricing) from the operator's day without touching any write path.

## PTM-OPS-008 — Opening ritual makes the operator vouch for certificate state; no expiry alert exists

**Priority:** O1
**Confidence:** High
**Actors affected:** Uncle Gul, Dad
**Requirements affected:** OR-23 (owner amendment A0.2); CF-12
**Workflows affected:** WF-01, WF-35; simulation stage 2
**Current evidence:** `VERIFIED_IMPLEMENTATION` — `certs_visible` step, `critical: true` (`checklists.ts:23-29`); no certificate-expiry alert generator found (dossier CF-12); supplier cert data with expiry dates exists in admin compliance.
**Current behaviour:** Every morning Gul must confirm "Halal & food-safety certificates on show" — a compliance judgement A0.2 explicitly moved to the owner; meanwhile a certificate can expire with no system consequence until a human notices.
**Failure scenario:** Certificate expired Tuesday; Gul keeps confirming "on show" in good faith (it *is* on show — it's just expired). The shop trades on an expired halal certificate with a daily record asserting all is well — worse than no record.
**Business consequence:** Trust/compliance exposure with false assurance attached.
**Operator consequence:** Asked to judge something he was explicitly not to be responsible for.
**Owner consequence:** Believes certificates are checked daily; they aren't — presence is, validity isn't.
**Root cause:** Checklist predates amendment A0.2; the expiry-alert half of A0.2 was never implemented.
**Recommended change:** Remove `certs_visible` from the opening definition (new checklist version — versioning already exists, dossier §9). Add a scheduled/system check: supplier document expiring within 30 days → owner alert (taxonomy §17), escalating at 7 days and to critical at expiry.
**What the improved workflow looks like:** Gul opens in 4 steps; Dad gets "Halal certificate for {supplier} expires in 7 days" in the tray/digest with a link to compliance.
**UI impact:** One step removed; one alert kind added.
**Service/API impact:** Expiry scan can run in the same scheduled job as the digest (PTM-OPS-004).
**Data-model impact:** None (documents carry expiry already).
**Process or training impact:** Dad owns certificate renewal explicitly; Gul's certificate involvement stays photo-capture only.
**Migration or compatibility considerations:** Checklist versioning preserves historical sessions; `verify:required-compliance` guard must be updated with the new definition version.
**Validation:** Seed an expiring document; alert appears at 30/7/0 days; Gul field test confirms nothing asks him about certificates.
**Alternative considered:** (a) Keep the step but soften wording — rejected: still assigns the judgement to the wrong person; (b) process-only calendar reminder for Dad — acceptable interim but invisible to the tray/digest and lost on phone change.
**Why this is the smallest correct solution:** Deletes a step (net friction reduction) and reuses the alert+digest machinery being built anyway.

## PTM-OPS-009 — Serve, delivery and waste lose all mid-flow progress on interruption

**Priority:** O1
**Confidence:** High
**Actors affected:** Uncle Gul
**Requirements affected:** OR-14 (register state CONFLICTED); GAP-13
**Workflows affected:** WF-04, WF-13, WF-16, WF-28; simulation stages 7, 21
**Current evidence:** `VERIFIED_IMPLEMENTATION` — flow state is React `useState` only (verified serve/stock/waste components); `operator_workflow_runs` already supports `status:'in_progress'` + `steps` and flows never write it before completion (`escalation.ts:31-56`); checklists, by contrast, resume from DB.
**Current behaviour:** A refresh, tab discard (common on tablets), crash or battery death mid-delivery discards up to 7 answered questions; the operator starts over.
**Failure scenario:** Supplier arrives during a queue (simulation 7). Gul is six screens into the delivery, serves a customer first, tablet sleeps and Safari discards the tab. Everything is gone; second attempt happens "later", i.e. sometimes never — the delivery becomes evening owner work from a photo of the invoice, or is lost.
**Business consequence:** Exactly the interruption-heavy moments (deliveries during service) are where records silently drop.
**Operator consequence:** Punished for being interrupted — the defining condition of his job.
**Owner consequence:** OR-14 promised recovery; he gets it only for rituals.
**Root cause:** Draft persistence was built for checklists and completed-run idempotency, and the middle of one-shot flows was left browser-local (a known gap, dossier §15).
**Recommended change:** Contract 8 (§21): flows call `saveOperatorRun(status:'in_progress', steps)` on each mode transition; flow entry screens offer "Carry on where you left off? / Start fresh" from the newest in-progress run; runs older than the day are discarded.
**What the improved workflow looks like:** Tablet dies mid-delivery → new device / reopened tab → Stock door shows "Carry on with the delivery you started?" → four answers already filled.
**UI impact:** One resume prompt per flow entry; no new screens.
**Service/API impact:** Reuses `saveOperatorRun` (already fire-and-forget safe); resume read is one query by operator+workflow+status.
**Data-model impact:** None — the table and columns exist.
**Process or training impact:** None — it simply stops losing work.
**Migration or compatibility considerations:** None; in-progress rows already exist conceptually (status enum includes it).
**Validation:** §25.5 device-swap and refresh drills mid-serve and mid-delivery; double-resume (two devices) must surface "already being finished elsewhere" via the run row.
**Alternative considered:** (a) localStorage drafts — rejected: doesn't survive device swap/failure, invisible to the owner; (b) full offline queue — rejected (§20); (c) shorter flows instead of drafts — already near-minimal, and drafts fix the general case.
**Why this is the smallest correct solution:** Zero schema change; writes the flows were arguably always meant to make; converts the existing runs table from idempotency-only into actual resume.

## PTM-OPS-010 — Closing ritual asks the operator to confirm work he cannot do in place

**Priority:** O2
**Confidence:** High
**Actors affected:** Uncle Gul
**Requirements affected:** OR-24, OR-22
**Workflows affected:** WF-02, WF-16; simulation stage 24
**Current evidence:** `VERIFIED_IMPLEMENTATION` — closing steps `waste_logged`/`stock_glance` carry `/admin/*` action hrefs (`checklists.ts:65,73`) which the operator skin never renders (§1); operator's only moves are confirm or "Not now".
**Current behaviour:** "Log today's waste — Yes/Not now" with no way to log waste from the ritual; confirming without doing is the path of least resistance.
**Failure scenario:** Gul taps Yes nightly (it feels required); waste was never recorded; tomorrow's intelligence and stock are built on a confirmed fiction — the record is worse than absence because it asserts completeness.
**Business consequence:** Waste/stock data quality decays invisibly; closing receipt overstates day completeness.
**Operator consequence:** Trained into ritual theatre.
**Owner consequence:** Trusts a confirmation that verifies nothing.
**Root cause:** One checklist definition serves two skins; the links assumed the admin skin.
**Recommended change:** Make the waste step evidence-aware: if waste events exist today → auto-note "3 items logged" and move on (automatic); if none → "Any waste today?" — "No waste" records an explicit claim; "Yes, log it" deep-links `/operator/waste` and returns to the ritual. Stock glance gets an operator-reachable link (view-only stock list or count door).
**What the improved workflow looks like:** Closing becomes partially self-answering; the operator only acts when reality needs input.
**UI impact:** One conditional step body in the operator checklist; return-to-ritual navigation.
**Service/API impact:** Step render reads today's waste count (already computed for Away).
**Data-model impact:** None.
**Process or training impact:** Removes a nightly judgement.
**Migration or compatibility considerations:** Checklist version bump as in PTM-OPS-008.
**Validation:** §25.2 closing rehearsal with and without waste.
**Alternative considered:** Rendering the admin hrefs in the operator skin — rejected: routes are role-blocked for the operator account (INV-19) and would 403.
**Why this is the smallest correct solution:** Converts a false confirmation into either an automatic fact or a real action, using data already queried elsewhere.

## PTM-OPS-011 — Two disconnected temperature truths (checklist payloads vs compliance readings)

**Priority:** O2
**Confidence:** High
**Actors affected:** Dad, counter staff
**Requirements affected:** OR-25, OR-29
**Workflows affected:** WF-01, WF-02, WF-03
**Current evidence:** `VERIFIED_IMPLEMENTATION` — dossier WF-03: operator checklist stores a generic coldest reading in checklist evidence, not via the three-field compliance RPC; `/counter/compliance` writes structured readings.
**Current behaviour:** The morning fridge number lives in a checklist payload; the compliance day record may show no opening reading unless counter staff duplicate the work.
**Failure scenario:** EHO-style review or owner audit: "show me temperature records" yields a complete-looking compliance log missing the operator's readings, or double entries that disagree (7:58 checklist says 3°C, 9:30 compliance says 5°C) with no linkage.
**Business consequence:** Compliance evidence fragmented; duplicated staff work.
**Operator consequence:** None visible (that's the problem).
**Owner consequence:** Cannot answer "were temperatures recorded?" from one place (dossier §16 lists both sources).
**Root cause:** Checklist capture (V10) and compliance capture (V12) evolved separately.
**Recommended change:** Checklist temperature steps also write a compliance reading through the existing RPC path (Contract 9); compliance day view becomes the single temperature truth; counter compliance remains for additional readings.
**What the improved workflow looks like:** Gul types one number at opening; it appears in the compliance log automatically; counter staff add midday readings only.
**UI impact:** None for the operator; compliance page shows source ("recorded at opening").
**Service/API impact:** Checklist record action calls the compliance RPC for temperature steps.
**Data-model impact:** None.
**Process or training impact:** Removes duplicate temperature-taking.
**Migration or compatibility considerations:** Historical checklist payloads stay as-is; unification is forward-only.
**Validation:** One opening → one row in compliance readings; `verify:required-compliance` still green.
**Alternative considered:** Redirecting the checklist step to the counter compliance form — rejected: breaks the one-question ritual and the route lock.
**Why this is the smallest correct solution:** One write-path addition; no new capture UI; deletes a duplication instead of managing it.

## PTM-OPS-012 — Accepted online orders create no promised-stock signal

**Priority:** O2
**Confidence:** Medium
**Actors affected:** Dad, counter staff
**Requirements affected:** OR-16, OR-18; dossier §11 "stock held for orders" `ABSENT`
**Workflows affected:** WF-05, WF-10, WF-18/19; simulation stage 16
**Current evidence:** `VERIFIED_IMPLEMENTATION` — no reservation; oversell handled after the fact by shortfall (INV-15).
**Current behaviour:** Purchasing/Today ignore uncollected commitments; the same 3kg can be sold over the counter at noon and promised for a 5pm collection.
**Failure scenario:** Two pre-orders for tomorrow's brisket; Gul sells the last brisket at lunch with no warning; both collections shortfall; two customers disappointed on the same product in one day.
**Business consequence:** Predictable disappointments the data could have prevented; shortfall alerts that were avoidable.
**Operator consequence:** Blamed for selling what the system happily recorded.
**Owner consequence:** Recurring avoidable alerts.
**Root cause:** Reservation was consciously deferred (dossier §5 future goals); the *soft* signal went with it.
**Recommended change:** Not hard reservation. A computed "promised kg today/tomorrow" per product (open orders' snapshot quantities) surfaced: on purchasing/inventory views, and as a low-stock nudge in serve when a sale would cut into promised kg ("Also promised for collection today — still sell?" Yes/No). Advisory, never blocking.
**What the improved workflow looks like:** Gul gets one honest question at the moment it matters; Dad sees promised vs on-hand in purchasing.
**UI impact:** One conditional interstitial in serve; one column in purchasing/inventory.
**Service/API impact:** One aggregate query over open orders; serve action passes a flag.
**Data-model impact:** None.
**Process or training impact:** None.
**Migration or compatibility considerations:** None.
**Validation:** Seeded promised order + serve of same product shows the nudge; §25.3 checks it against a real day.
**Alternative considered:** (a) Hard reservation with expiry — rejected: no-shows would strand stock and demand a release workflow; (b) do nothing (status quo: explicit shortfall) — defensible but leaves predictable disappointments; the advisory is one query.
**Why this is the smallest correct solution:** Pure computation over existing data; keeps the honest no-reservation model while removing its main sting.

## PTM-OPS-013 — Duplicated surfaces: admin open/close skins and counter detail route

**Priority:** O2
**Confidence:** High
**Actors affected:** Dad, manager, staff
**Requirements affected:** OR-09; V16 convergence doctrine
**Workflows affected:** WF-01, WF-02; route inventory §9
**Current evidence:** `VERIFIED_IMPLEMENTATION` — `/admin/open|close` render the same definitions via GuidedChecklist (dossier §6 "duplicates operator skin"); `/counter/orders/[id]` duplicates card content read-only.
**Current behaviour:** Two ritual skins to maintain and test (ops-capture E2E covers the admin skin; operator skin has a coverage gap — dossier §19); a near-empty detail route.
**Failure scenario:** A checklist change ships tested on the admin skin and subtly broken on the operator skin — the exact user least able to cope gets the least-tested surface.
**Business consequence:** Maintenance drag and asymmetric test risk on the critical user's path.
**Operator consequence:** None directly.
**Owner consequence:** None directly.
**Root cause:** V10 built admin rituals; V17 reskinned for operators without retiring the original.
**Recommended change:** Retire `/admin/open` and `/admin/close` (redirect to `/operator/open|close` — already accessible to manager/owner ranks per dossier §6 "owner preview"); fold counter detail into an expanding board card; point the ops-capture E2E at the surviving skin.
**What the improved workflow looks like:** One ritual surface for everyone; E2E covers the skin Gul uses.
**UI impact:** Two redirects; one expanding card.
**Service/API impact:** None (same actions).
**Data-model impact:** None.
**Process or training impact:** Managers see the operator skin (larger, simpler) — no capability lost, receipts identical.
**Migration or compatibility considerations:** Keep redirects permanently (bookmarks); update tests/guards referencing the retired routes.
**Validation:** ops-capture E2E green against `/operator/*`; route inventory count drops by 3.
**Alternative considered:** Keeping both skins with shared test fixtures — rejected: the duplication is the cost, fixtures don't remove it.
**Why this is the smallest correct solution:** Deletes surfaces instead of adding; zero backend change.

## PTM-OPS-014 — No day-completeness receipt: "is today done and does it add up?" has no single answer

**Priority:** O2
**Confidence:** High
**Actors affected:** Dad
**Requirements affected:** OR-10, OR-29; dossier §16 "single completeness certificate" CONFLICTED
**Workflows affected:** WF-22, WF-29; simulation stages 24–25
**Current evidence:** `VERIFIED_IMPLEMENTATION` — component states exist (checklists, compliance, alerts, orders) but no unified day view (dossier §16).
**Current behaviour:** Answering "is yesterday complete?" means visiting Today + Away + reconcile + orders + inventory.
**Failure scenario:** Dad checks Today Monday morning; nothing flags that Saturday was never closed, its till uncounted and two collections uncollected-tender — each fact lives on a different screen; the week's books quietly rot.
**Business consequence:** Incomplete days accumulate undetected; month-end cleanup becomes archaeology.
**Operator consequence:** None.
**Owner consequence:** The 30-second promise fails on the most basic managerial question.
**Root cause:** All the states exist; nothing composes them (built page-by-page).
**Recommended change:** A computed **day receipt** (Contract 10): opened/closed by whom, sales count + takings + tender split + variances, deliveries (costs pending), waste, shortfalls, amendments/refunds, temperatures recorded, open alerts — each line linking to its source. Rendered as a Today card ("Yesterday: complete ✓ / 2 things missing") and archived per date on `/admin/orders` day view.
**What the improved workflow looks like:** One glance answers "complete?"; every anomaly is one tap from its evidence — directly serving OR-29.
**UI impact:** One Today card + one day view section.
**Service/API impact:** One aggregation service over existing tables (much of it exists in the Away summary already).
**Data-model impact:** None.
**Process or training impact:** None.
**Migration or compatibility considerations:** Receipt is honest about pre-payment-model dates ("money truth begins {date}").
**Validation:** §25.1 Dad: "was yesterday complete? what's missing?" answered from one screen in <30s.
**Alternative considered:** Extending the Away summary to always-on — rejected: Away is windowed for absence, the receipt is per-day and needs completeness semantics, not aggregates.
**Why this is the smallest correct solution:** Pure composition of existing facts; no capture added.

## PTM-OPS-015 — Ran-out reports and shortfall alerts dead-end instead of feeding purchasing

**Priority:** O2
**Confidence:** Medium
**Actors affected:** Dad
**Requirements affected:** OR-18, OR-09
**Workflows affected:** WF-13 (ran-out branch), WF-18; simulation stage 14
**Current evidence:** `VERIFIED_IMPLEMENTATION` — ran-out creates an alert; purchasing intelligence recomputes independently from stock/order data; no linkage (dossier §7, §13).
**Current behaviour:** The human signal ("we ran out of X, a customer wanted it") and the computed signal (purchasing recommendations) never meet.
**Failure scenario:** Gul reports ran-out on mince three Fridays running; purchasing's window maths doesn't weight the *lost* demand (unsold ≠ undemanded); Dad keeps under-ordering and the report feels pointless to Gul.
**Business consequence:** Lost-sale signal — the most valuable demand data a shop has — is collected then wasted.
**Operator consequence:** Reports feel ignored.
**Owner consequence:** Buying decisions miss known demand.
**Root cause:** Alerts and intelligence are separate subsystems.
**Recommended change:** Ran-out/shortfall alerts for a product annotate that product's purchasing recommendation ("ran out 3× this month — demand exceeds stock") and resolve into the tray with a one-tap "add to next order" acknowledgement.
**What the improved workflow looks like:** Gul's report visibly changes Dad's buying screen; the loop closes.
**UI impact:** One annotation line in purchasing; tray action.
**Service/API impact:** Purchasing service joins open/recent ran-out alerts by product.
**Data-model impact:** None (alerts already carry entity refs).
**Process or training impact:** None.
**Migration or compatibility considerations:** None.
**Validation:** Seeded ran-out appears on purchasing within the same day.
**Alternative considered:** Full demand-forecast adjustment — rejected: annotation gives Dad the fact; the doctrine keeps judgement with him.
**Why this is the smallest correct solution:** A join, not a model.

## PTM-OPS-016 — Backup freshness and drill state are invisible to the owner

**Priority:** O2
**Confidence:** High
**Actors affected:** Dad
**Requirements affected:** OR-30 (owner-facing half); §5.16 scope; GAP-02, GAP-11
**Workflows affected:** WF-30, WF-40
**Current evidence:** `VERIFIED_IMPLEMENTATION` — freshness exists in `/api/health` JSON and the owner-only releases page (dossier §16); `VERIFIED_DRILL` — recovery evidence lives in runbooks; `ABSENT` — any owner-legible surface, failure signal, or drill schedule owner.
**Current behaviour:** A silently failing backup degrades health JSON that no owner reads; the certified drill is invisible; photo bytes are excluded from logical backup with no stated owner decision.
**Failure scenario:** Backups fail for three weeks (the July master audit's 30/30 failure already happened once — CF-01); nobody notices until a restore is needed.
**Business consequence:** The recovery capability that was expensively certified decays without a human noticing.
**Operator consequence:** None.
**Owner consequence:** Owns a risk he cannot see.
**Root cause:** Recovery was built as an engineering capability with engineering-facing telemetry.
**Recommended change:** (1) Setup/releases surface one plain sentence: "Last good backup: yesterday 02:10 ✓ / ⚠ No good backup for 6 days — tell support"; stale/failed state also raises a warning owner alert into the tray (delivered via 004's digest). (2) Quarterly drill gets an owner (named person) and a scheduled tray task. (3) Photo bytes: put the decision to Dad (§27) — accept loss of photos on disaster, or add a storage-object export to the backup workflow (S).
**What the improved workflow looks like:** Backup failure becomes ordinary owner work within a day, not a discovery during a disaster.
**UI impact:** One sentence + one alert kind.
**Service/API impact:** Reads the existing freshness ledger (`ops_backup_runs`).
**Data-model impact:** None.
**Process or training impact:** Drill calendar entry with a named owner.
**Migration or compatibility considerations:** None.
**Validation:** Simulated stale ledger row → tray alert + digest line.
**Alternative considered:** Email from CI on failure — rejected as sole channel: decoupled from the owner's one work tray; fine as a redundant extra.
**Why this is the smallest correct solution:** Surfaces an existing ledger through the existing alert path; no new recovery machinery (per §3 non-goals).

## PTM-OPS-017 — Photo uploads have no pending/retry affordance and weak-network behaviour is unproven

**Priority:** O2
**Confidence:** Medium
**Actors affected:** Uncle Gul
**Requirements affected:** OR-13, OR-14; GAP-13
**Workflows affected:** WF-36; simulation stage 21
**Current evidence:** `VERIFIED_IMPLEMENTATION` — upload failure is shown and can be retried; parent record survives; no queue/pending state (dossier §15); `FIELD_VALIDATION_REQUIRED` — no weak-network exercise has ever run.
**Current behaviour:** On slow Wi-Fi an upload spins/fails; retry is manual and immediate; there's no "will finish later" state.
**Failure scenario:** Delivery photo fails on weak Wi-Fi; Gul, mid-queue, abandons it; the cost-pending alert arrives without its evidence; Dad reconciles a delivery he can't see.
**Business consequence:** Evidence quality degrades exactly when the shop is busiest.
**Operator consequence:** A chore that punishes patience.
**Owner consequence:** Blind reconciliation.
**Root cause:** Upload built as a synchronous step; connectivity assumptions untested (GAP-13).
**Recommended change:** Visible pending state with one-tap retry attached to the created evidence row (status `failed` already exists in the schema — dossier §9); the flow completes regardless (already true) and the failed upload appears as a retry chip on the operator home until sent or discarded. Run the §25.5 drill before building more than this.
**What the improved workflow looks like:** "Photo will finish sending — carry on" instead of a spinner standoff.
**UI impact:** Retry chip on home; status text in flows.
**Service/API impact:** Evidence status transitions already modelled.
**Data-model impact:** None.
**Process or training impact:** None.
**Migration or compatibility considerations:** None.
**Validation:** §25.5 throttled-network drill: upload fails → chip → retry succeeds → evidence linked.
**Alternative considered:** Service-worker background sync — rejected: offline-first machinery for one artefact type (§20 ruling).
**Why this is the smallest correct solution:** Reuses the evidence status field; adds an affordance, not an architecture.

## PTM-OPS-018 — Analysis hub carries metrics that neither drive decisions nor confirm health

**Priority:** O3
**Confidence:** Medium
**Actors affected:** Dad, manager
**Requirements affected:** OR-09; §5.3 metric bar
**Workflows affected:** WF-22 periphery
**Current evidence:** `VERIFIED_IMPLEMENTATION` — 5 KPIs + expandable business panels (dossier §8); `INFERRED` — which panels Dad actually uses is unknown (GAP-03).
**Current behaviour:** The hub offers curiosity-depth (basket patterns, long-window product tables) beside decision surfaces that already exist (purchasing).
**Failure scenario:** No acute failure — slow attention tax and the perception that PTM is "a lot of screens", eroding OR-10's promise.
**Business consequence:** Cognitive load without decisions.
**Operator consequence:** None (firewalled).
**Owner consequence:** More to ignore.
**Root cause:** V16 compressed but deliberately kept an analysis hub; the metric census was never run against §5.3's bar.
**Recommended change:** Census each panel against the four allowed purposes (decide / confirm health / explain discrepancy / support process); move buying-adjacent depth into `/admin/purchasing`, park the rest behind a single "More detail" disclosure. Do this **after** observing which panels Dad opens (§25.1) — evidence-led removal, not taste-led.
**What the improved workflow looks like:** Hub = health confirmation + doors; depth lives where the decision lives.
**UI impact:** Panel relocation/disclosure only.
**Service/API impact:** None.
**Data-model impact:** None.
**Process or training impact:** None.
**Migration or compatibility considerations:** Respect `verify:surface-convergence` and owner-brain compliance guards.
**Validation:** Dad finds nothing he used has disappeared (§25.1 follow-up).
**Alternative considered:** Deleting panels now — rejected: no usage evidence yet.
**Why this is the smallest correct solution:** Rearranges rendering; nothing is computed or captured differently.

## PTM-OPS-019 — Guided decision walk records no completion

**Priority:** O3
**Confidence:** High
**Actors affected:** Dad
**Requirements affected:** OR-07 periphery
**Workflows affected:** WF-22 (walk variant)
**Current evidence:** `VERIFIED_IMPLEMENTATION` — dossier §8: walk progress is browser-only, "does not mark tasks done".
**Current behaviour:** Finishing the walk changes nothing; Later items never age or resolve.
**Failure scenario:** Dad walks his actions, closes the tab, reopens — everything is "to do" again; the walk feels like a toy and stops being used.
**Business consequence:** Minor — Today cards remain the primary path.
**Operator consequence:** None.
**Owner consequence:** Mild distrust of the guided mode.
**Root cause:** Walk was shipped as presentation-only.
**Recommended change:** Either record a lightweight "reviewed" mark per action for the day (reuses action ids; presentation-state only, no business writes), or retire the walk route and keep numbered Do-now cards. Decide after §25.1 (does Dad use it at all?).
**What the improved workflow looks like:** Walked items show as reviewed today, or the route is gone.
**UI impact:** Minimal either way.
**Service/API impact:** One per-day preference write, or none.
**Data-model impact:** None significant.
**Process or training impact:** None.
**Migration or compatibility considerations:** None.
**Validation:** §25.1 usage observation.
**Alternative considered:** Marking business tasks "done" from the walk — rejected: Do-now items resolve by doing the work, not by declaring it (owner-brain doctrine).
**Why this is the smallest correct solution:** Observation first; the fix is either one flag or one deletion.

## PTM-OPS-020 — SMS provider state is honest per order but invisible as configuration

**Priority:** O3
**Confidence:** High
**Actors affected:** Dad, customers
**Requirements affected:** OR-28 periphery
**Workflows affected:** WF-09
**Current evidence:** `VERIFIED_IMPLEMENTATION` — `sms_log` records disabled/failed/sent honestly (dossier WF-09); `ABSENT` — any setup/health surfacing of provider state.
**Current behaviour:** If no SMS provider is configured, every "Mark Ready" quietly logs disabled; customers simply never hear.
**Failure scenario:** Weeks of "why didn't you text me?" complaints before anyone connects them to a blank env var.
**Business consequence:** Customer experience degrades with no signal to the owner.
**Operator consequence:** None.
**Owner consequence:** Discovers configuration state through complaints.
**Root cause:** Honest per-event logging without an aggregate view.
**Recommended change:** Setup page line + day receipt line: "Customer texts: working / not set up / failing (last 3 failed)" from `sms_log` aggregates; failing streak raises a warning alert.
**What the improved workflow looks like:** Configuration state is a visible fact, not an inference.
**UI impact:** One setup line, one receipt line.
**Service/API impact:** One aggregate query.
**Data-model impact:** None.
**Process or training impact:** None.
**Migration or compatibility considerations:** None.
**Validation:** Toggle provider env in staging → line changes.
**Alternative considered:** Building the SMS provider integration itself — separate decision (§29); this finding only makes the current truth visible.
**Why this is the smallest correct solution:** Surfaces an existing log.

## PTM-OPS-021 — Stock count is typing-heavy and unprioritised

**Priority:** O3
**Confidence:** Medium
**Actors affected:** Dad, Uncle Gul (glance), manager
**Requirements affected:** OR-16
**Workflows affected:** WF-34
**Current evidence:** `VERIFIED_IMPLEMENTATION` — per-batch numeric entry with stale-guard (dossier §8); confidence signal (`trusted/count_soon/count_today`) exists and routes to Count (dossier §11) — `INFERRED`: count screen ordering by risk not confirmed.
**Current behaviour:** Counting is a flat batch list; the operator/owner types kg per batch.
**Failure scenario:** Full counts feel long → happen rarely → confidence decays shop-wide, when counting the five riskiest batches would keep trust high.
**Business consequence:** The reconciliation loop that keeps stock honest runs less often than it could.
**Operator consequence:** Tedium.
**Owner consequence:** Staler stock truth.
**Root cause:** Count built for completeness, not cadence.
**Recommended change:** "Count these 5 first" ordering from the existing confidence signal; allow finishing after the priority subset (partial counts already work — count lines are per-batch). Defer any hardware (scale) integration.
**What the improved workflow looks like:** A 3-minute daily micro-count replaces a monthly slog.
**UI impact:** Ordering + a "priority done" waypoint.
**Service/API impact:** Reuses reconciliation views.
**Data-model impact:** None.
**Process or training impact:** Encourage the micro-count at closing glance.
**Migration or compatibility considerations:** None.
**Validation:** §25.3 counts before/after ordering change; confidence distribution over two weeks.
**Alternative considered:** Mandatory daily full count — rejected: burden guarantees non-compliance.
**Why this is the smallest correct solution:** Reorders an existing list by an existing signal.

## 23. Recommended Target Operating Model

**Operator (Uncle Gul) —** *start of day:* one lead door → 4-step opening (certificates removed; temp writes compliance), float prefilled. *Customer service:* serve = weigh → tap product → tap amount (or "how many?" for each items) → **read PTM's price to the customer** → cash/card → save; one entry, ≤15s target. *Delivery:* guided kg flow with defaults; drafts survive interruption; unknown things escalate. *Waste:* unchanged. *Unusual events:* Help shows owner's number and guarantees delivery of critical alerts; "I made a mistake" creates owner work instead of silence. *End of day:* close ritual that shows expected till money, absorbs the terminal total, and self-answers the waste question.

**Counter staff —** Counter **remains a specialised online-order board** (recommendation: keep separate; do not merge into Operator). Prep/ready unchanged; at handover: adjust weight/substitute if reality differs → Collected → Cash/Card. Refund lives on the collected card (manager-gated). Compliance page continues for structured readings.

**Owner (Dad) —** *each morning:* digest (external) + Today: money line ("Took £412 — till matched"), briefing, ≤3 Do-now, tray badge, yesterday's day receipt. *During the day:* nothing, unless the tray badge or an urgent ping says otherwise. *Urgent exception:* SMS/WhatsApp ping → one tap to the alert → act or call. *Away:* same digest daily; the §13 contract governs what Gul decides alone. *At closing:* nothing required — the receipt forms itself. *Weekly:* purchasing + week money summary. *On return:* tray review + count prompt + week receipt.

**System —** *infer:* prices, expected till/card, promised kg, waste-logged state, day completeness. *verify:* required readings, idempotency, stale counts. *record:* every tender, amendment, refund, correction as append-only events. *block:* only invalid transitions, duplicate submissions and skipped required readings — never variances. *warn:* variance past threshold, promised-stock conflicts, expiring certificates, failing backups/SMS. *escalate:* critical severity externally with delivery logging. *reconcile:* till and terminal daily; stock by prioritised micro-counts. *summarise:* daily digest + day receipt automatically.

**Workflow ownership matrix:**

| Workflow | Operator | Counter | Owner | System |
| --- | --- | --- | --- | --- |
| Open/close ritual | **owns** | — | reviews receipt | computes expected money, writes compliance readings |
| Walk-in sale (kg + each) | **owns** | — | sees in receipt | prices, records tender |
| Online order prep/ready/collect | — | **owns** | exceptions only | depletes once, records tender, dispatches SMS |
| Handover adjust / substitute | — | **owns** | threshold alerts | amendment events |
| Refund | flags mistake | manager executes | **authorises policy** | compensating events |
| Delivery / waste / ran-out | **owns** | — | costs & reviews via tray | defaults, drafts, alerts |
| Stock counts | glance | — | **owns** (or manager) | prioritises by confidence |
| Alerts | creates | creates | **resolves in one tray** | dedupes, auto-resolves, delivers critical |
| Money reconciliation | counts till | — | reads variance | **owns the maths** |
| Certificates | photographs paper | — | **owns validity** | expiry alerts |

## 24. Prioritised Improvement Programme

Relative scope only (XS/S/M/L/XL); no calendar estimates.

**Phase A — Truth and trade blockers (O0)**

| Order | Finding | User outcome | Dependencies | Estimated scope | Validation gate | Do not start until |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | PTM-OPS-001 | Every collection records tender; closing shows expected vs counted with saved variance; morning money line | none | M | §25.3 reconciliation day within agreed tolerance | Dad decides variance threshold + accepts +1 collect tap (§27) |
| A2 | PTM-OPS-002 | Gul can sell each/box items in the normal serve rhythm; untracked stock labelled honestly | none (parallel to A1) | M | §25.2 Gul serves an each item unaided; each sales appear in expected cash | Dad lists each/box products and confirms `untracked` policy (§27) |

**Phase B — Owner requirement closure (O1)**

| Order | Finding | User outcome | Dependencies | Estimated scope | Validation gate | Do not start until |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | PTM-OPS-004 | Critical alerts reach Dad's phone; daily digest; help shows his number; away counts uncapped | channel choice (§27) | M | §25.4 stage 1–2: seeded critical alert received < 5 min | Dad picks channel + urgent list |
| B2 | PTM-OPS-003 | One tray; every alert kind actionable; auto-resolve on completed work | B1 helpful, not required | M | Dad clears seeded tray unaided (§25.1) | — |
| B3 | PTM-OPS-005 | Refunds/mistaken collections recorded with money+stock+reason; operator mistake flag | A1 (payment events) | S | §25.3 seeded refund traces end-to-end | Dad sets refund authority (§27) |
| B4 | PTM-OPS-006 | Handover weight/substitution recorded; final subtotal drives tender and depletion | A1 | M | §25.3 catch-weight order traces end-to-end | — |
| B5 | PTM-OPS-007 | PTM shows the price; single-entry sales | A2 (each lines priced too) | S | §25.2 timed serve ≤15s; till vs PTM totals match at day end | — |
| B6 | PTM-OPS-009 | Interrupted flows resume on any device | none | S | §25.5 refresh/device-swap drills | — |
| B7 | PTM-OPS-008 | Certificates leave Gul's morning; expiry alerts to tray/digest | B2 (tray) | XS | expiring seed doc alerts at 30/7/0 | — |

**Phase C — Workflow simplification (O2)**

| Order | Finding | User outcome | Dependencies | Estimated scope | Validation gate | Do not start until |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | PTM-OPS-014 | Day receipt answers "complete + adds up?" in one glance | A1 | S | §25.1 Dad <30s on "was yesterday complete?" | — |
| C2 | PTM-OPS-010 | Closing self-answers waste; in-flow waste path | none | S | §25.2 closing rehearsal | — |
| C3 | PTM-OPS-011 | One temperature truth | none | S | compliance log shows opening reading | — |
| C4 | PTM-OPS-012 | Promised-kg nudge + purchasing column | none | S | seeded promised-order nudge fires | — |
| C5 | PTM-OPS-013 | −3 duplicated surfaces; E2E on the operator skin | none | S | route inventory + green E2E | — |
| C6 | PTM-OPS-015 | Ran-out reports visibly feed buying | B2 | XS | seeded ran-out annotates purchasing | — |
| C7 | PTM-OPS-016 | Backup freshness as owner work; drill owned | B2 | S | stale ledger → tray alert | Dad decides photo-bytes question (§27) |
| C8 | PTM-OPS-017 | Upload pending/retry chip | B6 | S | §25.5 throttled-upload drill | — |

**Phase D — Evidence-led enhancements (O3 + deferred)**

| Order | Finding | User outcome | Dependencies | Estimated scope | Validation gate | Do not start until |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | PTM-OPS-021 | Prioritised micro-counts | none | S | confidence distribution improves over 2 weeks | §25.3 baseline exists |
| D2 | PTM-OPS-018 | Leaner analysis hub | none | S | Dad misses nothing (§25.1) | hub usage observed |
| D3 | PTM-OPS-019 | Walk resolves or retires | none | XS | usage observation | §25.1 |
| D4 | PTM-OPS-020 | SMS state visible | none | XS | staging toggle test | — |
| D5 | §29 items (terminal API, PO matching, each-count stock, scale/barcode, receipts, offline queue, support cases) | as listed | field evidence | M–XL each | per item | real-shop evidence demands it |

## 25. Validation Programme

All sessions recorded (time, wrong taps, questions asked, abandonments, interventions, misread wording, incorrect records, self-reported confidence). No requirement graduates to `FULLY_MET` on repository evidence alone.

**25.1 Dad validation** — on his own phone, unaided beyond "open the app": (1) explain Today in his own words ≤30s (timed); (2) identify and start the top action; (3) answer "what did we take yesterday and did the till match?" (post-Phase-A); (4) find and clear a seeded owner-work tray (post-B2); (5) explain a payment/stock discrepancy from the day receipt links; (6) review a day remotely; (7) trace why a product's stock changed; (8) say whether the shop is ready for tomorrow. Also observe (don't ask) which analysis panels he opens — feeds D2/D3.

**25.2 Uncle Gul validation** — brief intro only, then unaided on the real counter device: open the shop; serve a kg customer (timed, target ≤15s at the counter); serve an each item (post-A2); record cash then card sales; receive a delivery **while a queue forms** (interruption included); report a ran-out; record waste; deliberately enter a wrong weight and recover ("I made a mistake" flag, post-B3); use Help; close the shop including the money step. Record all §16.2 measures; wording he misreads goes straight back into `verify:operator-language` review.

**25.3 Physical reconciliation day** — controlled full trading day: blind-count opening stock; trade normally including seeded events (each-item sale, catch-weight adjustment, substitution, one refund, one deliberate wrong-weight correction, mixed tenders); at close compare physical stock vs PTM per product, counted cash vs expected, terminal Z-total vs expected card, waste bin vs waste records; every variance must be explainable from the day receipt's links. Tolerances agreed with Dad beforehand; results recorded in `docs/audits/` as the Phase A/B exit evidence.

**25.4 Owner-away trial (staged)** — (1) Dad on-site but hands-off for one day (intervenes only if called); (2) Dad remote one day — seeded critical alert, receipt time measured; (3) several consecutive remote days with daily digests; (4) one planned exception (supplier shortage or fridge drill) injected. OR-11 remains NOT_MET until stage 3 completes with the §13 contract holding and no undelivered critical alert.

**25.5 Weak-network and device drill** — throttled connection: mid-serve save, mid-delivery refresh, browser close and resume, device swap mid-flow (post-B6), photo upload failure and retry chip (post-C8), double-tap every final button, counter realtime cut (polling banner), alert delivery delay measured. Any silent loss or duplicate is a release blocker for the phase that introduced the surface.

## 26. Alternatives Rejected

| Alternative | Rejected because |
| --- | --- |
| Card-terminal API integration now | Hardware unknown (GAP-07/14); Z-total reconciliation achieves daily card truth at zero integration risk; revisit with field evidence |
| Full offline-first architecture | Single-device click-and-collect shop; drafts + retries + paper fallback cover the realistic failure modes (§20) |
| Full each/box conversion engine (docs/v14/11) | Stock lineage for each-items isn't what blocks trade; order/money truth first; count-tracking only for products Dad names |
| Full butcher ERP (PO, invoice matching, transformation ledger, recalls) | Data entry the shop cannot sustain; process-only handling + trace fields suffice at pilot scale |
| Standalone corrections centre | Corrections belong in context (counter card, tray, ritual); a centre adds navigation and hides consequence |
| Separate new `/admin/alerts` route | Extending the proven reconcile tray avoids two inboxes |
| Merging Counter into Operator Mode | Board workflow would re-expose Gul to complexity OR-04 exists to prevent; the roles are genuinely different |
| Blocking closing on till variance | Teaches figure-fitting; capture honestly and escalate instead |
| Hard stock reservation for online orders | Strands stock on no-shows and demands a release workflow; advisory promised-kg signal is one query |
| Native push app for the owner | New install surface for one recipient; SMS/WhatsApp reaches the phone he already carries |
| Auto-expiring old alerts | Resolves work without doing it — violates the failure-first rules |
| Statutory accounting features | Out of scope; period CSV export gives the accountant everything |

## 27. Decisions Requiring Dad's Input

Only decisions that repository evidence cannot responsibly make:

1. **Tender at collection:** accept one extra tap (Cash/Card) on every online-order collection? (A1)
2. **Till variance threshold:** the £ amount above which closing variance pings him. (A1)
3. **Each/box catalogue:** which products genuinely sell by each/box, and confirmation they start as `untracked` stock. (A2)
4. **Urgent list + channel:** which events may interrupt him immediately (proposed list §13) and via SMS or WhatsApp; confirm `owner_contact`. (B1)
5. **Owner Away contract sign-off:** the decide-alone / ask-first / wait / stop-trade boundaries in §13. (B1/§25.4)
6. **Refund authority:** who may refund (manager-only proposed) and above what value he is alerted. (B3)
7. **Photo bytes in backups:** accept that operator photos are lost in a full disaster, or fund the storage-object export. (C7)
8. **Reconciliation tolerances:** acceptable stock and cash variance for §25.3 to count as a pass.

## 28. Decisions Requiring Uncle Gul's Field Test

1. Serve rhythm and price read-back — is reading PTM's price aloud natural? (B5, §25.2)
2. Each-item "How many?" wording and quantity picker size. (A2)
3. Whether the closing money step ("Expected: £X — what did you count?") is comfortable or intimidating — wording, not maths, is the risk. (A1)
4. Delivery-during-queue interruption: does the resume prompt read as rescue or confusion? (B6)
5. "I made a mistake" flag: does he understand it creates owner work, not punishment? (B3)
6. Help screen phone fallback: does he know when to call vs tap? (B1)
7. Glove/wet-hand usability of numeric pads and 72px targets on the actual counter device. (§25.5)
8. Language comprehension sweep of every new string against `verify:operator-language`.

## 29. Deferred Capabilities

Deliberately not scheduled until real shop evidence demands them: card-terminal API integration; supplier purchase orders and invoice matching; each/box **count** tracking (beyond `untracked` labelling); scale/barcode integration; receipt printing; SMS provider procurement (visibility ships in D4 regardless); offline write queue; customer self-service amendments; support-case entity (refund reasons cover the pilot); product recall workflow UI (trace fields already stored); storage-location transfers; carcass→retail live transformation ledger; multi-branch operation; prepping→incoming undo transition; fridge temperature sensors; native owner push app.

## 30. Final Recommendation

**Recommended immediate phase: Phase A (PTM-OPS-001 + PTM-OPS-002), prepared by Dad's decisions §27(1–3, 8) and followed immediately by the §25.3 reconciliation day.**

* **Entry criteria:** Dad has answered §27 items 1–3 and 8; the pilot counter device is identified; current test suite green at the starting commit (634/634 at `418c1d5`); validation-day date agreed with Dad and Gul.
* **Exit criteria:** every collection (walk-in and online) writes exactly one tender event (idempotent under double-tap); each/box items sellable through serve in ≤6 taps; closing shows expected vs counted cash and captures the terminal total; variance stored, alert fires past threshold, closing never blocked; day receipt money line renders; all existing gates green plus new guards covering payment-event idempotency and each-item serve lines.
* **Evidence required before moving to Phase B:** a completed §25.3 physical reconciliation day with every cash, card and stock variance explained from the day receipt within Dad's agreed tolerances, plus a timed §25.2 Gul serve rehearsal (kg and each) with zero abandoned sales — both recorded in `docs/audits/`. Phase B then starts with B1 (external alert delivery), because the away trial (§25.4) gates everything OR-11 promises.

The through-line of this audit: PTM has already solved the hard, invisible problem — truthful records. What remains is to point that truthfulness at the two things the shop physically runs on, **money in the till and trade at the counter**, and to make the system's honesty reach the owner's pocket instead of waiting in tables for him to visit.




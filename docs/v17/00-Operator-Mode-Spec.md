# V17 — Uncle Gul Operator Mode

**Status:** Spec (implementation-ready)
**Date:** 2026-06-11
**Owner decision required before Phase 1:** confirm the account/role model in §4 and §18.

---

## 0. Owner Amendments (2026-06-11) — read first

Four refinements from the owner after the first spec draft. They change emphasis and a few rules; the
body below has been updated to match.

**A0.1 — Product picking must not assume Uncle Gul knows system names.** The product picker (§11/§12)
stays as large tiles of *common* products, but it always carries a **"Not sure / something else"**
escape that never blocks. *Future (NOT V17):* a pure **"Take photo"** capture path where the operator
photographs the item/label and the **owner classifies it later** — same pattern as the certificate
fallback. Logged here as a deferred note; the v1 picker is built so this can slot in without rework.

**A0.2 — Certificates are the owner's job, not the operator's.** A non-tech butcher cannot know a
certificate is expiring — *the system must know.* So responsibility moves **owner-side**: the primary
certificate flow in V17 is **system-detected expiry → owner alert → owner resolves** (see new §10.1),
delivered as part of **Owner Away Mode / Phase 7**, not as an operator task. The operator-facing cert
capture (§10) is now strictly **opportunistic and optional** — if a document happens to be in his hand
he can photograph it and it's stored for owner review, but he is **never made responsible** for cert
state and is never chased about it. Escalating unknown uploads to the owner stays; we simply stop
expecting the operator to initiate.

**A0.3 — Counter sales must be physically rehearsed before they are built.** Real counter serving is
messy and fast ("1kg chicken, 2 lamb chops, 500g mince" in one breath). Before Phase 3 is implemented,
there is a **mandatory physical rehearsal gate** (see §26 Phase 3 pre-req and §25): stand behind a
table, serve pretend customers, and confirm the multi-line flow feels fast enough. The serve flow is
therefore designed **multi-line and add-as-you-go** (§12), not one-item-at-a-time, and the build does
not start until the rehearsal sign-off.

**A0.4 — Owner Away Mode is the headline value, not the operator screen.** What the owner actually
asked for is *"can I disappear for a week and trust the shop ran?"* — opened, deliveries arrived,
fridges checked, sales happened, closing completed, **without being present.** That trust is the
highest-value deliverable in V17. Consequence for the build: the **Away-Mode reporting + escalation
spine is treated as a first-class outcome**, and the daily "did the shop run?" summary is wired
incrementally **as each workflow lands** (open → delivery → sale → close), so its value compounds
phase by phase rather than waiting for Phase 7. The operator screen is the *means*; Away Mode is the
*point*.

---

## 1. Executive Summary

The shop already has a complete owner/manager operating system (Owner Brain, opening/closing
capture, inventory truth, purchasing, waste, compliance, audit, orders). V17 does **not** replace
or duplicate any of it.

V17 adds a **single guided front door** for a low-tech co-owner ("Uncle Gul") who may not be
comfortable with computers. He never browses dashboards, never reads analytics, never navigates
admin pages. He sees **one screen with four big buttons** and is walked, one step at a time,
through the few things a shop day actually needs. Each guided step quietly calls the **existing**
domain server actions, so the full backend record (orders, stock movements, batches, compliance
logs, certificates, audit events, owner alerts, purchasing/waste intelligence) is produced exactly
as if the owner had done it.

The design principle:

> Uncle Gul never *uses the system*. He *completes guided actions*. The system translates those
> actions into the full operational record.

It also adds **Owner Away Mode**: the owner flips a switch ("I am away"), and from then on the
shop keeps running on Operator Mode, the owner receives a daily plain-English summary, and anything
critical (fridge fail, expired certificate, delivery mismatch, shop not opened, closing not done)
escalates immediately.

**Architecturally V17 is a presentation + thin-adapter layer over V14/V15/V16.** No new business
logic. No second admin. Where an existing action is too complex for one-tap operator input, V17
adds a *thin adapter* that maps simple input → existing RPC/action.

---

## 2. Goals

1. A non-technical operator can run a full shop day (open → serve → stock/delivery → close) using
   only large buttons and yes/no/photo prompts.
2. Every operator action produces the **same backend events** as the owner pathway — nothing is a
   toy or a stub.
3. Compliance, certificates, inventory, waste, and orders are captured **inside natural
   workflows**, never as a "page to manage".
4. The owner can leave for a week ("Owner Away Mode") and trust that the shop runs and that
   anything important reaches them.
5. Zero analytics, zero scores, zero percentages, zero jargon ever reach the operator surface
   (extends the existing V15.4 Intelligence Firewall).
6. Reuse existing server actions and RPCs. New code is shell + thin adapters + one small data
   table for operator workflow runs.

## 3. Non-Goals

- **Not** a second admin system. No operator dashboards, reports, charts, or settings screens.
- **Not** a rewrite of any domain logic. No new pricing/inventory/depletion maths.
- **Not** a replacement for the owner's TODAY / Owner Brain — that stays exactly as is for the
  owner/manager surface.
- **Not** an offline-first PWA rebuild (we add *graceful* offline handling, not full sync).
- **Not** a new permissions framework — we extend the existing `route-access.ts` ladder.
- **Not** a barcode/hardware-scanner integration in v1 (product picking is tap-a-tile; barcode is a
  later optional enhancement).

---

## 4. User Types

| Type | Role (rank) | Default surface | Sees Operator Mode? | Sees full /admin? |
|------|-------------|-----------------|---------------------|-------------------|
| **Owner** (Dad) | `owner` (3) | `/admin/today` | only via "Preview operator view" | yes (incl. releases/audit) |
| **Operator** (Uncle Gul) | `manager` (2) + `operator_mode` flag | `/operator` | yes (his home) | **no** (locked by flag) |
| **Counter staff** (existing) | `staff` (1) | `/counter` | no | no |

**Decision (recommended): account-driven, with Owner-Away as an overlay — not "either/or".**

The user asked: *button toggle vs. separate account?* The robust production answer is **both, with a
clear split of responsibility**:

- **The separate account is the spine.** Uncle Gul logs in with his own credentials and lands on
  `/operator`. Dad logs in and lands on `/admin/today`. This is clean for audit (every event is
  truly attributed to the person who did it), security (no shared device assumptions), and is what
  the user leaned toward. Implemented as a **per-profile flag**, *not* a new privilege rank:
  - Keep Uncle Gul at **`manager` rank** so every existing manager-gated action (`ops-capture`,
    `carcass-intake`, `compliance-inventory`, waste) works **unchanged** — no business-logic
    duplication.
  - Add `profiles.operator_mode boolean default false`. When true: login routes to `/operator`,
    `/admin/*` is blocked for this account, and the full nav is never rendered.
- **Owner Away Mode is the overlay toggle.** A branch-level switch the owner flips. It does **not**
  change who logs in where; it changes *escalation + summary behaviour* (see §16). It also lets the
  owner optionally force their own session into operator preview, and guarantees nothing critical is
  hidden while they're gone.

Why not a new `operator` role rank between staff and manager? Because the open/close/intake/waste
actions all call `resolveStaffContext("manager", …)`. A sub-manager rank would fail those gates and
force us to duplicate or weaken authority logic — exactly what §2.6 forbids. A **UI/surface flag on
a manager account** gives the simple front door without touching the authority ladder.

---

## 5. Operator Mode Architecture

```
            ┌────────────────────────────────────────────────────────┐
            │  /operator  (the only door Uncle Gul ever sees)         │
            │  4 big buttons + optional Help                          │
            └───────────────┬────────────────────────────────────────┘
                            │ picks a workflow
                            ▼
            ┌────────────────────────────────────────────────────────┐
            │  Guided Workflow Runner (client)                        │
            │  one question per screen · big yes/no/photo · resume    │
            │  src/app/operator/_runner/*                             │
            └───────────────┬────────────────────────────────────────┘
                            │ each step → thin adapter (server action)
                            ▼
            ┌────────────────────────────────────────────────────────┐
            │  Operator Adapters  (NEW, thin)                         │
            │  src/app/actions/operator/*.ts                          │
            │  translate simple input → EXISTING actions/RPCs         │
            └───────────────┬────────────────────────────────────────┘
                            │ calls existing, unchanged
                            ▼
   ops-capture · compliance · counter/checkout · carcass-intake ·
   compliance-inventory (batch/waste/supplier-cert) · audit_events · alerts
                            │
                            ▼
            ┌────────────────────────────────────────────────────────┐
            │  Owner Brain / TODAY / Purchasing / Waste / Audit       │
            │  update automatically (already wired via revalidate)    │
            └────────────────────────────────────────────────────────┘
```

**Key properties**

- **Stateless-feeling, but durably resumable.** Each workflow run is a row in a new
  `operator_workflow_runs` table (§20) so an interrupted day (phone dies mid-close) can resume.
- **The runner holds no business logic.** It only knows "which question is next" from a static
  workflow definition (`src/lib/operator/workflows/*.ts`). All consequence happens in the adapters.
- **Firewall-extended.** A new static gate `verify:operator-firewall` scans `src/app/operator/**`
  for forbidden tokens (`%`, `score`, `confidence`, `variance`, `priority`, KPI words) and forbidden
  imports (owner-brain internals), reusing the V15.4 pattern.

**New modules (suggested)**

```
src/app/operator/
  layout.tsx                      // operator shell: no admin nav, big-touch theme
  page.tsx                        // the 4-button home (§6)
  open/page.tsx                   // mounts runner with "open" workflow
  serve/page.tsx                  // serve customer
  stock/page.tsx                  // stock / delivery
  close/page.tsx                  // close shop
  help/page.tsx                   // call owner / problem
  _runner/
    WorkflowRunner.tsx            // generic step machine (client)
    steps/                        // YesNo, Photo, NumberPad, ProductPicker, PaymentPicker, Done
src/lib/operator/
  workflows/open.ts close.ts serve.ts stock.ts waste.ts certificate.ts
  workflow-types.ts               // Step union, Run state
  events.ts                       // OperatorEvent taxonomy (§8)
src/app/actions/operator/
  session.ts                      // start/resume/abandon a run
  open-close.ts                   // → ops-capture + compliance adapters
  serve.ts                        // → counter sale adapter
  delivery.ts                     // → intake/batch adapter
  certificate.ts                  // → supplier-cert / document review adapter
  waste.ts                        // → recordWaste adapter
  escalation.ts                   // → alerts + owner_alerts adapter
```

---

## 6. The 4-Button Home Screen (`/operator/page.tsx`)

Full-screen, four equal tiles (2×2 on tablet, stacked on phone). Each tile = icon + 3-word label +
one helper line. No counts, no badges with numbers, no colours that imply a score.

| Tile | Label | Helper line | Routes to |
|------|-------|-------------|-----------|
| 1 | **Open Shop** | "Start the day" | `/operator/open` |
| 2 | **Serve Customer** | "Sell over the counter" | `/operator/serve` |
| 3 | **Stock / Delivery** | "Something arrived or ran out" | `/operator/stock` |
| 4 | **Close Shop** | "Finish the day" | `/operator/close` |
| 5 (optional) | **Help / Call Owner** | "Something's wrong" | `/operator/help` |

**State-aware, but never numeric.** Tiles change *words*, never show metrics:

- If the shop is not opened yet today → **Open Shop** is highlighted (brand tint), others say
  "Open the shop first" if tapped before open is done (soft, non-blocking nudge — still allowed).
- If open is done → **Open Shop** shows a green tick + "Done today" and **Serve Customer** becomes
  the dominant tile.
- If close is started but not finished → **Close Shop** shows "Not finished — tap to continue".

The home screen reads state from `operator_workflow_runs` + today's opening/closing checklist
status (existing `ops_*` data). It shows **at most one** highlighted next action — mirroring the
"one thing to do next" discipline of TODAY, but with zero numbers.

**Hard rules:** no list of tasks, no "3 of 5 done", no percentages, no calendar, no history feed.

---

## 7. Guided Workflow Design

Every workflow is a **linear list of steps** defined declaratively. The runner shows **one step per
screen** and advances on a single large tap. Step kinds (the only ones that exist):

| Step kind | Looks like | Produces |
|-----------|-----------|----------|
| `yesno` | Big "Yes" / "No" buttons + question | boolean answer |
| `photo` | Big camera button + "Take photo" / "Choose from phone" / "Skip" | uploaded file URL or skip |
| `number` | Giant number pad (kg / boxes / £) | a number |
| `pick` | Grid of large product/preset tiles | a selection id |
| `choice` | 2–5 large labelled options | one value |
| `confirm` | "All done" summary in plain words | triggers the adapter commit |
| `message` | Reassurance / instruction screen, one "Next" | nothing |

**Shared rules for all steps**

- One question, max ~12 words, plain English (see §19). One primary action, always bottom of
  screen, thumb-reachable.
- A persistent **"Back"** (undo last answer) and, where the step is not legally critical, a
  **"Skip"**. Skips are recorded, not silent (§17, §23).
- Progress is shown as dots ("● ● ○ ○"), never "40%".
- Every answer is saved to the run immediately (`operator_workflow_runs.steps` JSONB) so the device
  can die at any point and resume.
- Commit happens at the `confirm` step → the adapter runs server-side, emits events, and only then
  the run is marked `completed`.

A workflow definition is pure data, e.g. `src/lib/operator/workflows/open.ts`:

```ts
export const OPEN_WORKFLOW: Workflow = {
  id: "open",
  title: "Open the shop",
  steps: [
    { key: "fridge_cold", kind: "yesno", q: "Are the fridges cold?", critical: true },
    { key: "fridge_photo", kind: "photo", q: "Take a photo of the fridge temperature", optional: true,
      showIf: (a) => a.fridge_cold === true },
    { key: "fridge_temp", kind: "number", q: "What number does the fridge show?", unit: "°C",
      optional: true },
    { key: "handwash", kind: "yesno", q: "Is the handwash area ready?" },
    { key: "counter_clean", kind: "yesno", q: "Is the counter clean?" },
    { key: "any_problem", kind: "choice", q: "Any problem today?",
      options: ["All good", "Small problem", "Big problem"] },
    { key: "confirm", kind: "confirm", q: "Open the shop?" },
  ],
};
```

The runner is generic; only the data changes per workflow. This is what keeps V17 small.

---

## 8. Full Backend Event Mapping

V17 introduces an **OperatorEvent taxonomy** (`src/lib/operator/events.ts`) used purely for audit
labelling. Each operator event is recorded in the existing `audit_events` table (so it shows in
`/admin/audit`) **and** triggers the relevant existing domain action. No event is operator-only
bookkeeping that the full system can't see.

| Operator workflow completes | Existing action(s) invoked | Audit / domain events written |
|---|---|---|
| **Open Shop** | `ops-capture.startOrResumeChecklist({kind:"opening"})`, `recordChecklistStep` ×N, `completeChecklist`; `compliance.recordComplianceReading` (if temp given) | `opening_check_completed`, `compliance_check_recorded`, `fridge_temperature_evidence_uploaded` (if photo), `operator_session_started`, `audit_event_written`, `owner_brain_updated` (via revalidate) |
| **Serve Customer** | `operator/serve.recordCounterSale` → `checkout`/order create → set `collected` (depletes stock V14.1) | `counter_sale_recorded`, `order_collected`, `stock_movement_created`, `revenue_recorded`, `demand_signal_updated`, `repeat_customer_updated` (if known), `audit_event_written` |
| **Delivery received** | `operator/delivery.confirmSimpleDelivery` → `compliance-inventory.createInventoryBatch` (or `carcass-intake.confirmCarcassIntake` for carcass) | `delivery_received`, `stock_batch_created`, `stock_movement_created`, `supplier_evidence_uploaded` (if note photo), `purchasing_recommendation_reconciled`, `audit_event_written`, `owner_alert_created` (if mismatch) |
| **Certificate photo uploaded** | `operator/certificate.captureCertificate` → store file → `saveSupplier` (if classified) or queue review | `compliance_document_uploaded`, `certificate_review_required` (if unknown/low confidence), `owner_alert_created` (if expiry/unknown/critical), `audit_event_written` |
| **Waste recorded** | `operator/waste.recordSimpleWaste` → `compliance-inventory.recordWaste` | `waste_recorded`, `stock_movement_created`, `waste_intelligence_updated`, `audit_event_written`, `owner_alert_created` (if waste over threshold) |
| **Close Shop** | `ops-capture` closing checklist + `compliance.completeComplianceDay` | `closing_check_completed`, `compliance_day_completed`, `operator_session_ended`, `audit_event_written`, `owner_brain_updated` |
| **Any critical "No" / "Big problem" / skip of critical step** | `operator/escalation.escalateToOwner` → `alerts.dispatchAlert` + `owner_alerts` row | `owner_alert_created` (critical), `audit_event_written` |

Implementation note: the "events written" are a mix of **real domain rows** (orders, batches,
movements, compliance logs) that already happen inside the existing RPCs, plus **one audit row per
operator step-group** written by a small helper `recordOperatorAudit(eventType, summary, entityRef)`
that inserts into `audit_events` via the existing service path. The operator adapters are the only
new code; they do not re-implement the domain.

---

## 9. Compliance Handling

Compliance never appears as a "dashboard" or "log" to the operator. It is **dissolved into Open and
Close**.

**During Open Shop** (maps to `compliance.recordComplianceReading` + opening checklist steps):

- "Are the fridges cold?" → yes/no (**critical**; "No" escalates, §17)
- "Take a photo of the fridge temperature display" → optional photo → stored as evidence
- "What number does the fridge show?" → optional number → `chiller_temp_c` / `display_temp_c`
- "Is the handwash area ready?" → yes/no
- "Is the counter clean?" → yes/no
- "Any problem today?" → All good / Small problem / Big problem

**During Close Shop** (maps to `compliance.completeComplianceDay`):

- "Was the counter cleaned?" → `cleaning_completed`
- "Was everything sanitised?" → `sanitisation_completed`
- "Was unsold meat stored safely?" → yes/no (close-specific check, recorded in notes/evidence)
- "Any waste today?" → if yes, branches into the Waste workflow (§14)
- "Take a photo if you're not sure" → optional evidence

**Rules**

- A compliance temperature reading uses the **real** hardened `record_compliance_reading` RPC
  (branch-scoped). If the operator gives no number but says "fridges cold", we still record a
  qualitative opening check; we do **not** fabricate a temperature (consistent with the V12
  "fabricated demo removed" rule).
- The operator never sees the word "compliance". The audit/owner side still labels it
  `compliance_check_recorded`.
- Missing/failed compliance during Owner Away → immediate escalation (§16, §17).

---

## 10. Certificate Handling

When the system knows a certificate is **missing, expiring, or unverified** (existing supplier-cert
data in `compliance-inventory` / `admin_upsert_supplier_cert`), it surfaces — *inside the Stock /
Delivery flow or as a one-line prompt on the home screen* — as:

> **"A certificate needs updating."**
> [ Take photo ] [ Upload from phone ] [ Skip and tell owner ]

After capture, classify with one simple question (only if we can't infer it):

> **"What is this for?"**
> Halal certificate · Supplier invoice · Hygiene certificate · Delivery note · Other / not sure

**Flow (`operator/certificate.captureCertificate`)**

1. Upload file to Supabase Storage (reuse the storage path already used for `documentUrl` in
   `saveSupplier`). The file is **always stored**, even if unclassified.
2. If classified as a supplier cert and tied to a known supplier → call `saveSupplier` with the new
   `documentUrl` (+ `verified:false` so the owner confirms).
3. If "Other / not sure" **or** low confidence → store as `compliance_documents` row with
   `status:'needs_owner_review'` and create an owner alert. **Never block the operator.**
4. If the cert relates to an expiry that's already passed and the item is legally critical (e.g.
   halal cert for a supplier currently delivering) → still don't block capture, but raise a
   **critical** owner alert.

**Acceptance:** an operator can clear a "certificate needs updating" prompt with one photo and at
most one tap of classification, and the owner can later find that file under review. No certificate
management page is ever shown to him. **But per A0.2 this is the *fallback*, not the main mechanism —
the operator is never made responsible for certificate state.**

### 10.1 Owner-side certificate expiry (the primary mechanism — A0.2)

The real safeguard is system-driven and owner-facing. Supplier certificates already carry an expiry
(`cert_expiry` in `admin_upsert_supplier_cert`). A scheduled job (the same Away-Mode cron, §16) checks
for certificates expiring within a window and drives:

```
Certificate expiring in 30 days  →  owner alert (warning)
Certificate expiring in 7 days   →  owner alert (warning, repeated)
Certificate expired              →  owner alert (critical) + flagged on owner TODAY
                                     (operator is NOT blocked from trading on it; owner resolves)
```

- Detection lives owner-side; the operator surface shows **nothing** about cert expiry.
- Resolution is an owner workflow: the alert links the owner straight to the existing supplier-cert
  screen to re-upload/renew (one-tap target, V15.2 style). No new operator screen.
- Thresholds (30/7/0 days) are config in `branch_operator_settings` later; hardcoded sensible
  defaults for v1.
- Gate: `verify:operator-cert-expiry` asserts an expiring cert produces an owner alert and that the
  operator surface never references certificate expiry (firewall token check).

---

## 11. Inventory / Stock Handling

The operator never sees inventory tables, batches, FEFO, or kg-remaining. Stock is captured through
the **Stock / Delivery** workflow as prompts:

- "Did a delivery arrive?" → yes/no
- "What arrived?" → `pick` from large product tiles (common products first; "Something else" →
  short search) — **or** "A whole carcass" → routes to the carcass path
- "How much?" → `number` pad → "boxes", "kg", or "each" (unit chosen by product)
- "Take a photo of the delivery note" → optional → supplier evidence
- "Where did you put it?" → choice: Fridge / Freezer / Counter / Back store
- "All done?" → `confirm`

**Behind the scenes (`operator/delivery.confirmSimpleDelivery`)** maps to the **existing**
`createInventoryBatch` (`admin_create_inventory_batch` RPC), supplying sensible defaults so the
operator isn't asked for things he can't know:

| Batch field | Operator gives | Default if not given |
|---|---|---|
| productId | product tile | required |
| supplierId | inferred from product's usual supplier | "Unknown supplier (review)" placeholder → owner alert |
| receivedWeightKg / qty | number pad | required |
| receivedDate | now | now |
| expiryDate | optional ("use by?") | product default shelf life |
| invoiceCost | optional | last known cost (flagged "estimated, owner to confirm") |
| storageLocation | "where did you put it" | null |

This creates: **stock_batch_created**, **stock_movement_created**, **supplier_evidence_uploaded**
(if photo), and the existing `revalidateOps()` already refreshes purchasing/TODAY → **purchasing
recommendation reconciled** and **owner_brain_updated** happen for free. If the delivered quantity
is wildly different from an outstanding purchasing recommendation → **owner_alert_created**
(mismatch).

**Carcass path** reuses `confirmCarcassIntake` but with a radically simplified operator front:
operator only picks animal + total weight + total cost + "use by" + photo; the server recomputes the
full breakdown authoritatively (it already does — the client cannot inject cuts/costs). Cuts that
need a product mapping are auto-queued as "owner to finish" rather than asked of the operator.

**"Did something run out?"** branch → records a manual stock correction via the existing
`adjustInventoryRemainingWithReason` (reason: "operator says empty") — never lets stock silently go
wrong; the owner sees the correction in audit.

---

## 12. Orders / Counter Sales Handling

Ultra-simple counter sale (**Serve Customer**):

1. "What are they buying?" → `pick` (common products as big tiles; recent/popular first)
2. "How much?" → preset tiles (e.g. ½ kg, 1 kg, 2 kg) **or** number pad
3. "Anything else?" → add another line / "No, that's all"
4. "How are they paying?" → Cash / Card
5. "Done" → `confirm` shows total in big text → commit

**Behind the scenes (`operator/serve.recordCounterSale`)**: creates an order via the existing
checkout/order path and transitions it straight to `collected` (which, per V14.1, **depletes
inventory**). It must reuse `counter.updateOrderStatus`'s collection path so the existing
`getCollectionStockMessage` "count this" nudge and revalidation of `/admin`, `/admin/today`,
`/admin/inventory`, `/admin/purchasing` all fire. Produces: **counter_sale_recorded**,
**order_collected**, **stock_movement_created**, **revenue_recorded**, **demand_signal_updated**,
and **repeat_customer_updated** *if* the operator optionally taps "Regular customer?" → picks a known
name (feeds the V16 win-back engine). Customer naming is **optional** and never required.

**Operator never sees:** order IDs, statuses, the orders board, SMS internals, or margins.

**Negative-stock safety:** if depletion would drive a batch negative, the existing RPC already
handles it (records the movement and surfaces a gentle "count this" message) — the operator sees
"Saved. Please check this product's stock later," and the owner gets the count nudge in TODAY. The
sale is **never** blocked at the counter (a real customer is standing there).

---

## 13. Deliveries / Supplier Handling

Covered operationally in §11. Supplier-specific rules:

- The operator is **never** asked to choose a supplier from a list of legal entities. We infer the
  supplier from the product's usual supplier; if ambiguous, we store the batch against an
  "Unknown supplier — owner to confirm" placeholder and raise a **review** alert (non-critical).
- A delivery-note photo becomes **supplier evidence** attached to the batch (storage URL on the
  batch / a `supplier_evidence` reference), satisfying traceability without the operator
  understanding traceability.
- **Duplicate delivery** guard: the delivery adapter passes an `intakeIdempotencyKey` derived from
  `{branch, product, qty, day, runId}`; the existing intake path already rejects "Duplicate intake
  submission" / "Intake idempotency key already used", which we surface as "Looks like this delivery
  was already added — is it a second one?" (yes → new key; no → discard). (§23.)

---

## 14. Waste / Expiry Handling

No analysis. The Waste workflow (entered from Close Shop's "Any waste today?" or Stock's "Throw
something away?"):

- "Did you throw anything away?" → yes/no (no → done)
- "What did you throw away?" → `pick` product
- "How much?" → number pad (kg / each)
- "Why?" → `choice`: Expired · Damaged · Customer changed mind · Mistake · Other
- "Take a photo (if you want)" → optional
- "Done" → confirm

**Behind the scenes (`operator/waste.recordSimpleWaste`)** → existing
`compliance-inventory.recordWaste` (`admin_record_inventory_waste`). Maps the friendly reason to the
RPC's valid reason set; "Customer changed mind" → `customer_rejected`, etc. Produces
**waste_recorded**, **stock_movement_created**, **waste_intelligence_updated** (the V16 diffuse-waste
rule picks it up automatically via revalidate). If a single waste event or the day's total exceeds a
quiet threshold → **owner_alert_created** ("more waste than usual today" — *worded plainly, no
numbers shown to the operator*).

---

## 15. Opening and Closing Handling

These are the two anchor workflows; both reuse `ops-capture` checklists + compliance.

**Open Shop** (`operator/open-close.completeOpen`):
1. `startOrResumeChecklist({ branchId, kind: "opening" })`
2. For each answered step → `recordChecklistStep({ sessionId, stepKey, state, payload })`
   (`state` = `done` | `skipped` | `flagged`; payload carries photo URL / temp number)
3. Optional `recordComplianceReading` if a temperature number was given
4. `completeChecklist({ sessionId })` → emits `opening_check_completed`
5. Mark `operator_workflow_runs` row `completed`, write `operator_session_started` audit row

**Close Shop** (`operator/open-close.completeClose`):
1. `startOrResumeChecklist({ kind: "closing" })` + steps as above
2. "Any waste?" → inline Waste workflow
3. `completeComplianceDay({ cleaning, sanitisation, wasteChecked, notes })`
4. `completeChecklist` → `closing_check_completed`
5. `operator_session_ended` audit row

**Incomplete is visible, not hidden:** if `completeChecklist` can't run because a **critical** step
was skipped, the run stays `in_progress`, the home screen's Close tile shows "Not finished — tap to
continue", and (in Owner Away mode) the owner is alerted that closing wasn't completed.

---

## 16. Owner Away Mode

A branch-level switch the owner toggles from `/admin/settings` ("I'm away" / "I'm back"). Stored in
a new `branch_operator_settings` row (§20): `owner_away boolean`, `away_since timestamptz`,
`summary_time time`, `owner_contact` (phone/email for alerts).

When **on**:

1. Operator accounts behave exactly as normal (they already only see `/operator`). No change needed
   for them — the value is in escalation + reporting.
2. **Daily summary** to the owner (one plain-English message via existing `dispatchAlert` +
   optionally SMS through the existing `sms.ts`), e.g.:
   > "Shop opened 8:05am. 14 sales. One delivery (lamb). A bit more waste than usual. Fridge checks
   > done. Shop closed 6:10pm. Nothing urgent."
   Generated by a scheduled job (Vercel cron / GitHub Action) reading the day's audit + domain rows
   — **internal numbers stay internal**; the owner gets a calm narrative, not a dashboard.
3. **Critical issues escalate immediately** (§17), not batched.
4. **Skipped compliance tasks are highlighted** in the summary and as immediate alerts if critical.
5. **Unresolved certificate uploads** ("needs owner review") are listed for the owner.
6. **Unusual stock/waste/order patterns** raise alerts (reuse existing intelligence thresholds; the
   operator never sees them).

When **off**: no daily summary; alerts still fire for genuinely critical events (fridge fail,
expired cert) because safety/compliance shouldn't depend on the owner being away. Owner Away only
*raises* sensitivity and adds the daily narrative — it can **never reduce** critical alerting
(validation gate, §24).

**Owner-side surface:** a small "While you were away" card on `/admin/today` listing the daily
summaries + any open reviews. This is owner-only; it does not touch the operator surface.

---

## 17. Escalation Rules

Escalation = `operator/escalation.escalateToOwner(event, severity)` → writes an `owner_alerts` row +
`dispatchAlert` (+ SMS to `owner_contact` for `critical` when Owner Away). Each escalation also
writes an `owner_alert_created` audit row.

| Trigger | Severity | Fires even if owner present? |
|---|---|---|
| Fridge failed check ("No" to fridges cold) | critical | yes |
| Certificate expired (legally critical supplier) | critical | yes |
| Delivery mismatch vs. purchasing recommendation | warning | yes |
| Stock critically low (existing threshold) | warning | Away only (else just TODAY) |
| Too much waste (day total over threshold) | warning | Away only |
| Shop not opened by expected time | critical | Away → yes; present → warning |
| Closing not completed | critical | Away → yes; present → warning |
| Repeated skipped tasks (≥N in a day) | warning | yes |
| Operator chose "Not sure" / "Big problem" | warning→critical | yes |
| Payment/order mismatch | warning | yes |

**Operator side of escalation is calm:** when something escalates, the operator sees
"Thanks — I've told the owner about this," never an error wall. He can always continue (unless the
action is *legally* impossible, which for v1 is effectively never — we capture and flag rather than
block).

"Shop not opened / closing not completed" are evaluated by a **time-based job** (cron), since
they're *absence* of an event.

---

## 18. Permissions and Role Boundaries

Extend `src/lib/domain/route-access.ts`:

```ts
const OPERATOR_ROUTES = ["/operator"] as const;

// A manager account with operator_mode=true is LOCKED to /operator.
export function isOperatorAccount(profile): boolean {
  return profile?.role !== "owner" && profile?.operatorMode === true;
}
```

- Add `operator_mode` to `profiles` (migration) and to `StaffProfile` / the `getCurrentProfile`
  select in `src/lib/server/auth.ts`.
- **Routing (login + middleware):** if `isOperatorAccount` → only `/operator/**` allowed; any
  `/admin/**` request 302→`/operator`. Owner/manager without the flag → unchanged.
- **Authority unchanged:** operator adapters still call `resolveStaffContext("manager", …)`. Uncle
  Gul *is* a manager, so existing gates pass; we add **no** new privilege rank and weaken nothing.
- Owner-only areas (`/admin/releases`, `/admin/audit`) stay owner-only.
- The operator account can never reach raw intelligence: enforced by (a) route lock, (b) the new
  `verify:operator-firewall` static gate over `src/app/operator/**`.

**Validation gates (must pass):**
- Operator account cannot load any `/admin/*` page (integration test).
- No owner-brain internal import or forbidden token in `src/app/operator/**`.

---

## 19. UI/UX Rules for Non-Technical Users

1. **One decision per screen.** Never two questions on one screen.
2. **Big tap targets:** minimum 64×64px (aim 72px+), full-width primary buttons, ≥24px font for
   questions, ≥28px for buttons. Designed tablet-first, works one-handed on a phone (primary action
   pinned to bottom within thumb reach).
3. **Plain English, ~5-year-reading-age.** "Are the fridges cold?" not "Record chiller temperature
   compliance." A short word list / linter enforces this (`verify:operator-language`, reuse the
   existing operator-language script's approach — ban a denylist of jargon: compliance, inventory,
   batch, SKU, variance, margin, reconcile, escalate, audit, %).
4. **No numbers that imply judgement.** No scores, no percentages, no confidence, no "X of Y", no
   currency except the live counter-sale total.
5. **Always a way back.** Big "Back" undoes the last answer; "Start again" abandons safely.
6. **Reassuring, never blaming.** Skips and problems get "That's okay — I'll tell the owner," never
   red error walls.
7. **Photos are one tap.** "Take photo" opens the camera directly (`capture` attribute); upload
   shows a spinner then a tick; failure offers "Try again" or "Skip for now" (file queued, §23).
8. **No typing where avoidable.** Number pad and tiles instead of keyboards. Customer name is the
   only optional free-text, and it's a search-and-tap of known names.
9. **High contrast, warm theme** consistent with the existing "craft butcher" design system (Inter +
   Fraunces, paper background) but with **larger** type scale for operator screens.
10. **Confirm screens restate in plain words** what will happen ("Open the shop now?") before any
    commit.

---

## 20. Data Schema / Event Schema

**New migration** `2026061x_v17_operator_mode.sql`:

```sql
-- 1) Operator account flag
alter table profiles add column if not exists operator_mode boolean not null default false;

-- 2) Branch-level away/summary settings
create table branch_operator_settings (
  branch_id      uuid primary key references branches(id) on delete cascade,
  owner_away     boolean not null default false,
  away_since     timestamptz,
  summary_time   time not null default '19:00',
  owner_contact  text,            -- phone/email for away alerts (redacted in logs)
  updated_at     timestamptz not null default now(),
  updated_by     uuid references profiles(id)
);

-- 3) Resumable guided-workflow runs (operator UX state, NOT business state)
create table operator_workflow_runs (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branches(id),
  operator_id  uuid not null references profiles(id),
  workflow     text not null check (workflow in
                 ('open','close','serve','delivery','waste','certificate')),
  status       text not null default 'in_progress'
                 check (status in ('in_progress','completed','abandoned')),
  steps        jsonb not null default '[]',   -- answered steps (resume state)
  result_ref   text,                          -- id of the domain row(s) created on commit
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 4) Owner alerts (durable inbox; complements transient dispatchAlert)
create table owner_alerts (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id),
  severity    text not null check (severity in ('warning','critical')),
  kind        text not null,        -- 'fridge_fail','cert_expired','delivery_mismatch',...
  summary     text not null,        -- plain English
  entity_ref  text,                 -- order/batch/document id
  created_by  uuid references profiles(id),
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

-- 5) Compliance documents needing owner review (cert capture, unclassified)
create table compliance_documents (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id),
  document_url text not null,
  doc_type    text,                 -- null/'unknown' until classified
  status      text not null default 'needs_owner_review'
                 check (status in ('needs_owner_review','classified','linked')),
  uploaded_by uuid references profiles(id),
  created_at  timestamptz not null default now()
);
```

**RLS:** operator (`manager` rank) may insert/select their own branch's `operator_workflow_runs`,
`owner_alerts`, `compliance_documents`; only owner may write `branch_operator_settings`. Follow the
existing branch-scoped RLS patterns; **all writes go through SECURITY DEFINER RPCs** consistent with
the V12 authority seal — no direct client table writes.

**OperatorEvent taxonomy** (`src/lib/operator/events.ts`) — string-literal union used as
`audit_events.event_type`; exactly the names in §8.

---

## 21. API / Server Action Design

All new server actions live under `src/app/actions/operator/` and follow the **existing house
style** (`"use server"`, `resolveStaffContext("manager"/branchScoped)`, `SAFE_PATTERNS` →
`safeMessage`, `revalidatePath`, return `{ ok, message, id }`). They are **thin** — each is mostly a
mapping + a call to an existing action/RPC + one `recordOperatorAudit`.

```ts
// session.ts
startWorkflow(input: { workflow: WorkflowId }): Promise<{ ok; runId }>
resumeWorkflow(input: { runId }): Promise<{ ok; run }>
saveStep(input: { runId; stepKey; value }): Promise<{ ok }>      // persists to steps JSONB
abandonWorkflow(input: { runId }): Promise<{ ok }>

// open-close.ts
completeOpen(input: { runId; answers; photos }): Promise<ActionResult>   // → ops-capture + compliance
completeClose(input: { runId; answers; photos }): Promise<ActionResult>

// serve.ts
recordCounterSale(input: { lines: {productId; qty; unit}[]; payment: 'cash'|'card'; customerId?: string })
  : Promise<{ ok; total; message }>   // → checkout/order create → collected

// delivery.ts
confirmSimpleDelivery(input: { productId; qty; unit; expiry?; storage?; notePhotoUrl?; runId })
  : Promise<ActionResult>             // → createInventoryBatch (idempotent)
confirmSimpleCarcass(input: { animalId; weightKg; costGbp; expiry; photoUrl?; runId })
  : Promise<ActionResult>             // → confirmCarcassIntake (server recomputes)

// certificate.ts
captureCertificate(input: { fileUrl; docType?; supplierId? }): Promise<ActionResult>

// waste.ts
recordSimpleWaste(input: { productId; qty; unit; reason; photoUrl?; runId }): Promise<ActionResult>

// escalation.ts
escalateToOwner(input: { kind; severity; summary; entityRef? }): Promise<{ ok }>
```

**Key principle:** if an existing action signature is too heavy (e.g. `confirmCarcassIntake` wants a
full `mapping`), the adapter builds the heavy payload from defaults server-side — the operator never
supplies it. No domain maths is re-implemented in the adapter.

**File upload:** reuse the storage bucket/path already used for supplier `documentUrl`. A small
`uploadOperatorPhoto` server action returns a URL the adapters store. Failures return a queued
sentinel (§23) so the workflow can proceed.

---

## 22. Observability and Audit

- **Every operator step-group commit writes exactly one audit row** (`recordOperatorAudit`) into the
  existing `audit_events`, so `/admin/audit` shows the full operator trail attributed to Uncle Gul's
  account.
- Domain rows (orders, batches, movements, compliance logs) already carry their own audit via the
  existing RPCs — operator events sit alongside, not instead.
- Metrics via existing `incrementMetric`: `operator_open_completed`, `operator_sale_recorded`,
  `operator_delivery_recorded`, `operator_waste_recorded`, `operator_escalation` (by kind),
  `operator_workflow_abandoned`, `operator_photo_upload_failure`.
- Alerts via existing `dispatchAlert` (+ SMS when Away).
- **No silent failures:** every adapter that fails to reach a domain action logs `warn` and either
  returns a visible "couldn't save — try again" or queues + flags. A failed commit never marks the
  run `completed`.

---

## 23. Failure Modes

| Situation | Behaviour |
|---|---|
| **Operator skips a step** | Recorded as `skipped` on the run + checklist step state `skipped`. Non-critical: proceed. Critical: cannot `completeChecklist`; run stays `in_progress`; owner alert (esp. Away). |
| **No internet** | Steps are saved locally (the runner keeps answers in component state + `localStorage` keyed by `runId`); on reconnect, queued `saveStep`/commit replay. Commit actions are **idempotent** (idempotency keys on sale/delivery) so replay can't double-post. Operator sees "Saved — will sync when back online." |
| **Wrong product selected** | "Back" undoes; on a committed sale, an "Undo last sale" affordance reverses via the existing reversal path (V14 `admin_reverse_order_inventory`) within a short window; otherwise → owner alert to correct. |
| **Duplicate delivery entered** | Idempotency key on `confirmSimpleDelivery`; existing RPC rejects duplicates → operator asked "already added — is this a second one?" (§13). |
| **Photo upload fails** | Retry once automatically; then offer "Try again"/"Skip for now". Skip stores a `photo_pending` marker on the run + (Away) a review note. Workflow never blocks on a photo. |
| **Stock would go negative** | Existing RPC records the movement + count nudge; sale **not** blocked; "please check this product later"; owner gets the count nudge in TODAY. |
| **Certificate unreadable** | Still stored as `needs_owner_review`; operator told "Saved — owner will check it." Never blocks. |
| **Operator abandons halfway** | Run = `in_progress`; home screen shows "Not finished — tap to continue"; resumable. A nightly job marks runs idle >24h `abandoned` and (Away + critical workflow) alerts the owner. |
| **Owner away and a critical task fails** | Immediate critical alert + SMS to `owner_contact`; logged; appears in "While you were away". Critical alerting can never be suppressed by Away mode (gate §24). |
| **Adapter/RPC error** | `safeMessage` plain text ("Couldn't save that — try again"); run not completed; metric + warn log. No raw error shown. |

---

## 24. Validation Gates

These are **hard gates** (CI + live), mirroring the V15/V16 `verify:*` pattern. New scripts under
`scripts/`:

1. `verify:operator-route-lock` — an `operator_mode` account is redirected away from every
   `/admin/*` route; cannot load admin pages.
2. `verify:operator-firewall` — static scan of `src/app/operator/**` + `src/lib/operator/**`: no
   forbidden tokens (`%`, `score`, `confidence`, `variance`, `priority`, `KPI`, `margin`) and no
   imports of owner-brain internals / `getDecisionDiagnostics`.
3. `verify:operator-language` — every operator-facing string passes the plain-English denylist
   (extend the existing operator-language script).
4. `verify:operator-events` — every operator workflow commit emits ≥1 audit event; every
   stock-affecting operator action produces a stock movement (asserted against a seeded run).
5. `verify:operator-escalation` — every critical trigger in §17 creates an `owner_alerts` row;
   **Owner Away cannot suppress any critical alert** (assert away=true still fires criticals).
6. `verify:operator-skip-visibility` — a skipped critical step leaves the run `in_progress` and
   creates an owner alert; the home screen reflects "not finished".
7. `verify:operator-cert-capture` — an unclassified/"not sure" certificate is still stored
   (`compliance_documents.status='needs_owner_review'`) and creates an owner alert.
8. `verify:operator-cert-expiry` (A0.2/§10.1) — an expiring/expired certificate produces an owner
   alert; the operator surface contains no certificate-expiry language.
9. Reuse existing `verify:owner-brain-compliance` + `verify:intelligence-firewall` unchanged (the
   operator surface must not regress the firewall).

**Acceptance per gate:** green in CI and green live (`BASE=… pnpm verify:operator-*`).

---

## 25. Testing Plan

**Unit (Vitest):** workflow definitions are well-formed (every `showIf` references prior keys; every
critical step has escalation); adapter mapping (friendly waste reason → RPC reason; defaults for
delivery batch; idempotency key derivation); event taxonomy completeness.

**Integration (server actions against seeded Supabase):**
- `completeOpen` → opening checklist completed + compliance reading + audit rows.
- `recordCounterSale` → order created, collected, stock depleted, revalidation fired.
- `confirmSimpleDelivery` → batch + movement + supplier evidence; duplicate rejected.
- `recordSimpleWaste` → waste + movement + intelligence revalidate.
- `captureCertificate` unclassified → document stored + owner alert.
- `escalateToOwner` critical with Away on/off → alert always fires.

**Live journey gates (Playwright/`verify:*`, the house pattern):**
- **Operator open journey:** login as operator → `/operator` → Open Shop → all steps → "Done today".
- **Operator serve journey:** sale of 1kg lamb, card → total shown → stock decremented.
- **Operator delivery journey:** lamb delivery + note photo → batch visible in owner inventory.
- **Operator close journey:** close with waste → closing + compliance completed.
- **Owner Away journey:** owner toggles away → operator causes a fridge "No" → owner alert + (mock)
  SMS recorded; daily summary job produces a narrative with **no numbers leaked as scores**.
- **Route-lock journey:** operator hits `/admin` → redirected to `/operator`.

**Usability (manual, scripted checklist):**
- One-handed phone run of each workflow (thumb reach, tap sizes ≥64px) — recorded as pass/fail.
- Tablet run at counter.
- Read-aloud test: a non-technical reader completes Open and a sale unaided.
- Glove/wet-finger tap test (butcher reality).

**Seed:** extend `scripts/seed-dev.mjs` with an operator account (`uncle.gul@…`, `manager` +
`operator_mode=true`) and a few common products with presets.

---

## 26. Rollout Plan

Build behind a flag; ship phase-by-phase; nothing user-visible until the operator account is
created.

- **Phase 1 — Operator Mode shell + role routing.** Migration (profiles flag, settings, runs,
  alerts, documents tables). `/operator` shell + 4-button home (buttons can be stubbed). Login/
  middleware routing + `verify:operator-route-lock`, `verify:operator-firewall`. Seed operator user.
- **Phase 2 — Open / Close guided flows.** Workflow runner + open/close workflows + `open-close`
  adapter over `ops-capture`/`compliance`. `verify:operator-skip-visibility`. Open/close live
  journeys.
- **Phase 3 — Serve Customer.** **Pre-req (A0.3): physical rehearsal sign-off first** — a real
  table-top serving rehearsal with the owner (messy multi-line orders) confirms the flow feels fast
  enough; only then build. Sale workflow is **multi-line / add-as-you-go** + `serve` adapter over
  checkout/collect. Serve live journey. `verify:operator-events` (sale → movement).
- **Phase 4 — Delivery / Stock.** Delivery + carcass simplified flows + `delivery` adapter
  (idempotent). Duplicate-guard test. Delivery live journey.
- **Phase 5 — Certificate capture.** Upload + classify + review queue + `certificate` adapter.
  `verify:operator-cert-capture`.
- **Phase 6 — Waste capture.** Waste workflow + `waste` adapter. Waste journey.
- **Phase 7 — Owner Away Mode + alerts.** Settings toggle, `owner_alerts` inbox, escalation rules,
  daily-summary cron, "While you were away" owner card, SMS. `verify:operator-escalation`.
- **Phase 8 — Full validation gates + live rehearsal.** All `verify:operator-*` green live; a
  real-world rehearsal day with Uncle Gul on a tablet; usability checklist signed off; then enable
  his account in production.

Each phase: green `tsc` + unit + its `verify:*`, merged to main, **not** auto-deployed until the
owner says go (consistent with the V15/V16 "held for owner go" discipline).

---

## 27. What NOT To Build

- ❌ Any operator dashboard, report, chart, KPI, or analytics screen.
- ❌ Scores, confidence, percentages, variance, margins, or rankings anywhere in `/operator`.
- ❌ A second admin system or any duplicate of pricing/inventory/depletion/owner-brain logic.
- ❌ A new privilege rank between staff and manager (use the `operator_mode` flag on a manager
  account instead).
- ❌ Direct client table writes (everything through existing RPCs / `resolveStaffContext`).
- ❌ A certificate/inventory/compliance "management" page for the operator.
- ❌ Free-text typing where a tile or number pad will do.
- ❌ Blocking the operator on anything non-legal — capture, flag, and let the owner resolve.
- ❌ Full offline sync engine / PWA rebuild (graceful queue only).
- ❌ Hardware/barcode scanner integration in v1.

---

## Appendix A — File/Module Checklist (implementation index)

```
DB:    supabase/migrations/2026061x_v17_operator_mode.sql      (§20)
Auth:  src/lib/server/auth.ts          + operator_mode in select & StaffProfile
       src/lib/domain/route-access.ts  + isOperatorAccount, OPERATOR_ROUTES
       middleware/login routing        + operator redirect
Shell: src/app/operator/{layout,page}.tsx
       src/app/operator/{open,serve,stock,close,help}/page.tsx
       src/app/operator/_runner/WorkflowRunner.tsx + steps/*
Defs:  src/lib/operator/workflows/{open,close,serve,stock,waste,certificate}.ts
       src/lib/operator/{workflow-types,events}.ts
Adapt: src/app/actions/operator/{session,open-close,serve,delivery,certificate,waste,escalation}.ts
Owner: src/app/admin/settings  + Owner Away toggle
       src/app/admin/today      + "While you were away" card
       scripts/operator-daily-summary.mjs (cron) + owner_alerts inbox
Gates: scripts/verify-operator-{route-lock,firewall,language,events,escalation,skip-visibility,cert-capture}.mjs
       package.json verify:operator-* + add to CI + verify:all
Seed:  scripts/seed-dev.mjs  + uncle.gul manager+operator_mode account, preset products
```

## Appendix B — Reused existing surfaces (no change to their logic)

| Domain | Existing action / RPC reused |
|---|---|
| Open/close/stock-count | `src/app/actions/ops-capture.ts` → `ops_start_or_resume_session`, `ops_record_step`, `ops_complete_session`, `ops_record_stock_count_line`, `ops_apply_stock_count_line` |
| Compliance | `src/app/actions/compliance.ts` → `record_compliance_reading`, `complete_compliance_log` |
| Counter sale | `src/app/actions/counter.ts` (collect path) + checkout order create; V14.1 depletion |
| Delivery (batch) | `src/app/actions/compliance-inventory.ts` `createInventoryBatch` → `admin_create_inventory_batch` |
| Delivery (carcass) | `src/app/actions/carcass-intake.ts` `confirmCarcassIntake` → `admin_confirm_carcass_intake` |
| Supplier cert | `compliance-inventory.ts` `saveSupplier` → `admin_upsert_supplier_cert` |
| Waste | `compliance-inventory.ts` `recordWaste` → `admin_record_inventory_waste` |
| Stock correction | `compliance-inventory.ts` `adjustInventoryRemainingWithReason` → `admin_adjust_inventory_remaining` |
| Audit | `audit_events` table (shown in `/admin/audit`) |
| Alerts | `src/lib/server/observability/alerts.ts` `dispatchAlert`; `src/lib/server/sms.ts` |
| Authority | `src/lib/server/staff-context.ts` `resolveStaffContext("manager", …)` |
```

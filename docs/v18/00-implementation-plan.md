# V18 — Owner Truth Programme: Implementation Plan

Source of requirements: `docs/audits/ptm-owner-operational-improvement-audit.md` (commit `f01a01c`).
This plan turns all 21 audit findings (PTM-OPS-001 … PTM-OPS-021) into ordered, buildable work packages. It adds engineering detail the audit deliberately left out (migrations, RPCs, actions, guards, test tiers) and resolves implementation questions the audit deferred. Where this plan and the audit disagree on mechanism, this plan wins (it is closer to the code); where they disagree on *intent*, the audit wins.

Program name: **V18 Owner Truth** — Phases track the audit exactly: **A** (trade blockers), **B** (owner requirement closure), **C** (workflow simplification), **D** (evidence-led polish).

> **Revision v1.1 (2026-07-13, pre-implementation review).** Six contract defects corrected before any build starts: (1) expected-cash equation completed with an append-only `till_events` model; (2) the shared tender RPC removed — sale and refund money writes are now two purpose-built RPCs with incompatible-by-design contracts; (3) refund money+stock+audit composed in **one** RPC transaction; (4) order amendments switched to ordered event folding with an order-row lock and a version frozen at collection; (5) draft saves are awaited with visible saved/not-saved state, never silently dropped; (6) gate G-A trimmed to Phase-A capabilities only (refund/amendment evidence moved to G-B). Also: the "Actions secrets empty" blocker was re-verified and is **stale** — secrets configured 2026-07-12 and the scheduled Production Backup run is green (§7.4); A2's policy value renamed `untracked_manual` with explicit isolation rules.

---

## 1. Ground Rules (apply to every work package)

1. **Truth discipline is non-negotiable.** Every new money/stock/alert fact is an append-only row with actor, timestamp and idempotency key; corrections are compensating rows; no UPDATE/DELETE on event tables (add the standard mutation-prevention triggers used by `inventory_movements`/`audit_logs`).
2. **All writes behind RPCs or server actions** following the existing pattern (`SECURITY DEFINER` RPCs with branch/role validation, or service-client actions with `resolveStaffContext`). No client-side Supabase writes. **A server action is never the transaction boundary for a multi-write money/stock operation**: anything that must commit or fail as a unit (collection+tender, refund money+stock+audit, amendment+reprice) is composed inside one PostgreSQL RPC transaction, and every money RPC touching an order serialises on that order's row lock (`SELECT … FOR UPDATE`) so tender, refund, amendment and depletion can never interleave.
3. **Migrations:** timestamp-named `2026MMDDHHMM_v18_<slug>.sql`; after every migration run `pnpm verify:migration-manifest` and commit the regenerated `migration-manifest.generated.ts`. Never edit a shipped migration.
4. **RPC overload hazard (learned in V14/deploy):** never change an existing function's return type via `CREATE OR REPLACE`; never add parameters to an existing RPC name (creates a second overload — this repo already carries overload debt on `admin_create_inventory_batch`). New behaviour = new function name.
5. **Operator surfaces:** every new operator-facing string must pass `verify:operator-language`; no scores/percentages/analytics (intelligence firewall); 64–72px targets; one question per screen; keep all existing `data-testid`s.
6. **Owner strict surfaces (Today, briefing, decision detail, walk):** `verify:owner-brain-compliance` bans `%` characters and the literal word "variance" on strict surfaces, bans new metric panels, and pins `DO_NOW_MAX = 3`. Consequences for this programme:
   * The A1 "money line" is a **Today card outside `buildMorningBriefing`** (the briefing engine is doctrine-bound to zero numbers — do not put figures in briefing sentences).
   * Money wording on Today: "Till matched" / "Till was £9 short" — never "variance", never `%`.
   * If the compliance scan still objects to the money card, amend `docs/v15/Owner-Brain-Compliance.md` + the guard **deliberately in the same PR**, with a comment citing audit finding PTM-OPS-001 — never weaken the guard silently.
7. **Gates per work package (the four-tier system):** `pnpm typecheck` + `pnpm test` (unit) → static `verify:*` guards → db validation scripts against the local stack → live journey gates (`docker up` → `node scripts/seed-dev.mjs` → `npx next start -p 3001` → `BASE=http://127.0.0.1:3001 corepack pnpm verify:<gate>`). A package is "code-done" only with all four green; it is "done" only when its validation-gate row in §6 is satisfied.
8. **Checklist changes** (A1, B7, C2): the step definitions live in `src/lib/ops-capture/checklists.ts`; required-numeric enforcement lives in migration `202606291000` (DB-side finish blocker). Any step add/remove needs: definition change + a new migration updating the required-step enforcement + `verify:required-compliance` update + `progress.test.ts` update. Historical sessions are untouched (session rows store their own step events).
9. **No calendar estimates.** Scope uses XS/S/M/L as in the audit.
10. **Deploy runbook per phase:** merge to main → `supabase db push --linked` (backup first per runbook) → `npx vercel --prod --yes` → smoke `/api/health` (build id + 41+n/41+n manifest parity). Prod push requires the same care as the V15 deploy (migration-history repair incident).

---

## 2. Decision Gates (blocking inputs from Dad)

Work can start on any package whose gate is answered. Proposed defaults let Dad approve quickly; any override changes config, not design.

| # | Decision | Blocks | Proposed default |
| --- | --- | --- | --- |
| D-1 | Accept +1 tap (Cash/Card) at online-order collection | A1 | Yes |
| D-2 | Till variance alert threshold | A1 (config only) | £5 |
| D-3 | Which products sell by each/box; confirm they start "not stock-counted" | A2 (final catalogue pass only) | All current `each`/`box` products → `untracked_manual` |
| D-4 | Urgent-alert channel + number; which events interrupt immediately | B1 | WhatsApp via Twilio to `owner_contact`; critical list = fridge/equipment help, critical checklist skip, not-opened-by-time, till short beyond 3× threshold |
| D-5 | Owner Away contract sign-off (audit §13 table) | B1 copy, §6 away trial | As written in audit §13 |
| D-6 | Refund authority + alert-above value | B3 | Manager-only; alert ≥ £20 |
| D-7 | Photo bytes in backups: accept loss or fund storage export | C7 scope | Accept loss for pilot; revisit after |
| D-8 | Reconciliation-day tolerances (cash £, stock kg) | Phase A exit | Cash ±£2; stock ±0.2kg per counted product |
| D-9 | Drawer cash movements: may the operator record money in/out of the till (change, supplier payment, owner withdrawal, cash drop), or does Dad commit to the pilot invariant "no cash enters or leaves the drawer except recorded sales, refunds and the opening float"? | A1 (UI exposure only — the `till_events` table and RPC ship either way) | Operator + manager may record via the guided "Till money in / out" flow; the invariant-only mode is the fallback if Dad prefers it |

---

## 3. Phase A — Truth and Trade Blockers

### A1 — Payment truth (PTM-OPS-001) — scope M

**Migration 1 `v18_payment_events`:**
* Table `payment_events`: `id uuid pk`, `branch_id`, `order_id fk`, `direction text check in ('sale','refund')`, `method text check in ('cash','card')`, `amount_pence int check (> 0)`, `actor_id`, `reason text null`, `idempotency_key text unique not null`, `created_at`. RLS: staff-read own branch; **no client insert policy** (writes only via RPC). Append-only triggers + revoke UPDATE/DELETE.
* Table `till_events` (drawer cash movements outside sales/refunds): `id uuid pk`, `branch_id`, `kind text check in ('paid_in','paid_out','cash_drop','correction')`, `signed_amount_pence int check (<> 0)` with sign enforced per kind (`paid_in` > 0; `paid_out`/`cash_drop` < 0; `correction` either), `reason_code text check in ('change','supplier','owner','other')`, `note text null`, `actor_id`, `idempotency_key text unique not null`, `created_at`. Same RLS/append-only/no-client-insert model.
* **Exactly two money-writing RPCs exist in the whole programme** — there is deliberately no generic `record_order_tender` (a shared tender RPC with a whole-order amount was contract-incompatible with partial refunds). A1 ships the first; B3 ships the second (`refund_order_v18`):
  * RPC `collect_order_with_tender(p_order_id, p_method, p_idempotency_key, p_note default null)` — **one transaction**: `SELECT … FOR UPDATE` on the order row (the serialisation point every money RPC shares — rule 1.2), validate `ready→collected` and perform the transition (reusing `transition_order_status` logic in the same transaction, so depletion stays coupled exactly as today), derive `amount_pence` server-side from the order's effective subtotal (B4 later upgrades this body to read the frozen folded version — body-only `CREATE OR REPLACE`, same name/signature per rule 1.4), insert the `payment_events` sale row, write audit. If the tender insert fails for any reason, **the whole transaction rolls back — a collected-without-tender row is impossible on this path** (proved by a fault-injection DB test, §Guards). Idempotent replay by key returns the existing outcome; a concurrent second caller finds the row locked/collected and gets "already collected" with no second event.
* RPC `record_till_event(p_kind, p_amount_pence, p_reason_code, p_note, p_idempotency_key)` — validates sign-per-kind, staff+branch, inserts + audit; retry-safe by key.

**Server/actions:**
* Counter collect action: replace the bare transition call for `ready→collected` with `collect_order_with_tender`; the UI passes the chosen method.
* Operator serve (`src/app/actions/operator/serve.ts` `collectOrder`): final hop uses `collect_order_with_tender` with `payKind` and `operator-serve:${runId}:tender` as the key. Intermediate hops unchanged.
* New service `src/lib/server/payment-truth.ts`: `getDayPaymentPicture(branchId, dateIso)` → `{ expectedCashPence, expectedCardPence, cashSales, cardSales, refunds, tillMovements[], ordersMissingTender[] }`. **Expected cash = opening float + cash sales − cash refunds + Σ signed `till_events`** (paid-ins positive; paid-outs, cash drops negative; corrections signed). Expected card = card sales − card refunds. The float is read from today's opening checklist session payload (`float_ready.value`); if the ritual was skipped, expected cash reports "float unknown" and the variance alert is suppressed — never guessed. Orders collected **without** a payment event (legacy/pre-A1 rows) are listed as `missingTender`, never guessed.
* **Cash-movement UI (gated by D-9):** operator home gains a secondary link in the same visual weight as Help — "Till money in / out" → In or Out? → £ pad → reason tile (Change added / Paid a supplier / Owner took cash / Other + note) → confirm; manager equivalent on the `/admin/orders` day view. If Dad chooses the invariant-only mode instead, the flow is hidden, the invariant is printed on the closing money step ("Only sales, refunds and the float touch this drawer"), and any unexplained variance alert reminds him the invariant is his to keep — the table and RPC ship regardless so the mode is a config flip, not a migration.

**Closing checklist (definition bump + migration 2 `v18_close_money_steps`):**
* `cash_counted` step gains server-provided context: the operator page fetches `getDayPaymentPicture` and renders "Expected in till: £X" above the input (prefill NOT the expected value — the operator must count; only show it), plus a "Money moved today" list (till events: "+£20 change added, −£35 paid supplier") so counted-versus-expected is explainable at the moment it's typed. Payload saves `{ value, expected_pence }`.
* New required-numeric step `terminal_total` ("Card machine total (Z report)") with `expected_card_pence` shown the same way.
* Migration updates the required-numeric enforcement set (successor to `202606291000`) to include `terminal_total`; completion RPC computes and stores `cash_variance_pence` / `card_variance_pence` in the session completion metadata; `abs(variance) > threshold` (from D-2, stored in branch settings — add column `till_variance_alert_pence int default 500`) inserts a warning `owner_alerts` row (kind `till_variance`, entity_ref `close:{sessionId}`).
* **Never block finish on variance** (audit rule). Blocking stays only for missing required numerics.

**Today money card (owner):**
* New component on `/admin/today` below the briefing: yesterday's takings, split, and "Till matched" / "Till was £N short/over" with a link to the closing receipt. Respect rule 1.6 wording constraints. No change to `buildMorningBriefing`.

**UI:** counter collect dialog (Cash/Card, two big buttons, browser-confirm style consistent with cancel); closing step bodies; Today card.

**Guards/tests:**
* Unit: expected-cash/card math incl. float, refunds, **till events (paid-in/out, cash drop, signed correction)**, float-unknown suppression, missing-tender listing; tender idempotency (same key twice → one row); serve retry path (existing runId replay must not double-write tender).
* DB script `scripts/verify-payment-truth.mjs`: collect twice → one event; concurrent collect race → one event; **fault-injection: force the tender insert to fail (constraint trip) and prove the order is NOT collected**; till-event sign constraints; variance alert fires above threshold, not below.
* Static `verify:payment-truth` added to the gate list; E2E: counter collect with tender happy path.

**Acceptance:** audit §30 exit criteria for A1, all four tiers green.

### A2 — Each/box trade unblocked (PTM-OPS-002) — scope M

**Migration `v18_inventory_policy`:**
* `products.inventory_policy text not null default 'kg_batch' check in ('kg_batch','untracked_manual')`; backfill: `unit_type in ('each','box') → 'untracked_manual'`. No depletion change (kg filter stays); no each-batch tables (explicitly rejected by audit).
* **`untracked_manual` isolation rules (enforced, not just labelled):** these products (1) never contribute to quantity-on-hand or stock-value totals; (2) never generate stock-cover, low-stock or expiry claims anywhere (purchasing, Today, owner brain, serve nudges); (3) render "Stock not counted" wherever stock would show, including to Dad; (4) keep their public availability under the existing **manual** `stock_status`/availability controls only; (5) remain **fully included** in sales, tender and product-performance reporting. Guard: new `verify:untracked-isolation` unit battery asserting all five properties against a seeded `untracked_manual` product (in stock maths modules + purchasing/intelligence builders), so a future metric can't quietly re-include them.

**Domain:** `resolveServeLines` accepts `each`/`box` products with integer `quantity` (1–99), priced `quantity × price_per_unit`; remove the refusal at `serve-lines.ts:89` for catalogue-matched non-kg products (custom "Other" lines stay kg+price). `serveSubtotal` already handles unit rows via `line.total`.

**Serve flow UI:** picking a non-kg tile routes to a "How many?" screen: big 1–6 preset buttons + "More" numeric pad (integer only). Label uses the product's unit word ("How many?" for each; "How many boxes?" for box). Then the normal add-more → pay → confirm path. Confirm summary shows "Eggs ×12".

**Stock surfaces:** inventory + purchasing show a plain "Stock not counted" badge on `untracked_manual` products (no fake zero-stock warnings; purchasing excludes them from stock-cover maths and says why — per the isolation rules above).

**Serve action:** item rows already carry `unit_type` and `quantity` — pass through; depletion RPC ignores non-kg lines (existing behaviour, now by declared policy).

**Guards/tests:** serve-lines unit tests (each quantity, box quantity, reject fractional/0/100+); `verify:operator-serve` script extended with an each-item command-path case; operator-language check on new strings; E2E optional (serve flow has no stable E2E — see dossier §19 — add one if feasible while touching this).

**Acceptance:** Gul-rehearsal-ready each sale in ≤6 taps; each sales appear in `getDayPaymentPicture` expected cash/card.

---

## 4. Phase B — Owner Requirement Closure

### B1 — External critical delivery + daily digest + away accuracy (PTM-OPS-004) — scope M

* **Migration `v18_alert_dispatch`:** table `alert_dispatches` (`id, alert_id fk null, kind text check in ('critical_alert','daily_digest'), channel, target, status text check in ('sent','failed','skipped'), detail, attempted_at`), append-only. Add `owner_alerts.delivered_at timestamptz null`.
* **Dispatch service** `src/lib/server/alert-dispatch.ts`: single-channel adapter (Twilio WhatsApp/SMS per D-4) with a `CHANNEL_DISABLED` no-op fallback that records `skipped` — unconfigured = today's behaviour plus a visible warning on `/admin/away` and setup ("No delivery channel set").
* **Hook:** `createOwnerAlert` (operator adapter) and the shortfall trigger path: after insert, if `severity='critical'` → dispatch + stamp `delivered_at`. Trigger-created alerts (shortfall) get picked up by the digest job's "undelivered criticals" sweep instead of calling HTTP from Postgres.
* **Daily digest:** script `scripts/send-daily-digest.mjs` (service env) composing the audit §13 digest (opened/closed by whom, takings + split + till result, deliveries + pending costs, waste, shortfalls, open-alert count, or "Nothing needs you today"); idempotent per (branch, date) via `alert_dispatches` check. Scheduled via a new GitHub Actions workflow (same pattern/secrets model as backups). **Depends on the repo's open blocker: Actions secrets are currently EMPTY — this inherits the same owner setup task.** Also send immediately when Owner Away toggles on.
* **Help screen phone fallback:** show `owner_contact` as a tap-to-call `tel:` button on `/operator/help` ("If it's urgent, ring:") — ship this first; it needs zero infrastructure.
* **Away accuracy:** replace capped-row-derived counts in `owner-away.ts` with aggregate `count`/`sum` queries; keep `.limit(n)` only for the preview lists. Unit-test with >20 orders in window.
* **Guards/tests:** digest snapshot unit test; dispatch idempotency; `verify:owner-away` extension for uncapped counts.

### B2 — One owner work tray, full alert lifecycle (PTM-OPS-003) — scope M

* **Migration `v18_alert_lifecycle`:** `owner_alerts` gains `seen_at`, `claimed_by`, `claimed_at`, `resolution_note` (nullable). Keep `resolved_at`. No expiry/snooze columns (rejected).
* **Domain registry:** extend `src/lib/domain/reconciliation.ts` → `alert-registry.ts`: `ALERT_KINDS` map with per-kind `{ title, action: 'inline-cost'|'confirm-reason'|'link'|'note-resolve', href builder, autoResolve rule }` covering: help_* kinds, checklist skip, delivery details check, questionable sale, `inventory_shortfall`, `till_variance` (new from A1), `certificate_expiring` (new from B7), backup stale (C7). Existing two reconcile kinds keep their exact behaviour (their unit test pins them — extend the test, don't fight it).
* **Auto-resolve wiring:** shortfall alerts resolve when a stock count/adjust touches the product (hook in `ops_apply_stock_count_line` / adjust action — server-side, same pattern as the existing reconcile self-heal); checklist-skip resolves if the step is later completed.
* **Reclassification:** stop creating `low_stock_during_sale` owner_alerts from the serve adapter; the fact moves to purchasing/digest (B1) — grandfather existing rows as note-resolve.
* **UI:** `/admin/reconcile` becomes "Owner jobs": grouped by kind with counts, claim-on-submit semantics generalised from the existing action, resolve-with-note for kinds without a richer action; Today banner shows open count; `/admin/away` alert panel links here instead of duplicating.
* **Tests:** registry unit tests (every kind has action+resolution); auto-resolve db script; E2E: seeded tray → resolve each class.

### B3 — Refunds + operator mistake flag (PTM-OPS-005) — scope M (depends A1)

* **RPC `refund_order_v18(p_refund_operation_id uuid, p_order_id, p_lines jsonb, p_method, p_stock_outcomes jsonb, p_reason)`** — the programme's second and last money-writing RPC, **one transaction** (rule 1.2):
  1. `SELECT … FOR UPDATE` the order row (same serialisation point as collection) and read its payment events under that lock;
  2. compute the refundable amount **server-side** from the selected lines' effective state (folded amendments once B4 exists; snapshots before that — identical when no amendments exist);
  3. **reject if cumulative refunds would exceed net payment received** (Σ sales − Σ prior refunds), and reject line quantities beyond what was sold minus already refunded;
  4. insert the `payment_events` refund row (`idempotency_key = 'refund:' || p_refund_operation_id`);
  5. apply the per-line stock outcome in the same transaction: `restock` → compensating `inventory_movements` in the existing schema, grouped in `inventory_reversal_groups` **keyed by the refund operation id** (line-scoped; the whole-order `admin_reverse_order_inventory` and its `(order, reason)` key remain for legacy admin use but are not called here); `discard` → waste event + movement; `none` → nothing;
  6. write audit rows; return the complete refund receipt (money, per-line outcomes, remaining refundable).
  All-or-nothing: **a refund's money event and its inventory outcomes either all commit or none do** — a server action never stitches them.
* **Idempotency is the client-generated `p_refund_operation_id`**, not `(order, reason)` — two legitimate refunds may share a reason; replay of the same operation id returns the original receipt; over-refund is prevented by the cumulative check, not by key uniqueness.
* **Server action** is a thin validated caller: role gate (manager-only per D-6), input shaping, owner alert when ≥ D-6 value.
* **UI:** "Refund / fix" on collected counter cards + `/admin/orders` detail; three-step dialog (what → why → money+stock summary → confirm). Blocked for staff role per D-6.
* **Operator mistake flag:** `/operator/help` gains problem choice "I made a mistake just now"; creates `owner_alerts(kind='operator_mistake_flag', entity_ref=<latest completed run ref>)` with the run's result_ref, resolvable in the tray (B2 registry entry: link to order/batch + note-resolve).
* **Tests:** operation-id replay returns original receipt (no double refund); two distinct refunds, same reason, both succeed within the cumulative cap; cumulative over-refund rejected; **fault-injection: waste/restock step forced to fail → refund payment event does NOT exist** (rollback proof); partial line refund math; refund against an order with zero recorded tender rejected with a clear message; day receipt shows refund (with C1); E2E refund happy path.

### B4 — Weigh-at-handover amendments (PTM-OPS-006) — scope M (depends A1)

* **Model: ordered event folding, not "latest amendment per item"** (latest-wins loses composed edits — substitute lamb for beef, then adjust the lamb's weight, then remove part: only a fold sees all three). Amendments are an ordered event log; effective lines are derived by folding events in sequence over the immutable snapshots. The fold is a **pure domain function** (`foldAmendments(items, amendments) → effectiveLines`) shared by SQL (for the RPCs) and TypeScript (for display), with a unit battery on composed cases as its contract.
* **Migration `v18_order_amendments`:** table `order_amendments` (`id, branch_id, order_id, order_item_id, sequence int not null, kind check in ('weight_adjust','substitute','remove'), old_quantity, new_quantity, old_line_total_pence, new_line_total_pence, substitute_product_id null, actor_id, reason null, idempotency_key unique, created_at`), **unique `(order_id, sequence)`** for deterministic ordering, append-only + audit. `order_inventory_depletions` gains `amendment_seq int` — the frozen version consumed at collection.
* **RPC `amend_order_item_v18(…, p_expected_seq)`** — one transaction: `SELECT … FOR UPDATE` on the order row (the same lock collection takes, so **an amendment can never race a collection, tender or depletion**); reject unless status ∈ (`prepping`,`ready`) — once collection has begun the lock + status check make post-collection amendments impossible by construction (post-collection fixes are B3 refunds); optimistic concurrency: reject unless `p_expected_seq` = current max sequence (a stale screen must refetch, never blind-append); prices recomputed server-side (substitute → target product's live price; weight_adjust → reprice at the line's effective unit price).
* **Collection freezes one version (migration: body-only upgrade of `collect_order_with_tender`):** under the held order lock it folds the amendment log once, records `amendment_seq = max(sequence)` on the depletion summary, and derives **tender amount and depletion quantities from that single folded state** — the required invariant: *collection freezes one effective order version, and payment plus depletion use that identical version.* `deplete_order_inventory`'s item source reads the same fold (surgical change, guarded below).
* **UI:** "Adjust" on ready cards → per-line actual weight numeric / substitute picker / remove; both ordered and final shown. Customer status page shows final line ("1.24kg @ £8.90/kg").
* **Tests:** fold unit battery (substitute→adjust→partial-remove composition; remove-then-adjust rejected; ordering stability); stale `p_expected_seq` rejected; amendment idempotency; amend-after-collected rejected; **concurrency test: amend and collect raced → exactly one wins, the other errors cleanly, frozen `amendment_seq` matches what was tendered and depleted**; depletion consumes folded kg; tender amount = folded subtotal; `verify:amendment-depletion` identity proof (no amendments → movement rows byte-identical to today's behaviour on the seeded fixture); E2E catch-weight collect.

### B5 — Serve shows the price (PTM-OPS-007) — scope S (pairs with A2)

* Serve page already loads product prices for tiles; compute line price client-side for display only (server stays authoritative at save — display mismatch guard: after save, if server subtotal ≠ displayed subtotal, show the server total on the done screen with "Price updated"). Amount screen shows "≈ £6.30" per preset; confirm screen shows each line's £ and "Total £12.60"; done screen echoes the saved total (extend `saveSimpleSale` result message to include it).
* `verify:operator-language` and serve component tests updated; rehearsal script (A0.3) updated in `/admin/guide`.

### B6 — Mid-flow draft persistence (PTM-OPS-009) — scope S

* No schema change. Flows (serve, stock, waste) call `saveOperatorRun(status:'in_progress', steps: <mode + answers>)` on each mode transition — **debounced and awaited, never fire-and-forget** (requires `saveOperatorRun` to start returning success/failure — today it discards the upsert result, which would make the state chip a lie). Draft failures are non-blocking but **never silent**: the flow header shows a small persistent state chip — `Saved for resume` / `Saving…` / `Not saved for resume` — and a failed save retries automatically on the next transition. The chip is the honesty contract: the UI only implies recovery that the server actually holds. Wording via `verify:operator-language` (plain, non-alarming: "Not saved for resume — keep going, the sale still works").
* The real operation (sale/delivery/waste save) is **never** blocked or delayed by draft state — completion uses the existing runId idempotency regardless of draft health.
* Repeated failures (≥3 consecutive within a run) write an operational log line (server logger + a `draft_failures` counter in the run's `steps` payload) so a systemic problem (RLS, quota, connectivity) is visible in ops review rather than discovered as "resume never works".
* Entry screens query newest same-day `in_progress` run for (operator, workflow): "Carry on where you left off? / Start fresh" — the resume prompt describes only the **last successfully saved step** ("Saved up to: How much?"); if the final save failed, resume honestly offers the older state. Start-fresh marks the old run abandoned (status value exists for checklists; else `steps.abandoned=true`).
* Two-device duel: resume shows what's saved; completing either wins by runId idempotency (existing).
* Tests: unit for draft serialisation round-trip + chip state transitions (save ok → fail → retry-recover); simulated save failure shows `Not saved for resume` and does not block completion; E2E refresh-mid-delivery resume.

### B7 — Certificates out of the operator's morning + expiry alerts (PTM-OPS-008) — scope XS

* Remove `certs_visible` from `OPENING` in `checklists.ts`; migration updates required/critical step enforcement set; `verify:required-compliance` + progress tests updated.
* Expiry scan in the digest job (B1): supplier documents expiring ≤30d → tray alert (kind `certificate_expiring`, dedupe by document, escalate severity at ≤7d/expired). Registry entry links to `/admin/compliance`.

---

## 5. Phase C — Workflow Simplification (all independent unless noted)

| Pkg | Finding | Implementation sketch | Scope |
| --- | --- | --- | --- |
| C1 | PTM-OPS-014 day receipt | `src/lib/server/day-receipt.ts` composing existing facts (sessions, orders+payment events incl. missing-tender, amendments/refunds, waste, temps, open alerts) → Today card "Yesterday: complete ✓ / 2 things missing" + per-date section on `/admin/orders?date=`. Honest boundary line: "money truth begins {A1 go-live date}". Depends A1 (money rows). | S |
| C2 | PTM-OPS-010 closing self-answers | Closing waste step body: if waste events exist today → auto-note "N items logged" (auto-done state recorded with `source:'system'` payload); else "Any waste today?" → No = explicit claim payload; Yes = deep-link `/operator/waste?return=close` (waste flow gains a return-to param). Stock glance: link to a read-only operator stock list. Checklist definition bump per rule 1.8. | S |
| C3 | PTM-OPS-011 one temperature truth | Checklist temp steps (`fridge_temp`, `fridges_closed`) also write a compliance reading via the existing compliance RPC path inside `recordChecklistStep`'s server action (idempotent per session+step). Compliance day view labels source ("recorded at opening"). `verify:required-compliance` still green; compliance page dedupe test. | S |
| C4 | PTM-OPS-012 promised-kg signal | Aggregate service: open (incoming/prepping/ready) order snapshot quantities per kg product for today/tomorrow. Surface: purchasing + inventory column ("Promised: 3.2kg"); serve interstitial only when a sale would cut into today's promised kg ("Also promised for collection today — still sell?" Yes/No, advisory). Careful: the interstitial is one extra screen only in the conflict case; operator-language check. | S |
| C5 | PTM-OPS-013 surface merges | `/admin/open` + `/admin/close` → `redirect()` to `/operator/open|close`; port the ops-capture E2E to the operator skin (closes the dossier's operator-skin E2E gap); `/counter/orders/[id]` → expanding board card, route becomes redirect to `/counter`. Update anything linking the retired routes (checklist `action.href`s from C2, Today links, tests, guards). | S |
| C6 | PTM-OPS-015 ran-out feeds buying | Purchasing service joins open/recent `help_ran_out`/shortfall alerts by product → annotation line ("Ran out 3× this month"); tray action "Noted for next order" resolves. Depends B2 registry. | XS |
| C7 | PTM-OPS-016 backup freshness for the owner | Setup + releases render one plain sentence from `ops_backup_runs` freshness; stale/failed → tray alert (kind `backup_stale`, warning) surfaced via digest. Registry entry links `/admin/releases`. D-7 decides whether a storage-object export lands in the backup workflow (S extra if yes). Depends B1/B2 for delivery; the sentence itself has no dependency. | S |
| C8 | PTM-OPS-017 upload pending/retry | Evidence rows already have `failed` status: flows stop blocking on upload (already true), failed/pending uploads render as a retry chip on `/operator` home ("1 photo didn't send — tap to retry") until sent or discarded. Run the §6 weak-network drill before building anything further. Depends B6 (shared run/draft plumbing). | S |

## Phase D — Evidence-Led (build only after the §6 evidence exists)

| Pkg | Finding | Trigger evidence | Sketch | Scope |
| --- | --- | --- | --- | --- |
| D1 | PTM-OPS-021 prioritised counts | §6 reconciliation-day baseline | Order count list by existing confidence signal; "priority 5 done" waypoint allows finishing after subset | S |
| D2 | PTM-OPS-018 hub metric census | Dad usage observation (§6.1) | Move buying-adjacent panels to purchasing; rest behind one "More detail" disclosure; respect surface-convergence guard | S |
| D3 | PTM-OPS-019 walk resolve-or-retire | Same observation | Either per-day "reviewed" presentation flag or retire route | XS |
| D4 | PTM-OPS-020 SMS state visible | none (cheap) — may pull into C | Setup + day-receipt line from `sms_log` aggregates; failing-streak warning alert | XS |
| D5 | Deferred capabilities (audit §29) | real-shop evidence, per item | terminal API, PO/invoice matching, each-count stock, scale/barcode, receipts, offline queue, recall UI, transfers, multi-branch, support cases, sensors | M–XL |

---

## 6. Sequencing, Branches and Validation Gates

**Dependency graph (build order):**

```
A1 ──┬─→ B3 ─→ (day receipt refund lines in C1)
     ├─→ B4
     └─→ C1
A2 ──→ B5 (price display covers each lines)
B1 ──→ B7 (digest carries expiry scan) ──→ C7 delivery
B2 ──→ B3 (mistake-flag tray), C6, C7 tray entries
B6 ──→ C8
Independent anytime: B5 (display part), B6, C2, C3, C4, C5, D4
```

**Suggested branches / PRs (one reviewable unit each):** `v18-a1-payment-truth`, `v18-a2-each-box`, `v18-b1-dispatch-digest`, `v18-b2-owner-tray`, `v18-b3-refunds`, `v18-b4-amendments`, `v18-b5-serve-price`, `v18-b6-drafts`, `v18-b7-certificates`, then `v18-c*` individually. Phase A branches may develop in parallel; land A1 first (A2 touches serve too — rebase order A1 → A2 → B5).

**Validation gates between phases (from audit §25/§30 — these are hard gates, not ceremonies):**

| Gate | After | Evidence required (recorded in `docs/audits/`) |
| --- | --- | --- |
| G-A | Phase A code-done | **Phase-A-scope reconciliation day** — tests only what Phase A builds (this deliberately narrows audit §25.3, which is completed at G-B; no manual seeding of unbuilt B3/B4 capabilities — hand-crafted rows would violate rule 1.2 and prove nothing): walk-in kg cash sale; walk-in kg card sale; walk-in each sale; walk-in box sale; online cash collection; online card collection; double-tapped collection (one event); concurrent collection attempt (one event, clean error); payment-insert failure rollback (fault-injection evidence from the DB battery re-run against the live stack); deliberate till discrepancy detected within D-8 tolerance; deliberate terminal-total discrepancy detected; recorded cash movement reflected in expected cash (if D-9 enables the flow); missing opening float → "float unknown", alert suppressed; legacy collected order without tender listed as missing tender. Plus: timed Gul serve rehearsal (kg + each), zero abandoned sales |
| G-B1 | B1 lands | Seeded critical alert received on Dad's phone < 5 min; digest received on a real morning |
| G-B | Phase B code-done | **Full reconciliation day (completes audit §25.3)**: everything in G-A **plus** a real refund traced through till variance/waste/receipt, a catch-weight amendment traced through folded depletion + tender, and a wrong-weight correction via the operator mistake flag → owner task → correction; staged owner-away trial stages 1–2 (§25.4); Dad clears a seeded tray unaided |
| G-C | Phase C code-done | Weak-network/device drill (§25.5) incl. refresh-resume, device swap, upload retry, double-tap sweep; Dad answers "was yesterday complete?" < 30s from the day receipt |
| G-D | before any D5 item | The specific field evidence named in its row |

**OR-11 (owner away a week) is only claimable after away-trial stage 3 — no code package alone closes it.**

---

## 7. Risks and Gotchas

1. **Prod migration push** — repo↔prod migration history diverged once before (V15 deploy); always `supabase db dump --linked` backup + `migration list --linked` before `db push`; never repair-then-push without a schema diff.
2. **`transition_order_status` is load-bearing** (V11.2 re-route, V14 depletion). A1/B4 wrap or read around it via new RPC names; do not modify its body except where B4's depletion quantity source requires the depletion RPC change — that change gets its own migration + full inventory validation battery.
3. **Guard collisions:** `cta-contrast.test.ts` pins literal hexes on the walk-start link; owner-brain-compliance bans `%`/"variance" on strict surfaces (§1.6); `verify:surface-convergence` documents the admin surface set — C5 route retirements must update it; `reconciliation.test.ts` pins the two-kind list — B2 extends the registry under a new name and keeps that test meaningful for the inline-cost kinds.
4. **GitHub Actions state (re-verified 2026-07-13 during this plan's review — the earlier "secrets empty / 0 green runs" blocker is stale and closed):** all five secrets configured 2026-07-12 (`BACKUP_ENCRYPTION_KEY`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `CANONICAL_BRANCH_ID`) and the **scheduled** Production Backup run succeeded 2026-07-13 03:12 (plus green manual runs). B1's digest workflow reuses this proven pattern; its only new setup is the notification-channel secret(s) from D-4 (e.g. Twilio), and B1 still ships the `skipped`-dispatch fallback so an unconfigured channel degrades honestly, never silently.
5. **Serve E2E gap** (dossier §19): A2/B5 touch serve heavily with no browser E2E safety net — add at least one serve E2E in A2 before B5 builds on it.
6. **Float payload coupling** (A1): expected-cash reads the opening session's `float_ready` payload; if the ritual was skipped that day, expected cash shows "float unknown" and the variance alert is suppressed (never guess).
7. **Language/tone drift:** every operator string in A2/B3/B5/B6/C2/C4 goes through `verify:operator-language`; digest copy (B1) is owner-facing and follows the briefing's plain-English doctrine.
8. **Amendment/depletion interaction** (B4) is the riskiest change in the programme — it alters what quantity depletes. Ship behind the full DB validation battery + a dedicated `verify:amendment-depletion` script proving: no amendment → identical behaviour to today (byte-identical movement rows on the seeded fixture).

---

## 8. Out of Scope (unchanged from audit §29)

Card-terminal API, supplier POs/invoice matching, each/box **count** tracking, scale/barcode, receipt printing, SMS provider procurement (visibility only in D4), offline write queue, customer self-amendments, support-case entity, recall workflow UI, storage transfers, carcass live transformation ledger, multi-branch, prepping→incoming undo, fridge sensors, native owner push app.

---

## 9. Definition of Done for the Programme

All Phase A–C packages code-done with four green tiers; gates G-A, G-B1, G-B, G-C evidenced in `docs/audits/`; owner scorecard re-run showing OR-25/-27 → FULLY_MET, OR-12/-14/-16/-18/-22/-23/-24 improved to at least TECHNICALLY_MET_OPERATIONALLY_WEAK→FULLY_MET or PARTIALLY_MET→TMOW as their packages land; OR-11 status decided solely by the away trial. Phase D proceeds item-by-item on evidence, or not at all.

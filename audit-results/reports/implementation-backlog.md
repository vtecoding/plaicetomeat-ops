# Implementation Backlog — PlaiceToMeat Ops

Every item has an acceptance test. Ordered by priority. Evidence references the audit reports in this folder.

## P0 — Security / Correctness (gate launch)

- [ ] **Build staff/owner login.**
  - Evidence: no `/login` route or `signInWithPassword` anywhere; all protected routes redirect home for everyone.
  - Fix: `/login` page → Supabase email/password (or magic link) → set SSR cookie → record `login_attempts` (success/fail, lock after N) → redirect by role (`/admin` for manager/owner, `/counter` for staff).
  - Test: Playwright logs in as seeded `manager@…` and reaches `/admin`; as `staff@…` reaches `/counter` but is redirected from `/admin`; 5 bad passwords produce a lockout row and a blocked 6th attempt.
  - Files: `src/app/login/page.tsx` (new), `src/lib/supabase/browser.ts`, `src/middleware.ts`, server action for attempt logging.

- [ ] **Persist counter status transitions.**
  - Evidence: `counter-dashboard.tsx:64-76` mutates local state only; a refresh discards changes.
  - Fix: server action updates `orders.status`, inserts `order_status_events(actor_id, status, note)` and an `audit_logs` row; dashboard re-reads from DB.
  - Test: move an order Incoming→Prepping→Ready, reload `/counter`, assert status survived and one `order_status_events` row exists per transition with the acting staff id.
  - Files: `src/components/counter-dashboard.tsx`, `src/app/actions/orders.ts` (new), `src/lib/server/orders.ts`.

- [ ] **Real realtime (no fake badge).**
  - Evidence: `getSupabaseBrowserClient` unused; no `.channel()`; badge is a `useState` literal.
  - Fix: subscribe to `orders`/`order_status_events` for the branch via Supabase realtime; polling fallback; badge reflects actual connection state.
  - Test: two browser contexts on `/counter`; a status change in A appears in B within 3s with no manual refresh; killing the socket flips the badge to "paused" and polling continues.
  - Files: `src/components/counter-dashboard.tsx`, `src/lib/supabase/browser.ts`.

- [ ] **Wire admin product CRUD with audit.**
  - Evidence: `grep src/app/admin` shows demo data only; "Add product" inert; settings inputs have no action.
  - Fix: manager-guarded server actions for create/edit/price/stock; price change writes `audit_logs`; public `/shop` reflects `is_available`/`stock_status`.
  - Test: edit a product price in `/admin/products`, assert DB row + `audit_logs` entry; mark out-of-stock and assert `/shop` hides/greys it and `create_checkout_order` rejects it.
  - Files: `src/app/admin/products/page.tsx`, `src/app/actions/products.ts` (new).

## P1 — Launch hardening

- [ ] **Safe checkout test mode + verified live order path.**
  - Evidence: end-to-end submission not executed on live (would create a real order).
  - Fix: test branch or `idempotency_key`/notes-tagged test orders excluded from ops views; or staging deploy.
  - Test: Playwright submits a valid order against the test branch, lands on `/order/{ref}`, asserts a `PTM-YYYY-NNNNN` ref (regex), basket cleared, no UUID shown.
  - Files: `src/lib/server/orders.ts`, `src/app/order/[orderRef]/page.tsx`, e2e spec.

- [ ] **SMS send safety + truthful status.**
  - Evidence: counter fakes "SMS sent"; Twilio dep present, send path unverified.
  - Fix: env-gated send (disabled by default), persist send attempts + failure reason, card shows real state from data.
  - Test: with sending disabled, marking Ready logs an intended-send row and the card shows "queued/sent" from that row, not a hardcoded value; failure sets `smsFailureReason` and a red badge.
  - Files: `src/lib/domain/sms.ts`, order status action.

- [ ] **Fix client phone validation UX.**
  - Evidence: `scripts/probe-phone2.mjs` — HTML `pattern` ignored by Chromium `v`-flag; only `minLength` guards client-side.
  - Fix: validate phone in JS using the same `isUkMobileNumber` rule; show inline field error; keep server Zod as source of truth.
  - Test: typing "aaaaaaaaaaa" shows an inline "Enter a UK mobile number" error and blocks submit; "07700900123" passes.
  - Files: `src/components/checkout-client.tsx`, `src/lib/domain/checkout-rules.ts`.

- [ ] **Owner daily briefing stub on `/admin`.**
  - Evidence: `/admin` is a link grid with no metrics.
  - Fix: top card with today's order count, revenue, orders awaiting prep, and earliest expiring stock.
  - Test: seed 3 orders + 1 batch expiring tomorrow; assert the card shows count=3, correct revenue sum, and the expiring batch.
  - Files: `src/app/admin/page.tsx`, query helper.

- [ ] **Add `@axe-core/playwright` scan + failure-mode tests.**
  - Evidence: accessibility code-inspected only; no network-failure tests run.
  - Fix: axe on `/`,`/shop`,`/basket`,`/checkout`,`/counter`,`/admin`; intercept-and-fail tests for products/orders/checkout/auth APIs asserting a visible error + retry.
  - Test: axe reports zero critical violations on the customer path; a forced 500 on order submit shows a non-silent error and a retry affordance.
  - Files: `tests/e2e/08_accessibility.spec.ts`, `tests/e2e/09_failure_modes.spec.ts` (new).

## P2 — Revenue / retention

- [ ] **Customer aggregate + buy-again.** Test: a returning phone number sees "Order again" prefilling the basket from the last order. Files: customer query (orders by phone), `/shop` or account surface.
- [ ] **Expiring-stock → flash-offer flow.** Test: a batch expiring in ≤2 days appears on an owner "expiring" board with a one-tap "create flash offer" that records the offer and (in disabled-send mode) the intended targeted broadcast. Files: inventory queries, offers table/action.
- [ ] **Public halal traceability page.** Test: page renders supplier certifying body + a "last verified" date sourced from `supplier_documents.verified_at`; an expired cert renders a warning state. Files: `src/app/our-halal-promise/page.tsx` (new).
- [ ] **Counter card: phone, status-age, full items, staff notes.** Test: card shows masked-then-tap-to-call phone, "received Xm ago", all items, and lets staff add an `order_notes` row visible on reload. Files: `counter-dashboard.tsx`.

## P3 — Polish

- [ ] **Hide back-office nav from public.** Test: unauthenticated header does not render "Counter"/"Compliance" links; authenticated staff header does. Files: `src/components/site-header.tsx`.
- [ ] **Inline field-level checkout errors.** Test: each invalid field shows its own message tied via `aria-describedby`. Files: `checkout-client.tsx`.
- [ ] **Hero shows today's hours + slots left.** Test: homepage shows open/close + remaining same-day capacity. Files: `src/app/page.tsx`.

---

### Cleanup note for maintainers
This audit added `scripts/live-audit.mjs` (reusable live crawl) and the one-off `scripts/probe-phone*.mjs`. A temporary `AUDIT_BYPASS` shim was added to `src/middleware.ts` to capture protected screens and has been **reverted** (verified clean). No production data was mutated; no orders were submitted; no SMS were sent.

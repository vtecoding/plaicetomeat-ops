# PlaiceToMeat Ops — Live Audit Report

- **Date:** 2026-05-30
- **Environment:** Production (Vercel) for public + security surface; local `next dev` (demo-data fallback, documented temporary middleware bypass) for protected-screen visual evidence.
- **Live URL:** https://plaicetomeat-ops.vercel.app
- **Playwright:** @playwright/test ^1.60 (Chromium; Firefox/WebKit installed, not swept this pass)
- **Viewports tested:** Desktop 1440×900, Laptop 1280×800, Tablet 768×1024, Mobile 390×844
- **Artifacts:** `audit-results/screenshots/**`, `audit-results/reports/playwright-summary.json`, audit scripts in `scripts/live-audit.mjs`
- **Scope this pass (per agreement):** focused audit + reports + V2 plan. Full 10-file Playwright scaffold, axe scan, and web-vitals capture were deferred (see *Coverage Gaps*).

---

## Executive Verdict

**Can this take real customer orders today?** — *Partially.* The public storefront → shop → basket → checkout path is genuinely production-grade. Client validation, basket enforcement, and a hardened server-side `create_checkout_order` RPC (idempotency, price re-computation, availability, cutoff, capacity, closures, min-order) are all in place. The one missing proof is an end-to-end confirmed live order write (not executed — would create a real order). **A real customer could place a collection order today**, provided Supabase env is set in production and SMS sending is verified safe.

**Can staff run the counter from it today?** — **No.** Two blockers: (1) **there is no login screen anywhere in the app**, so no staff member can authenticate into `/counter` or `/admin` — every protected route redirects home for everyone; (2) the counter dashboard is a **client-side prototype**: status changes live only in React state, are never persisted, write no `order_status_events` or audit log, there is **no realtime subscription** ("Realtime connected" is a cosmetic toggle), and the SMS "sent" badge is faked locally.

**Can the owner trust admin/compliance today?** — **No.** The entire `/admin/*` console is a **static read-only mockup over demo data**: no product create/edit, no price changes, no stock toggles, no settings persistence, no compliance entry — every "action" button is inert. There is no audit trail because no writes occur.

**Biggest launch blocker:** No authentication entry point → the operational half of the product is unreachable by staff, and the operational UI does not persist anything even if reached.

**Biggest competitive opportunity:** The database backbone is already far ahead of the UI. Migrations already define suppliers + halal certificate documents, inventory batches/movements + stock levels, order status history, staff notes, SMS templates, and login-attempt throttling. **Wiring the existing UI to the existing schema unlocks a genuine butcher operating system faster than any competitor can build one** (see `v2-competition-upgrade-plan.md`).

---

## P0 — Critical (blocks launch / trust / security)

1. **No authentication UI exists.** No `/login` route, no `signInWithPassword` call, no auth form anywhere (`grep` across `src/` finds only `auth.getUser`/`signOut` in middleware). Staff cannot sign in; `/counter` and `/admin` are unreachable in production. *Evidence:* route crawl (all protected → redirect /), code search. *Fix:* build an email/password (or magic-link) login page that calls Supabase auth, sets the SSR cookie, records `login_attempts`, and lands the user on `/counter` or `/admin` by role.

2. **Counter status transitions do not persist.** `counter-dashboard.tsx#moveOrder` mutates local `useState` only. No Supabase update, no `order_status_events` insert, no `audit_logs` insert. A page refresh discards all status changes; two tablets show divergent state. *Evidence:* `src/components/counter-dashboard.tsx:64-76`. *Fix:* server action that updates `orders.status`, inserts `order_status_events`, and is the single source of truth; re-render from DB.

3. **No realtime; "Realtime connected" is fake.** `getSupabaseBrowserClient` is never imported; there is no `.channel()`/`postgres_changes` subscription. The badge is a `useState` literal. A new order will never appear on the counter without a manual refresh. *Evidence:* `grep` (no realtime usage), `counter-dashboard.tsx:24,82`. *Fix:* subscribe to `orders`/`order_status_events` for the branch; fall back to polling.

4. **Admin console performs no writes.** All `/admin/*` pages render demo data; "Add product", settings inputs, pickup-window and compliance screens have no `action`/`onSubmit`/`onClick` handlers. *Evidence:* `grep` across `src/app/admin` shows only `demo*` imports, no server actions. *Fix:* wire CRUD server actions guarded by `is_branch_manager` RLS, with audit logging on price/availability changes.

---

## P1 — Must fix before serious customer usage

1. **End-to-end live order write unverified.** Not executed to avoid creating a real production order. Add a safe test mode (test branch / `idempotency_key` prefix, or a staging deployment) so checkout can be exercised in CI without polluting production. *Fix + test:* Playwright submits a valid order against a test branch and asserts the `/order/{ref}` confirmation renders a human-readable `PTM-YYYY-NNNNN` ref (not a UUID).

2. **SMS send path safety unproven.** Twilio dependency present; `sms.ts` exists; the counter fakes "SMS sent". Before any status change triggers a real text, confirm dry-run/disabled-send mode and message logging. *Fix:* gate Twilio behind an env flag, log every send attempt, expose send status truthfully on the card.

3. **Client phone format validation is silently dropped.** The checkout phone `pattern="(?:\+44|0)7[0-9 -]{9,13}"` produces `patternMismatch:false` for clearly invalid input in current Chromium (the regex is rejected by the new `v`-flag engine and the constraint is ignored). Only `minLength=11` guards the field client-side, so e.g. 11 letters passes the browser check. **Server-side Zod (`ukPhoneSchema`) does reject it**, so this is a UX/conversion gap, not a data-integrity hole — the user gets a late, generic server error instead of inline feedback. *Evidence:* `scripts/probe-phone2.mjs` output; `src/lib/validation/checkout.ts:10-14`. *Fix:* validate phone in JS with a tested regex and show an inline error; stop relying on the HTML `pattern` attribute.

4. **No daily summary / "what do I do next" for owner.** `/admin` is a link grid; there is no order count, revenue, expiring-stock, or action-needed surface. *Fix:* founder daily briefing panel (see V2.5).

---

## P2 — Growth / retention improvements

1. Counter cards omit **customer phone** and a **status-age timer** (urgency border exists but no "received 12m ago"); items truncate at 2 with no "+N more". Staff can't one-tap call or judge wait time precisely.
2. No **buy-again / repeat-order** surface for customers; no lapsed-customer reactivation. (Schema has the order history to power it.)
3. No **bundles / upsells** (Family Curry Pack exists as a product but no pairing/seasonal logic).
4. **Inventory & waste tables exist in the DB but no UI** — the single highest-margin opportunity (expiry → flash offer) is unbuilt at the app layer.

## P3 — Polish

1. Public site header shows **"Counter" and "Compliance" nav links to everyone** (they redirect, but it's confusing and advertises the back office). Hide for unauthenticated users.
2. Checkout has a static "Server checks still run at submission" explainer — good transparency, but inline field-level errors would be better than a single top-of-form alert.
3. Product card images / alt text and heading hierarchy not yet axe-verified (see gaps).

---

## Customer Flow Findings (verified on live)

| Check | Result | Evidence |
|---|---|---|
| Homepage makes halal butcher + collection obvious | ✅ HMC trust badge, address, "order ahead, collect, pay on collection", clear CTA | `public/_root__*` |
| Add to basket persists + count | ✅ 3 items added, persisted to localStorage | `customer/shop__after-add__*` |
| Basket → checkout reachable | ✅ | `customer/basket__with-items__*` |
| Empty basket cannot checkout | ✅ submit **disabled** with reason "Add items to continue" | `customer/checkout__empty-basket__*` |
| Required fields enforced | ✅ name/phone/date/window all `required`, invalid when empty | summary JSON |
| Phone min length enforced (typed) | ✅ rejects "0770" with proper message | `scripts/probe-phone2.mjs` |
| Phone format pattern enforced | ⚠️ client pattern ignored (server Zod catches) | P1.3 above |
| No raw UUID shown to customer | ✅ order ref format `PTM-YYYY-NNNNN` | migration `next_order_ref` |
| Mobile checkout usable | ✅ clean single-column, labeled, good spacing | `responsive/_checkout__mobile-*` |
| Console/network errors on public pages | ✅ none observed | summary JSON |

**Not executed (safety):** final order submission on live, and the `/order/{ref}` confirmation page (requires a real order ref). Flagged for the test-mode work in P1.1.

## Staff Flow Findings (local render + code review)

- Layout is strong: 4-column Incoming/Prepping/Ready/Collected board, urgency-colored cards, ref + customer + window + items + SMS badge + action buttons, audible new-order tone, mobile/tablet layout intact. *Evidence:* `staff/_counter__desktop-*`, `staff/_counter__tablet-*`.
- **Interaction layer is a prototype:** see P0.2/P0.3. Status changes, realtime, and SMS are all simulated client-side. Cancel has a `window.confirm` guard (good) but still doesn't persist.
- Cards lack phone + precise status age (P2.1).

## Admin Flow Findings (local render + code review)

- All six admin screens render and look polished, but are **read-only demo mockups** (P0.4). `/admin/settings` shows editable-looking inputs with `defaultValue` and **no save action**; `/admin/products` "Add product" is inert; `/admin/orders` lists orders with no search/filter; `/admin/compliance` shows demo readings with no entry form. *Evidence:* `admin/_admin_*`, `grep` of `src/app/admin`.

## Responsive Findings

- Public pages (`/`, `/shop`, `/basket`, `/checkout`) captured at all four viewports; no layout breakage observed. Counter board reflows to a usable tablet layout. *Evidence:* `responsive/**`.

## Accessibility Findings (code-inspection only — axe not run)

- Positives: `<label htmlFor>` paired with field `id` on every checkout field; `role="alert"` on the error banner; decorative icons marked `aria-hidden`; single `<h1>` per page.
- **Not verified:** color contrast, focus-visible states, product image alt text, tap-target sizes, ARIA correctness. **Run `@axe-core/playwright` before launch.**

## Performance / Network Findings

- No hydration errors, no uncaught rejections, no broken images, no infinite spinners observed on public routes; local cold compile ~1.2s, first paint fast. **Web vitals (LCP/CLS/INP), bundle analysis, throttled-network, and offline/API-failure interception were not measured this pass** — recommended before launch (failure-mode tests are listed in the backlog).

---

## Route Security Matrix
See `route-security-matrix.md`. **Verdict: PASS** — no protected route leaks to the public; enforced in middleware + RLS.

## Screenshot Index
- `screenshots/public/` — homepage, shop, basket, checkout, privacy (desktop, full-page).
- `screenshots/customer/` — empty-basket checkout (disabled submit), shop-after-add, basket-with-items, empty-fields checkout.
- `screenshots/responsive/` — `/`, `/shop`, `/basket`, `/checkout` at laptop/tablet/mobile + mobile protected-route redirects.
- `screenshots/staff/` — counter board (desktop + tablet), counter compliance.
- `screenshots/admin/` — admin home, products, orders, pickup-windows, shop-closures, compliance, settings, + unauth redirect captures.
- `reports/playwright-summary.json` — machine-readable route + flow data.

## Recommended V2 Build Order
See `v2-competition-upgrade-plan.md` and `implementation-backlog.md`. Summary: **V2.0 production-safety first** (login, persisted status, realtime, admin CRUD, test mode), then **V2.1 operational backbone** (suppliers/certs/inventory/waste — schema already exists), then revenue/retention, butcher moat, and seasonal.

## Coverage Gaps (honest disclosure)
- No live end-to-end order submission (would create a real order; needs test mode).
- No axe accessibility scan, no web-vitals capture, no throttled/offline tests this pass.
- Firefox/WebKit not swept (Chromium only).
- Authenticated flows assessed by code + local render with a temporary, since-reverted middleware bypass — **not** via a real login (none exists).

---

## Final Release Gate: **FAIL**

**Reason:** The public storefront and route security would pass, but the product is presented as a butcher *operating system* and the operational half cannot be used: **no login exists**, the counter **does not persist** status or run realtime, the admin console performs **no writes**, and SMS/end-to-end order writing are **unverified for safety**. The public ordering experience is close to launch-ready; the staff/owner experience is a prototype. Gate flips to PASS once P0 items are resolved and P1.1/P1.2 (test mode + SMS safety) are verified by automated tests.

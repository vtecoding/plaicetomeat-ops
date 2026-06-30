# PTM Route Map

Generated for the full system audit. Enumerated from `src/app/**` (Next.js App
Router) and `src/middleware.ts`. Status reflects live behaviour observed against a
seeded local stack (owner login, 3-viewport screenshot pass, auth-matrix probe).

**Auth model (server-enforced):** `src/middleware.ts` matches `/counter`, `/admin`,
`/operator`. It (1) re-validates the Supabase JWT (`getUser()`), (2) verifies a
signed, user-bound staff-session envelope (idle + absolute timeout), (3) loads the
profile and calls `canAccessStaffPath(role, path, {operatorMode})`. Every staff page
*also* re-checks via `requireStaffContext()` (belt-and-braces). Public/storefront
routes are not matched by middleware and rely on RLS + the public-order-access token
boundary.

Roles: `staff` < `manager` < `owner`. `operator_mode` is a manager-rank account
**locked** to `/operator` (cannot reach `/admin` or `/counter`).

Legend — Status: ✅ working · ⚠️ working with issues · 🔶 incomplete/edge gaps · 🛑 risky.

## Public / customer routes (no auth)

| Path | Purpose | Role | Status | Notes |
|---|---|---|---|---|
| `/` | Storefront landing | public | ✅ | 200, no back-office nav leak |
| `/shop` | Product catalogue | public | ✅ | 200 |
| `/product/[slug]` | Product detail | public | ✅ | Resolved live slug, 200 |
| `/basket` | Customer basket | public | ✅ | 200 |
| `/checkout` | Customer checkout | public | ✅ | Hardened `submitCheckout` (schema + body cap + rate limit + idempotency) |
| `/our-halal-promise` | Halal assurance | public | ✅ | 200 |
| `/privacy` | Privacy policy | public | ✅ | 200 |
| `/order/lookup` | Order lookup (ref + phone) | public | ✅ | 200 |
| `/order/[orderRef]` | Order detail by ref | public | ✅ | **Redirects → `/order/lookup?ref=…`** (token gate, by design) |
| `/order/[orderRef]/cancel` | Cancel by ref | public | ✅ | Redirects → lookup (token gate) |
| `/order/status/[publicAccessId]` | Order status via signed access id | public (token) | ✅ | SECURITY DEFINER RPC returns safe DTO only |
| `/order/status/[publicAccessId]/cancel` | Cancel via access id | public (token) | ✅ | — |
| `/auth/update-password` | Password reset completion | public | ✅ | 200 |
| `/login` | Staff sign-in | public | ✅ | Mints staff-session envelope; lockout + generic error (no user enumeration) |
| `/unauthorised` | Access-denied | public | ✅ | Landing for forbidden staff routes |

## API routes

| Path | Purpose | Role | Status | Notes |
|---|---|---|---|---|
| `POST /api/checkout` | Programmatic checkout | public | ✅ | Same hardened service as storefront; 413 on oversized body, 400 on bad JSON |
| `GET /api/health` | Health probe | public | ✅ | — |

## Counter routes (staff + manager + owner; operator-locked excluded)

| Path | Purpose | Role | Status | Notes |
|---|---|---|---|---|
| `/counter` | Live order board | staff+ | ✅ | Realtime order queue |
| `/counter/compliance` | Counter compliance | staff+ | ✅ | — |
| `/counter/orders/[id]` | Order detail | staff+ | ✅ | `getOrderById`; `notFound()` (Next default 404) on bad id |

## Operator Mode routes (manager + owner; **operator_mode accounts locked here**)

| Path | Purpose | Role | Status | Notes |
|---|---|---|---|---|
| `/operator` | Home — 4 big doors | manager+ | ✅ | One "lead" door computed from checklist state |
| `/operator/open` | Open-shop checklist | manager+ | ✅ | Same ops-capture backend as owner GuidedChecklist |
| `/operator/serve` | Counter sale | manager+ | ⚠️ | Reuses collected→deplete ledger path; **custom "Other" items recorded at £0**, all amounts treated as kg (see CRITICAL_ISSUES) |
| `/operator/stock` | Delivery / ran-out / waste hub | manager+ | ✅ | Escalates to owner on ambiguity; **delivery cost not captured (=0)** |
| `/operator/waste` | Record waste | manager+ | ✅ | Reuses hardened waste RPC; can't exceed batch stock |
| `/operator/certificate` | Paper-photo capture | manager+ | ✅ | Evidence capture |
| `/operator/close` | Close-shop checklist | manager+ | 🔶 | Steps skippable → day can close without a real temperature (compliance gap) |
| `/operator/help` | Help / call owner | manager+ | ✅ | Real escalation → owner_alerts (fridge = critical) |

## Admin / owner routes

| Path | Purpose | Role | Status | Notes |
|---|---|---|---|---|
| `/admin` | Business-insights hub | manager+ | ⚠️ | Renders, but **React duplicate-key console warning** |
| `/admin/today` | Owner Brain TODAY | manager+ | ✅ | Do-now / Later; owner landing |
| `/admin/today/[id]` | Decision detail | manager+ | ✅ | Redirects → `/admin/today` when the action no longer exists (by design) |
| `/admin/today/walk` | Guided shop-day walk | manager+ | ✅ | — |
| `/admin/briefing` | Morning briefing | manager+ | ⚠️ | **Redirects → `/admin/today`**; hydration mismatch logged during redirect |
| `/admin/inventory` | Inventory truth view | manager+ | ✅ | Cache vs ledger; reconciliation signals |
| `/admin/purchasing` | Purchasing / reorder | manager+ | ✅ | — |
| `/admin/stock-count` | Stock count / correction | manager+ | ✅ | Stale-count guard on apply |
| `/admin/compliance` | Compliance / temperature | manager+ | ✅ | — |
| `/admin/orders` | Orders management | manager+ | ✅ | — |
| `/admin/products` | Product management | manager+ | ✅ | — |
| `/admin/settings` | Branch settings | manager+ | ✅ | — |
| `/admin/evidence` | Evidence review | manager+ | ✅ | — |
| `/admin/guide` | Owner guide | manager+ | ✅ | — |
| `/admin/cutting-guide` | Cutting guide | manager+ | ✅ | — |
| `/admin/setup` | Setup checklist | manager+ | ✅ | — |
| `/admin/playbooks` | Playbooks index | manager+ | ✅ | — |
| `/admin/playbooks/[slug]` | Playbook detail | manager+ | ✅ | Resolved `butcher-words`, 200 |
| `/admin/pickup-windows` | Pickup windows | manager+ | ✅ | — |
| `/admin/shop-closures` | Shop closures | manager+ | ✅ | — |
| `/admin/validation/pricing` | Pricing validation | manager+ | ✅ | — |
| `/admin/audit` | Audit trail | **owner only** | ✅ | Manager → `/unauthorised` (verified) |
| `/admin/releases` | Release log | **owner only** | ✅ | Manager → `/unauthorised` (verified) |
| `/admin/away` | Owner away mode | **owner only** | ✅ | Manager → `/unauthorised` (verified) |

## Error / redirect behaviour

- **No custom `error.tsx`, `not-found.tsx`, `global-error.tsx`, or `loading.tsx`
  anywhere in `src/app`.** Unhandled errors and 404s fall back to the unstyled
  Next.js defaults — confusing for a low-literacy operator (see UI/UX findings).
- Middleware redirects: unauth → `/login?returnTo=…`; forbidden → `/unauthorised`;
  operator-locked account hitting `/admin` or `/counter` → `/operator`; config fault
  (missing secret/env) → `/` (fail-closed); unexpected middleware throw → `/`.
- App redirects: `/admin/briefing` → `/admin/today`; `/order/[ref]` → `/order/lookup`.

## Auth-matrix probe (live, this audit)

| Actor | Target | Result |
|---|---|---|
| unauth | `/admin`, `/operator`, `/counter` | → `/login?returnTo=…` ✅ |
| staff | `/admin`, `/operator` | → `/unauthorised` ✅ |
| manager | `/admin/releases`, `/admin/away` | → `/unauthorised` ✅ |
| operator_mode | `/admin`, `/counter` | → `/operator` ✅ (locked) |
| operator_mode | `/operator/serve` | allowed ✅ |
| owner | `/admin/releases` | allowed ✅ |

No route-level role bypass found.

# V11.1 — Emergency Public Security Boundary: Evidence

**Branch:** `v11-public-order-access` · **Baseline:** `v10-phase2-baseline` (`db32b33`)
**ADR:** [adr/0001-public-order-access-boundary.md](../adr/0001-public-order-access-boundary.md)

## Invariants introduced (spec §6.1)

1. A sequential order reference never authorises data access.
2. No public retrieval of an order by `order_ref` alone.
3. No public cancellation by `order_ref` alone.
4. Public responses contain only the documented safe DTO (no phone, email, raw
   id, notes, staff notes, SMS diagnostics, branch internals).
5. Public lookup / establishment / cancellation are rate-limited.
6. Cancellation locks the row (`FOR UPDATE`) and re-checks status in one
   transaction; a cancellation racing a staff transition yields one valid winner.

## Migration

`supabase/migrations/202606051200_v11_1_public_order_access.sql`
SHA-256 `bcf02bc8fa5815183a082812a6cd4dc678a5fa43efe072db7131081e4839169b`

- `orders.public_access_id uuid not null default gen_random_uuid() unique`,
  `public_access_revoked_at timestamptz`, `public_access_version integer not null default 1`.
- `public.normalize_phone(text)` — single SQL phone-matching authority.
- `public.public_rate_limits` table + `public.check_rate_limit(...)` (fixed-window,
  hashed identity, opportunistic prune, RLS-locked table).
- `public.get_public_order_status(uuid)` → safe DTO jsonb (NULL if unknown/revoked).
- `public.establish_public_order_access(order_ref, phone)` → access id only on
  ref+phone match, else NULL.
- `public.cancel_public_order(uuid, reason)` → row-locked, re-checked, conditional
  cancellation with status + audit events.
- **Dropped** `public.cancel_order_by_ref(text, text)` and removed its anon grant.
- `public.create_checkout_order(...)` now returns `{ orderRef, publicAccessId }`.

**Applied locally** and registered in `supabase_migrations.schema_migrations`
(version `202606051200`). Objects verified present; `cancel_order_by_ref` verified
gone; three `public_access_*` columns verified.

**Rollback/forward-fix:** additive. To roll back, restore `cancel_order_by_ref`
from `202605310002` and re-grant; the new columns/functions are harmless to leave.

## Changed files

Application:
- `src/lib/domain/public-order-access.ts` (+ `.test.ts`) — safe DTO, phone
  normalisation (mirrors SQL), forbidden-field tripwire.
- `src/lib/supabase/server.ts` — add `createSupabasePublicClient()` (anon, no session).
- `src/lib/server/order-access-session.ts` — signed HttpOnly access-session cookie.
- `src/lib/server/rate-limit.ts` — hashed-identity bounded limiter.
- `src/lib/server/public-order-access.ts` — use cases calling safe RPCs only.
- `src/lib/server/orders.ts` — parse new checkout jsonb; **remove `getOrderByRef`**.
- `src/app/actions/checkout.ts`, `src/app/api/checkout/route.ts`,
  `src/components/checkout-client.tsx` — establish session, redirect to access-id URL.
- `src/app/actions/cancel-order.ts` — session + access-id required (no ref).
- `src/app/actions/establish-order-access.ts`, `src/components/order-lookup-form.tsx`,
  `src/app/order/lookup/page.tsx` — ref+phone re-establishment.
- `src/app/order/status/[publicAccessId]/page.tsx` + `/cancel/page.tsx` — secure routes.
- `src/app/order/[orderRef]/page.tsx` + `/cancel/page.tsx` — redirect to lookup (no data).
- `src/components/cancel-order-form.tsx` — posts `publicAccessId`.
- `next.config.ts` — security headers (CSP, frame-ancestors, nosniff, referrer,
  permissions, HSTS in prod).

Tests / governance:
- `src/lib/server/public-route-imports.test.ts` — architecture guard (no
  service-role / `getOrderByRef` in the public surface).
- `scripts/verify-public-access.mjs` — adversarial DB harness.
- `tests/e2e/safe-test-order.spec.ts` — rewritten to the secure flow.

## Tests run

| Suite | Result |
|---|---|
| Unit (`vitest run`) | **276 passed / 39 files** (was 254; +10 DTO/phone, +12 import-graph) |
| Typecheck (`tsc --noEmit`) | exit 0 |
| Adversarial DB harness (`scripts/verify-public-access.mjs`) | **18/18 PASS** — see [adversarial-output.txt](adversarial-output.txt) |
| Browser smoke (preview) | lookup 200 + headers; real status 200 no phone leak; unknown id 404; `/order/<ref>` → `/order/lookup`; no console errors |
| e2e (Playwright) | **NOT executed in this environment** — must run in CI (needs built app + stack + browsers) |

### Adversarial cases proven (spec §8.1.6)

- 400 enumerated references + wrong phone → **0** access ids leaked; anon direct
  `orders` SELECT → 0 rows (RLS).
- random access id → null status; unknown id route → 404.
- real ref + **right** phone (any UK format, normalised) → correct access id;
  real ref + wrong phone → null.
- safe DTO carries **no** forbidden field; `customerDisplayName` is first-name only.
- access id A returns/cancels only order A; order B untouched.
- `cancel_order_by_ref` no longer callable; bogus access id cancel rejected, order
  unchanged.
- **race** (staff `transition_order_status` vs `cancel_public_order`), 6 iterations:
  exactly one winner each time, final state always matches winner (no clobber).
- rate limiter: allows up to max then blocks (`[true,true,true,false,false]`).

## Limitations / follow-ups (must be tracked)

1. **CSP `script-src` includes `'unsafe-inline'`.** The Next.js App Router emits
   inline bootstrap scripts and this build has no per-request nonce pipeline.
   All other CSP directives are strict. Nonce-based hardening (middleware nonce +
   production-build verification) is the tracked follow-up.
2. **e2e not executed here.** The rewritten secure-flow spec must pass in CI.
3. **Magic-link establishment and Turnstile challenge not implemented** (spec lists
   both as optional "may"); ref+phone lookup + bounded rate limiting are implemented.
4. **Rate limiter fails OPEN** on storage error (with an ALERT log) to avoid
   locking out real customers; this is intentional per spec §11.2 but means a
   limiter outage degrades protection — alerting must be wired in V11.9.
5. **`ORDER_ACCESS_SECRET` must be set in production** (≥16 chars). Missing in
   production is a visible failure (no silent fallback); dev uses a marked insecure
   secret.

## Production actions required

1. Set `ORDER_ACCESS_SECRET` (≥16 random chars) in the production environment.
2. Apply migration `202606051200_v11_1_public_order_access.sql` to production
   (expand step; additive) and re-run migration parity.
3. Run the full Playwright suite in CI; confirm the secure-flow spec passes.
4. Verify security headers on the deployed origin.
5. Confirm no client retained a deep link to `/order/<ref>` expecting data (none
   shipped; SMS templates contain no such link).

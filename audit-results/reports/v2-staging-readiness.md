# PlaiceToMeat Ops — V2.0 Staging / Hosted Readiness

_Generated 2026-05-31. Local verification only — see final gate._

## Required environment variables

| Variable | Purpose | Default / safe value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (browser + server) | required |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key for SSR auth + RLS-scoped reads | required |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only canonical reads/writes | required (server only, never exposed) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | SMS provider | empty ⇒ SMS records as `disabled` |
| `SMS_SENDING_ENABLED` | Master SMS kill-switch | `false` (must be `true` **and** provider set before any real send) |
| `CHECKOUT_TEST_MODE_ENABLED` | Server gate for safe TEST orders | `false` in production |
| `NEXT_PUBLIC_CHECKOUT_TEST_MODE` | Shows the TEST-order toggle in checkout UI | `false` in production |
| `NEXT_PUBLIC_APP_URL` | Base URL for Playwright/baseURL + links | per environment |
| `NEXT_PUBLIC_BRANCH_SLUG` | Public branch hint | `wylde-green` |

## Supabase project requirements

- Apply all migrations in `supabase/migrations/` in order (7 files, `202605290001` → `202605310002`).
- The app reads the **first active branch** as the public branch and uses the
  signed-in profile's `branch_id` for admin scope. Seed at least one active branch +
  `branch_settings` row, product categories, products, and pickup windows.
- Seed staff/manager/owner profiles linked to `auth.users` (see `scripts/seed-dev.mjs`
  for the local pattern; production needs real invited users, not the test password).

## Realtime publication requirements

- Migrations add `orders`, `order_status_events`, `order_notes`, and `sms_log` to the
  `supabase_realtime` publication and set `REPLICA IDENTITY FULL`.
- Confirm the hosted project has the `supabase_realtime` publication enabled and that
  the counter realtime channel connects; otherwise the UI honestly degrades to polling.

## Auth redirect URL requirements

- Add the hosted origin to Supabase Auth → URL configuration (Site URL + redirect allow-list).
- Middleware redirects unauthenticated staff routes to `/login?returnTo=…`; `returnTo` is
  sanitised to internal paths only.

## Twilio / SMS requirements

- Default is **safe**: with no Twilio env or `SMS_SENDING_ENABLED!=true`, every ready
  transition records an honest `disabled` entry in `sms_log` and sends nothing.
- A real provider client is **not yet wired**; with sending enabled but no client, the
  system records `failed` (with reason) rather than faking `sent`. Wire the Twilio call in
  `src/lib/server/sms.ts` (`buildReadySmsOutcome`, the `mode === "live"` branch) before enabling.

## Test-mode requirements

- TEST orders require **both** `CHECKOUT_TEST_MODE_ENABLED=true` (server gate) and
  `NEXT_PUBLIC_CHECKOUT_TEST_MODE=true` (UI toggle). Keep **both off** in production.
- Test orders are flagged `orders.is_test=true`, visibly badged "TEST ORDER", excluded from
  owner dashboard order-count/revenue, counted separately, and never trigger real SMS.

## Seed credentials required for staging

- Test users (local) all use password `PlaiceTest123!`: `owner@`, `manager@`, `staff@`,
  `staff.b@` (branch B), `inactive@` `ptm.test`. **Do not reuse these in production.**

## Applied-remotely / RLS / hosted test status

- **Local migrations applied remotely:** NO — not performed this session.
- **RLS verified in hosted env:** NO — verified locally only (`verify-ops.mjs` + RLS policies).
- **`/login`, `/counter`, `/admin`, checkout, realtime, SMS dry-run tested in staging:** NO.

```
Hosted validation not completed. Local verification only.
```

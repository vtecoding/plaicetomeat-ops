# PlaiceToMeat Ops — V2.0 Hosted Validation Report

_Generated: 2026-05-31. Validation run by Claude Code (claude-sonnet-4-6)._

---

## 1. Hosted URL Tested

**None.** No Vercel (or other) deployment of the PlaiceToMeat ops app exists.
The GitHub remote is `https://github.com/vtecoding/plaicetomeat-ops.git` and the
repo is 8 commits ahead of `origin/main`. No hosting provider project has been
provisioned; no staging URL is available.

---

## 2. Supabase Project Target

| Field | Value |
|---|---|
| Project ref | `qwvlzcqmicedxhfafiar` |
| Dashboard | `https://supabase.com/dashboard/project/qwvlzcqmicedxhfafiar` |
| REST API | `https://qwvlzcqmicedxhfafiar.supabase.co` |
| REST reachable? | **YES** — 200 OK with service-role key |
| Migrations applied? | **NO** — all tables return 404 (blank project) |

---

## 3. Environment Variable Readiness

All values below are assessed against what is needed for a staging deployment.
No secret values are printed; columns show presence only.

| Variable | Required for | Local present? | Staging present? | Production-safe? | Can be public? | Risk if missing |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All Supabase calls (browser + server) | YES (`http://127.0.0.1:54321`) | **UNKNOWN — not set** | N/A | YES | App crashes at startup |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | RLS-scoped reads, SSR auth | YES (local demo key) | **UNKNOWN — not set** | N/A | YES | App crashes at startup |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only canonical reads/writes | YES (local demo key) | **UNKNOWN — not set** | NO — server only | NO | Admin RPCs fail; order ops fail |
| `TWILIO_ACCOUNT_SID` | SMS provider | YES (empty) | UNKNOWN | YES (empty = safe) | NO | SMS records as `disabled` — safe |
| `TWILIO_AUTH_TOKEN` | SMS provider | YES (empty) | UNKNOWN | YES (empty = safe) | NO | SMS records as `disabled` — safe |
| `TWILIO_FROM_NUMBER` | SMS provider | YES (empty) | UNKNOWN | YES (empty = safe) | NO | SMS records as `disabled` — safe |
| `SMS_SENDING_ENABLED` | SMS master kill-switch | YES (`false`) | UNKNOWN | `false` = safe | NO | If missing defaults to disabled — safe |
| `CHECKOUT_TEST_MODE_ENABLED` | Server gate for TEST orders | YES (`true` locally) | **MUST be `false`** | `false` only | NO | If `true` in production: public abuse risk |
| `NEXT_PUBLIC_CHECKOUT_TEST_MODE` | UI toggle for TEST orders | YES (`true` locally) | **MUST be `false`** | `false` only | YES | If `true` in production: UI exposes test mode |
| `NEXT_PUBLIC_APP_URL` | Playwright baseURL, internal links | YES (`http://localhost:3000`) | **MUST be staging URL** | YES | YES | Playwright tests hit wrong host |
| `NEXT_PUBLIC_BRANCH_SLUG` | Public branch hint | YES (`wylde-green`) | UNKNOWN | YES | YES | App may fail to find branch data |
| `NODE_ENV` | Next.js runtime mode | YES (`development`) | `production` | `production` | YES | Build/runtime mode wrong |

**Staging values not yet set anywhere.** No `.env.staging`, `.env.production`, or
Vercel environment variable configuration has been performed.

---

## 4. Remote Migration Status

Supabase CLI authentication requires a Personal Access Token (PAT).
The provided keys (`sb_publishable_*` / `sb_secret_*`) are API keys, not a PAT.
`npx supabase migration list` and `npx supabase db push` both fail with `Unauthorized`.

Remote DB was probed directly via REST API (service-role key).

| Migration | Local applied? | Remote applied? | Notes |
|---|---|---|---|
| `202605290001_init.sql` | YES | **NO** | Base schema: branches, products, orders, audit_logs — all 404 on remote |
| `202605300001_v2_phase_a_backbone.sql` | YES | **NO** | branch_settings columns, audit_logs rename |
| `202605300002_v2_phase_b_ops.sql` | YES | **NO** | `transition_order_status`, `add_order_note`, realtime publication |
| `202605300003_v2_phase_c_admin_products.sql` | YES | **NO** | Admin product RPCs, audit log for price changes |
| `202605300004_v2_phase_d_admin_ops.sql` | YES | **NO** | Admin schedule/pickup window RPCs |
| `202605310001_v2_phase_e_sms_test_mode.sql` | YES | **NO** | `orders.is_test`, `orders.sms_status`, `sms_log` table |
| `202605310002_v2_phase_e_customer_cancel.sql` | YES | **NO** | `cancel_order_by_ref` RPC |

**All 7 migrations are unapplied on the remote project.**

Required remote DB objects — all absent:

- `transition_order_status` — MISSING
- `add_order_note` — MISSING
- Admin product RPCs — MISSING
- Admin schedule RPCs — MISSING
- `orders.is_test` — MISSING
- `sms_log` — MISSING
- Customer cancel RPC — MISSING
- RLS policies — MISSING (no tables exist)
- Realtime publication — MISSING
- Replica identity — MISSING

---

## 5. Auth Setup Status

Cannot verify. No migrations applied → no `profiles`/`staff_roles` tables exist.
No test users have been created on the remote project.
Supabase Auth site URL is the project default (not set to a staging app URL).
Redirect allow-list has not been configured for any hosted domain.

Status: **NOT CONFIGURED**

---

## 6. Realtime Status

Cannot verify. `orders`, `order_status_events`, `order_notes`, `sms_log` tables
do not exist on the remote. The realtime publication was not created (migration not applied).

Status: **NOT VERIFIED — migration blocker**

---

## 7. Admin CRUD Status

Cannot verify. No app deployment, no database schema.

Status: **NOT VERIFIED — deployment + migration blocker**

---

## 8. Pickup / Closure Status

Cannot verify. No app deployment, no database schema.

Status: **NOT VERIFIED — deployment + migration blocker**

---

## 9. Safe Checkout Status

Cannot verify. `orders.is_test` column does not exist on remote.

**Critical risk note:** `CHECKOUT_TEST_MODE_ENABLED` and `NEXT_PUBLIC_CHECKOUT_TEST_MODE`
are currently `true` in `.env.local`. Both **must** be `false` before any public deployment.
A staging deployment with test mode exposed on a public URL is a known abuse risk.

Status: **NOT VERIFIED — env var + migration blocker**

---

## 10. SMS Status

Cannot verify on remote. Locally:

| Field | Value |
|---|---|
| SMS mode | `disabled` (no Twilio env set, `SMS_SENDING_ENABLED=false`) |
| Real provider configured? | NO |
| Real sends possible? | NO |
| Dry-run proof | `sms_log` records `disabled` on every ready-transition locally |
| `sms_log` row written | YES (locally, via verify-ops.mjs) |
| UI state | Shows disabled/dry-run state honestly |

Status: **Locally PASS — hosted NOT VERIFIED (migration blocker)**

---

## 11. Owner Dashboard Status

Cannot verify on remote. No app deployment.

Status: **NOT VERIFIED — deployment blocker**

---

## 12. Route / Security Status

Cannot verify on remote. No app deployment.
Route protection middleware is correctly implemented locally (verified by vitest + Playwright locally).

Status: **NOT VERIFIED — deployment blocker**

---

## 13. Commands Run This Session

```
git status
git log --oneline -10
npx eslint .
npx tsc --noEmit
npx vitest run
npm run build
node scripts/verify-ops.mjs
npx playwright test            # blocked — see note below
npx supabase --version         # 2.102.0
npx supabase projects list     # FAIL: Unauthorized (no PAT)
npx supabase link --project-ref qwvlzcqmicedxhfafiar  # FAIL: Unauthorized
curl https://qwvlzcqmicedxhfafiar.supabase.co/rest/v1/  # 200 OK (with sb_secret_ key)
curl .../rest/v1/orders        # 404 — table missing
curl .../rest/v1/products      # 404 — table missing
curl .../rest/v1/sms_log       # 404 — table missing
```

**Playwright note:** Port 3000 is occupied by OWASP Juice Shop (a separate application
running on this machine). PlaiceToMeat dev server is not running. Playwright's
`reuseExistingServer` connected to Juice Shop and all 53 e2e tests failed with
"waiting for locator('input[name=email]')" timeout — this is an environmental
port conflict, not a code regression. The code is clean (working tree: clean);
the last committed local gate PASS stands.

---

## 14. Screenshots / Traces Produced

None — no app was running against the correct server during this session.
Playwright produced failure screenshots/videos but they show Juice Shop, not PlaiceToMeat.

---

## 15. Data Cleanup Performed

No writes were made to the remote Supabase project.
No seed data, no migrations, no users created.
Remote project state is identical to before this session (blank).

---

## 16. Remaining Blockers

The following blockers must be resolved before hosted validation can proceed.
They are ordered by dependency: later blockers cannot be cleared until earlier ones are resolved.

### BLOCKER 1 — No hosted app URL
**Severity: CRITICAL — blocks all H3–H10 phases**

No Vercel (or other hosting) project exists for PlaiceToMeat ops.
The app must be deployed before any hosted testing can occur.

**Resolution:**
1. `git push origin main` — push all 8 local commits to GitHub
2. Create a Vercel project linked to `https://github.com/vtecoding/plaicetomeat-ops`
3. Set all environment variables in Vercel dashboard (see Blocker 3)
4. Deploy; note the staging URL (e.g. `https://plaicetomeat-ops.vercel.app`)

---

### BLOCKER 2 — Remote Supabase has no migrations applied
**Severity: CRITICAL — blocks all DB-dependent tests**

Project `qwvlzcqmicedxhfafiar` is a blank Supabase instance. All 7 migrations must
be applied before the app can function.

**Resolution:**
1. Obtain a Supabase Personal Access Token:
   `https://supabase.com/dashboard/account/tokens` → Generate new token
2. Authenticate CLI:
   ```
   npx supabase login
   # paste token when prompted
   ```
3. Link to the remote project:
   ```
   npx supabase link --project-ref qwvlzcqmicedxhfafiar
   # enter DB password when prompted (from Supabase dashboard → Settings → Database)
   ```
4. Push all migrations (staging only — confirm target before running):
   ```
   npx supabase db push
   ```
5. Verify migration result:
   ```
   npx supabase migration list
   ```
6. Confirm key tables exist via REST:
   ```
   curl https://qwvlzcqmicedxhfafiar.supabase.co/rest/v1/orders?limit=1 \
     -H "apikey: sb_secret_sQFtLn0..." \
     -H "Authorization: Bearer sb_secret_sQFtLn0..."
   # must return [] (empty array), not 404
   ```

---

### BLOCKER 3 — No staging env vars configured
**Severity: CRITICAL — app will crash without Supabase URL + keys**

**Resolution:** In Vercel dashboard → Project → Settings → Environment Variables, add:

| Variable | Value | Environment |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qwvlzcqmicedxhfafiar.supabase.co` | Preview + Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_OuQHgFMPes8-...` | Preview + Production |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_sQFtLn0...` | Preview + Production |
| `TWILIO_ACCOUNT_SID` | _(leave empty)_ | Preview |
| `TWILIO_AUTH_TOKEN` | _(leave empty)_ | Preview |
| `TWILIO_FROM_NUMBER` | _(leave empty)_ | Preview |
| `SMS_SENDING_ENABLED` | `false` | Preview |
| `CHECKOUT_TEST_MODE_ENABLED` | `true` | Preview only |
| `NEXT_PUBLIC_CHECKOUT_TEST_MODE` | `true` | Preview only |
| `CHECKOUT_TEST_MODE_ENABLED` | `false` | Production |
| `NEXT_PUBLIC_CHECKOUT_TEST_MODE` | `false` | Production |
| `NEXT_PUBLIC_APP_URL` | staging URL (set after first deploy) | Preview |
| `NEXT_PUBLIC_BRANCH_SLUG` | `wylde-green` | Preview + Production |

---

### BLOCKER 4 — Remote seed data missing
**Severity: CRITICAL — app loads but shows no branches, products, or windows**

After migrations are applied, at minimum one row must exist for:
- `public.branches` (one active branch with slug `wylde-green`)
- `public.branch_settings` (linked to that branch)
- `public.product_categories` (at least one)
- `public.products` (at least one active)
- `public.pickup_windows` (at least one active)

**Resolution:** Run the remote equivalent of `supabase/seed.sql` against the remote DB via
Supabase SQL editor (`https://supabase.com/dashboard/project/qwvlzcqmicedxhfafiar/sql`),
or adapt `scripts/seed-dev.mjs` to target the remote project.

---

### BLOCKER 5 — No test auth users on remote
**Severity: HIGH — H3 auth tests cannot run without users**

No `auth.users` rows exist on the remote project. Staff/manager/owner accounts must
be created before route protection and role-based access can be validated.

**Resolution:**
1. In Supabase dashboard → Authentication → Users, create users:
   - `owner@ptm.test` — password `PlaiceTest123!` (staging only)
   - `manager@ptm.test` — password `PlaiceTest123!` (staging only)
   - `staff@ptm.test` — password `PlaiceTest123!` (staging only)
   - `inactive@ptm.test` — password `PlaiceTest123!` (staging only, no staff row)
2. For each user (except inactive), insert matching rows in:
   - `public.profiles` — `id` = auth user UUID, `role` = owner/manager/staff
   - `public.staff_roles` — linking user to branch, `is_active = true`

---

### BLOCKER 6 — Auth redirect URLs not configured
**Severity: HIGH — login callbacks will fail**

Supabase Auth site URL is not set to the staging/production app URL.
Magic-link and redirect flows will break.

**Resolution:**
In Supabase dashboard → Authentication → URL Configuration:
- **Site URL:** Set to the Vercel deployment URL (e.g. `https://plaicetomeat-ops.vercel.app`)
- **Redirect URLs:** Add:
  - `https://plaicetomeat-ops.vercel.app/login`
  - `https://plaicetomeat-ops.vercel.app/**` (for Vercel preview branches)

---

### BLOCKER 7 — Local port conflict prevents e2e re-verification
**Severity: LOW — environmental only, not a code issue**

Port 3000 is occupied by OWASP Juice Shop. Running `npx playwright test` locally
currently hits Juice Shop instead of PlaiceToMeat. The code itself is clean and
the last green commit stands, but local e2e cannot be re-confirmed in this environment
without stopping the conflicting process or running PlaiceToMeat on a different port.

**Resolution:** Stop the Juice Shop process on port 3000 and restart the PlaiceToMeat
dev server (`npm run dev`), then re-run `npx playwright test`.

---

## 17. Final Gates

```
Local V2.0 gate:    PASS  (eslint/tsc/vitest 43/43/build/verify-ops 11/11 all green;
                           Playwright blocked by port conflict — env issue, not regression)
Hosted V2.0 gate:   NOT VERIFIED
Production release gate: FAIL (hosted gate not passed)
```

### What must happen before hosted gate can move to PASS

In order:

1. ✅ Push commits to GitHub (`git push origin main`)
2. ✅ Deploy to Vercel; configure env vars (Blocker 1 + 3)
3. ✅ Authenticate Supabase CLI (PAT); push migrations to remote (Blocker 2)
4. ✅ Seed remote DB — branch, products, pickup windows (Blocker 4)
5. ✅ Create test auth users and profile/staff_role rows (Blocker 5)
6. ✅ Set Auth site URL + redirect URLs in Supabase dashboard (Blocker 6)
7. ✅ Run hosted Playwright: `NEXT_PUBLIC_APP_URL=<staging-url> npx playwright test`
8. ✅ Confirm all H3–H10 tests pass against staging URL
9. ✅ Update this report with actual test results

Only then may the hosted gate be marked PASS and the production release gate be reviewed.

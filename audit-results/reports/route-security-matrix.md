# Route Security Matrix — PlaiceToMeat Ops

- **Date:** 2026-05-30
- **Live URL:** https://plaicetomeat-ops.vercel.app
- **Method:** Playwright (Chromium) unauthenticated navigation, desktop 1440×900 + mobile 390×844. Evidence in `audit-results/screenshots/`, raw data in `audit-results/reports/playwright-summary.json`.
- **Enforcement layer:** `src/middleware.ts` (matcher `/counter/:path*`, `/admin/:path*`, `/compliance/:path*`) + Supabase RLS policies in `supabase/migrations/`.

| Route | Expected Access | Actual Access (unauth) | HTTP | Screenshot | Severity | Fix Required |
|---|---|---|---|---|---|---|
| `/` | Public | Renders storefront | 200 | `public/_root__*` | OK | None |
| `/shop` | Public | Renders shop | 200 | `public/_shop__*` | OK | None |
| `/basket` | Public | Renders basket | 200 | `public/_basket__*` | OK | None |
| `/checkout` | Public | Renders checkout | 200 | `public/_checkout__*` | OK | None |
| `/privacy` | Public | Renders privacy notice | 200 | `public/_privacy__*` | OK | None |
| `/counter` | Protected | **Redirect → /** | 307→200 | `admin/_counter__*` | OK | None |
| `/counter/compliance` | Protected | **Redirect → /** | 307→200 | `admin/_counter_compliance__*` | OK | None |
| `/admin` | Protected | **Redirect → /** | 307→200 | `admin/_admin__*` | OK | None |
| `/admin/products` | Protected | **Redirect → /** | 307→200 | `admin/_admin_products__*` | OK | None |
| `/admin/orders` | Protected | **Redirect → /** | 307→200 | `admin/_admin_orders__*` | OK | None |
| `/admin/pickup-windows` | Protected | **Redirect → /** | 307→200 | `admin/_admin_pickup-windows__*` | OK | None |
| `/admin/shop-closures` | Protected | **Redirect → /** | 307→200 | `admin/_admin_shop-closures__*` | OK | None |
| `/admin/compliance` | Protected | **Redirect → /** | 307→200 | `admin/_admin_compliance__*` | OK | None |
| `/admin/settings` | Protected | **Redirect → /** | 307→200 | `admin/_admin_settings__*` | OK | None |
| `/compliance` | Protected | **Redirect → /** | 307→200 | n/a (no page; matcher gates it) | OK | None |
| `/counter` (mobile) | Protected | **Redirect → /** | 307→200 | `responsive/_counter__mobile-*` | OK | None |
| `/admin` (mobile) | Protected | **Redirect → /** | 307→200 | `responsive/_admin__mobile-*` | OK | None |

## Verdict: PASS

**No protected route rendered staff/admin UI, order data, customer phone numbers, compliance records, or operational controls to an unauthenticated visitor.** Protection is enforced server-side in Next.js middleware (not client-side hiding), and is backed by row-level security at the database layer (`is_branch_staff` / `is_branch_manager` / `current_profile_role` policy functions). Redirect is a 307 to `/` before any protected component renders.

### Defense-in-depth notes (not failures)
- **Middleware fail-closed:** if `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` are missing, the middleware redirects home rather than rendering (middleware.ts:18-20). Good.
- **Session expiry:** middleware enforces a staff idle timeout via the `ptm_staff_last_seen` cookie (`isStaffSessionExpired`, default 4h) and signs out on expiry.
- **Role separation:** `canAccessStaffPath` restricts `/admin` to manager/owner and `/counter`+`/compliance` to staff/manager/owner; owners bypass branch scoping. Unit-tested in `src/lib/domain/route-access.test.ts`.
- **RLS:** every domain table has RLS enabled with public-read limited to active products/categories/windows/branches and the `get_public_order` SECURITY DEFINER function for order-status lookups (no raw table read for anon).

### Severity legend
- **Critical:** public can see or operate a staff/admin route — *none found*.
- **High:** route appears protected but data/API leaks — *none found*.
- **Medium / Low:** see `ux-friction-report.md` (e.g. public site header advertises "Counter"/"Compliance" nav links to everyone — cosmetic, links redirect).

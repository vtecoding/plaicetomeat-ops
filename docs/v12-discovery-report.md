# V12 Discovery Report

Date: 2026-06-06  
Scope: V12.0 Reproducible Foundation and V12.1 Database Authority Seal only  
Baseline commit inspected: `fb9985ccab3ba1291daa85870bbe8d672b273332`

## Architecture findings

PlaiceToMeat Ops is a Next.js 15 App Router application backed by Supabase
Postgres/Auth/Realtime. The app separates public customer surfaces, staff
counter surfaces, manager/admin surfaces, and owner-only release/audit surfaces.

Core boundaries:

- Public catalogue/status routes use the Supabase anon key and read-only RPCs or
  public RLS-backed reads.
- Checkout is initiated from public UI/API code but, in the current application
  code, order creation is server-only through `submitCheckout()` and the
  service-role transport calling `create_checkout_order`.
- Staff and manager mutations use authenticated Supabase server clients and
  database RPCs that perform branch/role checks in SQL or rely on RLS.
- Public order cancellation is gated by a signed HttpOnly order-access cookie,
  then performed by a service-role-only RPC boundary in
  `src/lib/server/order-access-privileged.ts`.
- Audit rows are intended to be server-generated through
  `emit_audit_log` or trusted business RPCs after V11.2.

## Dependency findings

Package management is currently mixed:

- `package.json` declares `packageManager: pnpm@9.15.9`.
- `pnpm-lock.yaml` exists and should be retained.
- `package-lock.json` also exists and must be removed for V12.0.
- `.github/workflows` is absent.
- `.nvmrc` is absent.
- `package.json` has no `engines` field.

Primary runtime dependencies:

- Next.js `15.5.18`
- React `19.1.0`
- Supabase SSR/client libraries
- Zod `4.4.3`
- Vitest, TypeScript, ESLint, and Playwright for validation

Existing validation commands in `package.json`:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm test:e2e`
- `pnpm playwright:hosted`
- `pnpm release:report`
- `pnpm audit:bundle`

## Migration map

There are 19 historical migrations before V12.1.

| Version | File | Primary impact |
|---|---|---|
| 202605290001 | init | Base branch, product, order, compliance, audit tables; public `get_public_order`; profile helper functions |
| 202605300001 | v2 backbone | Annual order refs, order events/notes, suppliers, inventory, first `create_checkout_order` |
| 202605300002 | v2 ops | `transition_order_status`, `add_order_note` |
| 202605300003 | v2 admin products | Product management RPCs |
| 202605300004 | v2 admin ops | Pickup-window and shop-closure RPCs |
| 202605310001 | SMS/test mode | SMS log and updated `create_checkout_order` with test flag |
| 202605310002 | customer cancel | Public `cancel_order_by_ref` |
| 202605310003 | compliance inventory | Supplier certs, batch creation, waste RPC |
| 202606011430 | v3 operational system | `audit_events`, waste events, inventory adjustment, branch settings |
| 202606011900 | v4 operations intelligence | Release deployment/certification tables and RPCs |
| 202606012030 | v5 action intelligence | Action-intelligence seed/config migration |
| 202606021000 | product cost | Cost and pricing commit RPCs |
| 202606021100 | carcass intake | Carcass intake tables and confirmation RPC |
| 202606021500 | inventory integrity | Inventory batch integrity additions |
| 202606031000 | inventory reality | Actual/expected inventory weight model |
| 202606041700 | guided capture | Ops checklist and stock-count RPCs |
| 202606051200 | public order access | Access-id status, rate limits, establish/cancel, updated checkout |
| 202606051300 | seal public access | Removes legacy public reader/cancel and seals establish/cancel to service role |
| 202606051400 | audit authenticity | Removes direct audit writes and adds `emit_audit_log` |

V12.1 must be forward-only. Historical migrations must not be edited.

## RPC authority map

### Public/anonymous executable RPCs found

| RPC | Current grant evidence | Intended caller | Assessment |
|---|---|---|---|
| `create_checkout_order` | Granted to `anon, authenticated, service_role` in V2/V2e/V11.1 migrations | Server checkout service-role boundary | Launch-blocking: public mutation path exists even though app code uses server transport |
| `check_rate_limit` | Granted to `anon, authenticated, service_role` | Public rate limiter helper | Acceptable only if bounded to rate-limit table and validated; it mutates rate-limit state directly from anon |
| `get_public_order_status` | Granted to `anon, authenticated, service_role` | Public read-only order status | Acceptable public read if safe DTO invariant holds |
| `get_applied_migration_versions` | Granted to `authenticated, anon` | Release/migration health checks | Read-only metadata; low risk but should be explicitly documented |
| `get_migration_health` | Granted to `authenticated, anon` | Release/migration health checks | Read-only metadata; low risk but should be explicitly documented |

### Public grants already sealed by V11

| RPC | Evidence | Assessment |
|---|---|---|
| `get_public_order` | Initially anon; dropped in V11.1 seal | Corrected |
| `cancel_order_by_ref` | Initially anon; dropped in V11.1 seal | Corrected |
| `establish_public_order_access` | Initially anon; revoked and service-role-only in V11.1 seal | Corrected |
| `cancel_public_order(uuid,text,integer)` | Service-role-only in V11.1 seal | Corrected |

### Authenticated mutation RPCs

Authenticated staff/manager RPCs include order status, order notes, admin product
updates, schedule changes, SMS attempts, supplier/certificate changes, inventory
batch creation, waste/correction, branch settings, release certification,
pricing/cost commits, carcass intake, and ops checklist/stock-count functions.
These are intended to be reached by staff/admin server actions after
`getCurrentProfile()` or by authenticated Supabase sessions. Most are
`SECURITY DEFINER` functions with SQL-side role/branch checks; `transition_order_status`
and `add_order_note` are invoker/RLS-backed.

## Authentication/session map

Staff auth:

- `loginAction()` signs in with Supabase Auth using the anon server client.
- Staff profile validation uses the service client to check `profiles.role` and
  `profiles.is_active`.
- Middleware protects `/counter`, `/admin`, and `/compliance`.
- Middleware revalidates the Supabase user with `auth.getUser()`, checks profile
  role and active state, and refreshes `ptm_staff_last_seen`.
- Idle timeout is four hours.
- Owner-only routes are `/admin/releases` and `/admin/audit`.

Customer order-access session:

- `ptm_order_access` is signed with HMAC-SHA256 and HttpOnly.
- Cookie scope is `/order`.
- Production requires `ORDER_ACCESS_SECRET` with at least 32 bytes.
- Cancellation requires a public access id plus matching version from the signed
  session, then calls the service-role-only cancel RPC.

## Checkout execution flow map

1. Customer fills basket and checkout form in `CheckoutClient`.
2. `createOrderAction()` parses basket JSON and calls `submitCheckout()`.
3. API clients can call `POST /api/checkout`, which also calls `submitCheckout()`.
4. `submitCheckout()` validates with Zod and rejects missing service-role env.
5. `createCheckoutOrder()` calls `create_checkout_order` using the service-role
   client.
6. SQL recalculates totals from product data, enforces product/window/date/order
   constraints, inserts order and order items, and returns `{ orderRef,
   publicAccessId }`.
7. Browser checkout grants a signed order-access cookie and redirects to
   `/order/status/{publicAccessId}`.

Important finding: app code treats checkout mutation as server-authoritative, but
the database still grants `create_checkout_order` directly to `anon` and
`authenticated`.

## Audit-event production map

Historical audit paths:

- `audit_logs` existed from init with an authenticated insert policy.
- `audit_events` was added in V3 with a forgeable authenticated insert policy.
- V11.2 revoked direct audit table writes and introduced `emit_audit_log`.

Current intended paths:

- Trusted SQL business RPCs insert audit evidence internally.
- `transition_order_status` now calls `emit_audit_log`.
- `src/lib/server/audit.ts` calls `emit_audit_log` through a server-only module.
- `emit_audit_log` derives actor from `auth.uid()` for authenticated calls or
  records system emission for service-role calls with an explicit reason.

Risk:

- `emit_audit_log` remains callable by `authenticated` for generic audit events.
  V11.2 includes validation, branch checks, event allowlists, and secret-key
  metadata redaction, but V12.1 should document whether this remains an intended
  transitional path or should be narrowed further in a later phase.

## Inventory mutation map

Inventory mutations are concentrated in SQL RPCs:

- `admin_create_inventory_batch`
- `admin_record_inventory_waste`
- `admin_adjust_inventory_remaining`
- `admin_confirm_carcass_intake`
- `ops_record_stock_count_line`
- `ops_apply_stock_count_line`

Application callers:

- `src/app/actions/compliance-inventory.ts`
- `src/app/actions/carcass-intake.ts`
- `src/app/actions/ops-capture.ts`
- verification scripts exercise the same RPCs with seeded staff/manager users.

Direct inventory reads use server-side clients for admin dashboards. Direct writes
are expected to go through RPCs, with manager/owner checks and branch scope in SQL.

## Risk findings

Launch-blocking:

- `create_checkout_order` is publicly executable and creates orders. This violates
  the V12.1 invariant that anonymous users must not be able to create orders
  directly.
- Default function execute privileges are not hardened. PostgreSQL grants execute
  on new functions to `PUBLIC` by default unless revoked/default privileges are
  changed.
- `check_rate_limit` intentionally allows anon to mutate rate-limit state. The
  requirement says anonymous users must never mutate rate-limit state directly;
  V12.1 needs either a corrective seal or documented evidence that the existing
  architecture intentionally treats the RPC as the sole bounded public rate-limit
  authority. Safest V12.1 correction is to document and verify the grant while
  leaving app-compatible behavior unless the public flow is redesigned.

Material but bounded:

- `get_applied_migration_versions` and `get_migration_health` are anon-callable
  read-only release metadata RPCs.
- Authenticated generic `emit_audit_log` can produce allowed audit events, but
  cannot set another actor, write another branch, or use system reason according
  to V11.2 tests.

Operational:

- No CI workflows exist.
- Production migration parity and deployment state cannot be proven from tracked
  files alone; V11 baseline carried this as an operator action.

## Phase impact analysis

V12.0 impact:

- Remove the npm lockfile and keep `pnpm-lock.yaml`.
- Add `.nvmrc` and `engines` to make Node/pnpm expectations explicit.
- Add CI workflows using only existing package scripts and existing verification
  scripts.
- Record a V12 baseline document with the current commit, migration count,
  lockfile state, environment requirements, and deployment status.

V12.1 impact:

- Add `docs/security/rpc-authority-manifest.md`.
- Add a forward-only migration `v12_1_rpc_authority_seal.sql`.
- Revoke public/anonymous execute from `create_checkout_order` and grant it only
  to `service_role`, matching current app architecture.
- Harden default function privileges so newly created functions do not inherit
  unsafe public execute grants.
- Add catalog verification that fails the migration if forbidden grants remain.
- Preserve documented read-only public RPCs unless evidence shows they violate a
  mutation invariant.
- Preserve public status and existing public rate-limit behavior for application
  compatibility, while documenting the bounded rate-limit exception.

Out of scope:

- V12.2 and later.
- Replacing the public rate-limit architecture with a service-only edge boundary.
- Reworking authenticated generic audit emission beyond documenting and sealing
  direct table writes already handled by V11.2.

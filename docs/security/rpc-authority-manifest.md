# V12.1 RPC Authority Manifest

Date: 2026-06-06  
Source evidence: `supabase/migrations/*.sql`, `src/**/*.ts*`, `scripts/*.mjs`,
and RPC call-site search for `.rpc(`.

## Authority invariant

Anonymous users must never directly:

- create orders;
- emit audit events;
- mutate rate-limit state;
- mutate operational state.

Public callers may read catalogue/status data only through RLS-safe tables or
safe DTO RPCs. Public mutations are mediated by server-only code using
service-role transport and database functions that enforce the final invariant.

## Grant states after V12.1

| RPC | Schema/signature | Caller evidence | Grant state | Intended caller | Security assessment |
|---|---|---|---|---|---|
| `set_updated_at` | `public.set_updated_at()` | Trigger helper | No explicit client grant | Table triggers | Internal helper; default privileges sealed for future functions |
| `next_order_ref` | `public.next_order_ref(uuid,date)` | `create_checkout_order` SQL | `authenticated`, `service_role` historical | Internal SQL / staff only | Not public; sequence mutation is not anon-callable |
| `current_profile_branch_id` | `public.current_profile_branch_id()` | RLS policies | No explicit client grant | RLS helper | Security definer profile helper; no public mutation |
| `current_profile_role` | `public.current_profile_role()` | RLS policies | No explicit client grant | RLS helper | Security definer profile helper; no public mutation |
| `is_branch_staff` | `public.is_branch_staff(uuid)` | RLS and RPC checks | No explicit client grant | RLS/RPC helper | Security definer branch check; no public mutation |
| `is_branch_manager` | `public.is_branch_manager(uuid)` | RLS and RPC checks | No explicit client grant | RLS/RPC helper | Security definer branch check; no public mutation |
| `get_public_order` | `public.get_public_order(text)` | Legacy only | Dropped | None | Removed because order refs are enumerable |
| `prevent_audit_log_mutation` | `public.prevent_audit_log_mutation()` | Audit trigger | No explicit client grant | Trigger | Internal append-only enforcement |
| `prevent_audit_events_mutation` | `public.prevent_audit_events_mutation()` | Audit trigger | No explicit client grant | Trigger | Internal append-only enforcement |
| `create_checkout_order` | `public.create_checkout_order(uuid,text,text,text,date,uuid,text,text,jsonb)` | Legacy checkout | Dropped | None | Removed obsolete public order-creation overload |
| `create_checkout_order` | `public.create_checkout_order(uuid,text,text,text,date,uuid,text,text,jsonb,boolean)` | `src/lib/server/orders.ts` | `service_role` only | Server checkout boundary | V12.1 sealed; anon/auth direct order creation denied |
| `transition_order_status` | `public.transition_order_status(uuid,text,text)` | `src/app/actions/counter.ts`, verification scripts | `authenticated` | Staff/counter server action | V12.1 security definer with explicit auth/branch checks; remains staff mutation |
| `add_order_note` | `public.add_order_note(uuid,text)` | `src/app/actions/counter.ts` | `authenticated` | Staff/counter server action | RLS-backed staff note mutation; not anon-callable |
| `slugify` | `public.slugify(text)` | Product RPC helper | No explicit client grant | Internal SQL | Helper; no operational mutation |
| `admin_create_product` | `public.admin_create_product(uuid,text,text,numeric,uuid,text,text)` | `src/app/actions/admin-products.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks |
| `admin_update_product` | `public.admin_update_product(uuid,text,text,uuid,text)` | `src/app/actions/admin-products.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks |
| `admin_update_product_price` | `public.admin_update_product_price(uuid,numeric)` | `src/app/actions/admin-products.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks |
| `admin_set_product_availability` | `public.admin_set_product_availability(uuid,boolean,text)` | `src/app/actions/admin-products.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks |
| `admin_create_pickup_window` | `public.admin_create_pickup_window(uuid,text,time,time,time,int,int[],text)` | `src/app/actions/admin-schedule.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks |
| `admin_update_pickup_window` | `public.admin_update_pickup_window(uuid,text,time,time,time,int,int[],text)` | `src/app/actions/admin-schedule.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks |
| `admin_set_pickup_window_active` | `public.admin_set_pickup_window_active(uuid,boolean)` | `src/app/actions/admin-schedule.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks |
| `admin_create_shop_closure` | `public.admin_create_shop_closure(uuid,date,text)` | `src/app/actions/admin-schedule.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks |
| `admin_remove_shop_closure` | `public.admin_remove_shop_closure(uuid)` | `src/app/actions/admin-schedule.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks |
| `record_sms_attempt` | `public.record_sms_attempt(uuid,text,text,text,text,text,text,text)` | `src/app/actions/counter.ts` | `authenticated` | Staff/counter server action | SQL enforces branch staff; not anon-callable |
| `cancel_order_by_ref` | `public.cancel_order_by_ref(text,text)` | Legacy only | Dropped | None | Removed because order refs are enumerable |
| `admin_upsert_supplier_cert` | `public.admin_upsert_supplier_cert(uuid,uuid,text,text,text,date,boolean,text,boolean,text)` | `src/app/actions/compliance-inventory.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks |
| `admin_create_inventory_batch` | Multiple historical signatures; active 16-arg signature | `src/app/actions/compliance-inventory.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks and inventory invariants |
| `admin_record_inventory_waste` | `public.admin_record_inventory_waste(uuid,numeric,text)` | `src/app/actions/compliance-inventory.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks and remaining-weight invariants |
| `mirror_audit_log_to_event` | `public.mirror_audit_log_to_event()` | Audit trigger | No explicit client grant | Trigger | Internal audit projection |
| `admin_adjust_inventory_remaining` | `public.admin_adjust_inventory_remaining(uuid,numeric,text)` | `src/app/actions/compliance-inventory.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks and correction reason |
| `admin_update_branch_settings` | `public.admin_update_branch_settings(uuid,text,text,int)` | `src/app/actions/admin-settings.ts` | `authenticated` | Manager/admin server action | SQL enforces manager/branch checks |
| `prevent_release_certification_mutation` | `public.prevent_release_certification_mutation()` | Release trigger | No explicit client grant | Trigger | Internal append-only release certification guard |
| `get_applied_migration_versions` | `public.get_applied_migration_versions()` | `scripts/check-migrations.mjs` | `anon`, `authenticated` | Release/drift checks | Read-only metadata; no operational mutation |
| `get_migration_health` | `public.get_migration_health()` | `src/lib/server/releases.ts` | `anon`, `authenticated` | Release health reads | Read-only metadata; no operational mutation |
| `ensure_release_verification_items` | `public.ensure_release_verification_items(uuid)` | Release SQL helper | No explicit client grant | Internal SQL | Internal helper |
| `create_release_deployment` | `public.create_release_deployment(text,text,text,jsonb,text,text)` | No current app `.rpc` caller found | `authenticated` | Owner/release workflow | Authenticated mutation; owner-only app route should mediate use |
| `update_release_verification_item` | `public.update_release_verification_item(uuid,text,text)` | `src/app/actions/releases.ts` | `authenticated` | Owner release action | Owner-only route plus SQL checks; not anon-callable |
| `certify_release` | `public.certify_release(uuid,text,text)` | `src/app/actions/releases.ts` | `authenticated` | Owner release action | Owner-only route plus SQL checks; not anon-callable |
| `admin_set_product_cost` | `public.admin_set_product_cost(uuid,numeric)` | No current app `.rpc` caller found | `authenticated` | Manager/admin pricing | SQL enforces manager/branch checks |
| `admin_commit_product_price_cost` | `public.admin_commit_product_price_cost(uuid,numeric,numeric)` | `src/app/actions/admin-products.ts` | `authenticated` | Manager/admin pricing | SQL enforces manager/branch checks |
| `admin_confirm_carcass_intake` | `public.admin_confirm_carcass_intake(uuid,text,text,uuid,numeric,numeric,int,date,date,numeric,numeric,numeric,numeric,text,text,jsonb)` | `src/app/actions/carcass-intake.ts` | `authenticated` | Manager/admin carcass intake | SQL enforces manager/branch and idempotency checks |
| `ops_start_or_resume_session` | `public.ops_start_or_resume_session(uuid,text,date,text)` | `src/app/actions/ops-capture.ts` | `authenticated` | Manager ops checklist | SQL enforces auth/manager branch checks |
| `ops_record_step` | `public.ops_record_step(uuid,text,text,jsonb,text,text)` | `src/app/actions/ops-capture.ts` | `authenticated` | Manager ops checklist | SQL enforces auth/manager branch checks and idempotency |
| `ops_complete_session` | `public.ops_complete_session(uuid,text)` | `src/app/actions/ops-capture.ts` | `authenticated` | Manager ops checklist | SQL enforces auth/manager branch checks |
| `ops_record_stock_count_line` | `public.ops_record_stock_count_line(uuid,uuid,numeric)` | `src/app/actions/ops-capture.ts` | `authenticated` | Manager stock count | Records evidence only; does not mutate stock remaining |
| `ops_apply_stock_count_line` | `public.ops_apply_stock_count_line(uuid,uuid,text)` | `src/app/actions/ops-capture.ts` | `authenticated` | Manager stock count | Applies correction through audited inventory mutation path |
| `normalize_phone` | `public.normalize_phone(text)` | Public order SQL helper | No explicit client grant | Internal SQL | Helper only |
| `check_rate_limit` | `public.check_rate_limit(text,text,integer,integer)` | `src/lib/server/rate-limit.ts` | `service_role` only | Server rate-limit boundary | V12.1 sealed; anon cannot mutate rate-limit state directly |
| `get_public_order_status` | `public.get_public_order_status(uuid)` | `src/lib/server/public-order-access.ts` | `anon`, `authenticated`, `service_role` | Public read-only status | Safe DTO only; intentionally public and non-mutating |
| `establish_public_order_access` | `public.establish_public_order_access(text,text)` | `src/lib/server/order-access-privileged.ts` | `service_role` only | Server order-access boundary | V11/V12 sealed; no anon brute-force path |
| `cancel_public_order` | `public.cancel_public_order(uuid,text,integer)` | `src/lib/server/order-access-privileged.ts` | `service_role` only | Server order-access boundary | V11/V12 sealed; requires signed session version before server call |
| `emit_audit_log` | `public.emit_audit_log(text,text,uuid,uuid,jsonb,text)` | `src/lib/server/audit.ts`, business RPCs | `service_role` only | Server audit module and trusted SQL business RPCs | V12.1 sealed; generic authenticated user-emission removed |

## Grant evidence summary

Historical public mutation grants found and corrected:

- `create_checkout_order(..., jsonb)` and `create_checkout_order(..., jsonb,
  boolean)` were granted to `anon`.
- `check_rate_limit(text,text,integer,integer)` was granted to `anon`.
- `cancel_order_by_ref(text,text)` and `get_public_order(text)` were legacy public
  order-reference paths and are dropped.
- `establish_public_order_access(text,text)` and
  `cancel_public_order(uuid,text,integer)` are service-role-only.
- `emit_audit_log(...)` is service-role-only after V12.1.

Public read grants intentionally retained:

- `get_public_order_status(uuid)` for safe public order status DTOs.
- `get_applied_migration_versions()` and `get_migration_health()` for read-only
  migration/release metadata.

Authenticated mutation grants intentionally retained:

- Staff/counter operational RPCs.
- Manager/admin product, schedule, supplier, inventory, carcass, ops checklist,
  and release RPCs.

## Default privilege hardening

`202606061200_v12_1_rpc_authority_seal.sql` revokes default function EXECUTE from
`PUBLIC`, `anon`, and `authenticated` in schema `public`, then creates and checks a
probe function inside the migration. The migration raises an exception if a newly
created function is executable by client roles.

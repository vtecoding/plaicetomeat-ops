-- Phase 3 lock - close the remaining direct-write doors on audited tables.
--
-- Phase 0 (202606290900) locked inventory_batches / orders / order_items to their
-- SECURITY DEFINER write paths. This migration finishes the same sweep for the three
-- tables the original audit flagged in the same class but deferred:
--
--   * products             - every app write already goes through the audited DEFINER
--                            RPCs (admin_create_product, admin_update_product,
--                            admin_update_product_price -> price_changed audit,
--                            admin_set_product_availability). The leftover FOR ALL
--                            manager policy still allowed a direct PostgREST
--                            price/cost edit that bypasses the price_changed /
--                            cost_changed audit trail on legacy-provisioned
--                            databases (production predates the CLI explicit-grants
--                            default, so authenticated still HAS write grants there).
--   * inventory_waste_events - writes go through admin_record_inventory_waste
--                            (DEFINER, appends the ledger movement). The direct
--                            INSERT policy allowed fabricating a waste event with no
--                            matching inventory_movements row - evidence divergence.
--   * order_status_events  - written by transition_order_status / checkout (DEFINER)
--                            and the operator serve server action (service role).
--                            The direct INSERT policy allowed fabricating status
--                            history outside the state machine.
--
-- No app flow performs a direct client-role write to any of these (verified by
-- source scan); the app keeps working because DEFINER functions and the service
-- role are unaffected by these REVOKEs.
--
-- Also sweeps the legacy TRUNCATE / REFERENCES / TRIGGER grants that the original
-- CLI defaults handed to anon/authenticated on every table. No app role ever needs
-- them, and TRUNCATE in particular is not RLS-filtered.

-- 1. products ----------------------------------------------------------------
-- Keep "public can read active products" + "staff can read branch products".
DROP POLICY IF EXISTS "managers can manage products" ON public.products;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.products FROM authenticated, anon, PUBLIC;

-- 2. inventory_waste_events ---------------------------------------------------
-- Keep "staff can read branch waste events".
DROP POLICY IF EXISTS "managers can create branch waste events" ON public.inventory_waste_events;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.inventory_waste_events FROM authenticated, anon, PUBLIC;

-- 3. order_status_events ------------------------------------------------------
-- Keep "staff can read branch order status events".
DROP POLICY IF EXISTS "staff can create branch order status events" ON public.order_status_events;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.order_status_events FROM authenticated, anon, PUBLIC;

-- 4. Legacy dangerous-privilege sweep -----------------------------------------
-- Explicit-grant defaults never give these to app roles; legacy-provisioned
-- databases (production) still carry them from the old GRANT ALL defaults.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Phase 0 / F1 - Lock the core truth tables to controlled write paths only.
--
-- The inventory-truth and order state-machine designs route every legitimate
-- mutation through SECURITY DEFINER RPCs / privileged server actions:
--   * orders / order_items   -> checkout RPC, transition_order_status, operator
--                               serve (service-role server action), depletion
--   * inventory_batches      -> admin_adjust_inventory_remaining,
--                               admin_record_inventory_waste, intake/delivery
--                               server actions, stock-count reconciliation RPCs
--
-- But a parallel set of RLS write policies still granted app roles direct
-- INSERT/UPDATE/DELETE through PostgREST, completely outside the ledger /
-- state-machine (no inventory_movements row, no audit, no actor, no reason,
-- no valid-transition check). The audit proved this is exploitable: a manager
-- could PATCH inventory_batches.remaining_weight_kg directly, and PATCH
-- orders.status = 'collected' (skipping deplete_order_inventory).
--
-- This migration removes those direct-write doors. It mirrors what V14.1-H
-- already did for inventory_movements (append-only + revoked grants): keep
-- read access, revoke writes, let all mutations flow through the existing
-- controlled paths. No app flow depends on direct table writes - every write
-- path uses the service client or a SECURITY DEFINER RPC, both of which are
-- unaffected by these authenticated/anon REVOKEs.

-- 1. inventory_batches --------------------------------------------------------
-- Drop the FOR ALL manager write policy; keep the staff SELECT policy.
DROP POLICY IF EXISTS "managers can manage inventory batches" ON public.inventory_batches;

DROP POLICY IF EXISTS "staff can read inventory batches" ON public.inventory_batches;
CREATE POLICY "staff can read inventory batches" ON public.inventory_batches
FOR SELECT USING (public.is_branch_staff(branch_id));

REVOKE INSERT, UPDATE, DELETE ON public.inventory_batches FROM authenticated, anon, PUBLIC;

-- 2. orders -------------------------------------------------------------------
-- Drop the staff FOR UPDATE policy; keep read. A direct PATCH of orders.status
-- must be impossible - all status changes go through transition_order_status.
DROP POLICY IF EXISTS "staff can update branch orders" ON public.orders;

DROP POLICY IF EXISTS "staff can read branch orders" ON public.orders;
CREATE POLICY "staff can read branch orders" ON public.orders
FOR SELECT USING (public.is_branch_staff(branch_id));

REVOKE INSERT, UPDATE, DELETE ON public.orders FROM authenticated, anon, PUBLIC;

-- 3. order_items --------------------------------------------------------------
-- Drop the staff FOR UPDATE policy; keep read. Line quantity / unit_price /
-- line_total must not be editable off-ledger.
DROP POLICY IF EXISTS "staff can update branch order items" ON public.order_items;

DROP POLICY IF EXISTS "staff can read branch order items" ON public.order_items;
CREATE POLICY "staff can read branch order items" ON public.order_items
FOR SELECT USING (public.is_branch_staff(branch_id));

REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM authenticated, anon, PUBLIC;

-- 4. Keep the legitimate state-machine path working -------------------------
-- transition_order_status is the ONLY app write path to orders.status, and it
-- was the one function still declared SECURITY INVOKER - it depended on the
-- direct "staff can update branch orders" UPDATE policy just dropped above.
-- It already self-validates everything a SECURITY DEFINER function must:
--   * requires auth.uid() (rejects unauthenticated),
--   * checks public.is_branch_staff(branch_id) for the order's branch,
--   * enforces the valid status-transition graph (rejects illegal moves),
--   * emits an audit log and depletes inventory on 'collected',
--   * runs with a fixed search_path ('public').
-- Flipping it to SECURITY DEFINER lets it write orders.status while direct
-- table writes stay revoked. Every other order/inventory write function is
-- already SECURITY DEFINER, so no other path breaks.
ALTER FUNCTION public.transition_order_status(uuid, text, text) SECURITY DEFINER;

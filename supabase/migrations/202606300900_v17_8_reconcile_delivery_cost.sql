-- V17.8 reconciliation — clear a cost-pending operator delivery by writing the real
-- invoice cost onto its batch.
--
-- Operator Mode creates delivery batches at cost 0 (F7) and raises an
-- operator_delivery_cost_pending alert so the owner adds the real cost later. This is
-- the controlled write that closes it. Cost is batch *metadata*, not the append-only
-- quantity ledger (inventory_movements), so updating invoice_cost + cost_per_kg is safe;
-- margin/COGS are derived on read, so this single write is the recompute.
--
-- It goes through a SECURITY DEFINER RPC (not a direct write) because the phase0
-- truth-table lock revoked direct INSERT/UPDATE/DELETE on inventory_batches from app
-- roles — every batch mutation must flow through a controlled, audited function.

CREATE OR REPLACE FUNCTION public.admin_set_delivery_cost(
  p_batch_id uuid,
  p_invoice_cost numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_batch public.inventory_batches%ROWTYPE;
  v_cost_per_kg numeric;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_batch FROM public.inventory_batches WHERE id = p_batch_id;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Delivery batch not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_batch.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF p_invoice_cost IS NULL OR p_invoice_cost <= 0 THEN
    RAISE EXCEPTION 'Cost must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  IF round(p_invoice_cost, 2) <> p_invoice_cost THEN
    RAISE EXCEPTION 'Cost must have at most 2 decimal places.' USING ERRCODE = '22023';
  END IF;

  v_cost_per_kg := CASE
    WHEN coalesce(v_batch.received_weight_kg, 0) > 0 THEN round(p_invoice_cost / v_batch.received_weight_kg, 2)
    ELSE 0
  END;

  UPDATE public.inventory_batches
  SET invoice_cost = round(p_invoice_cost, 2),
      cost_per_kg = v_cost_per_kg
  WHERE id = p_batch_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'cost_changed', 'inventory_batch', p_batch_id, v_batch.branch_id, v_actor,
    jsonb_build_object(
      'from', v_batch.invoice_cost,
      'to', round(p_invoice_cost, 2),
      'cost_per_kg', v_cost_per_kg,
      'reason', 'operator_delivery_cost_reconciled'
    )
  );

  RETURN p_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_delivery_cost(uuid, numeric) TO authenticated;

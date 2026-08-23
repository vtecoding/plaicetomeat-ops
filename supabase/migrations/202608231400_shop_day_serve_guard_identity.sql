-- Preserve the Shop Day guard when an operator completes a sale before the
-- debounced resume draft has created operator_workflow_runs. The certified V18
-- writer deliberately supports that race by atomically creating the run.

CREATE OR REPLACE FUNCTION public.create_operator_serve_order_v18(
  p_run_id uuid,
  p_lines jsonb,
  p_payment_method text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_branch_id uuid;
  v_run_status text;
BEGIN
  -- A serve run may not exist yet: UI draft saving is intentionally background
  -- work, while the atomic writer is the completion authority. In that case use
  -- the authenticated active operator profile, just as the certified writer
  -- does, before enforcing the branch-local Shop Day invariant.
  SELECT branch_id INTO v_branch_id
  FROM public.profiles
  WHERE id = v_actor
    AND is_active = true
    AND role IN ('manager', 'owner');

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised to record a shop sale.' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_run_status
  FROM public.operator_workflow_runs
  WHERE id = p_run_id
    AND branch_id = v_branch_id
    AND operator_id = v_actor
    AND workflow = 'serve';

  IF v_run_status IS DISTINCT FROM 'completed' THEN
    PERFORM public.assert_shop_day_trading_v19(v_branch_id);
  END IF;

  RETURN public.create_operator_serve_order_unguarded_v18(p_run_id, p_lines, p_payment_method);
END;
$$;

REVOKE ALL ON FUNCTION public.create_operator_serve_order_v18(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_operator_serve_order_v18(uuid, jsonb, text) TO authenticated, service_role;

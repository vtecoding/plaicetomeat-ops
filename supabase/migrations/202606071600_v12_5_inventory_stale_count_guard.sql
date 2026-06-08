-- V12.5 - Inventory Concurrency Integrity.
--
-- Hard-reject stale stock-count applies. A count line is evidence taken at a
-- point in time; if the batch has changed since then, applying the old count
-- would be a lost update. The operator must re-count instead.

CREATE OR REPLACE FUNCTION public.ops_apply_stock_count_line(
  p_session_id uuid,
  p_line_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.ops_checklist_sessions%ROWTYPE;
  v_line public.stock_count_lines%ROWTYPE;
  v_batch public.inventory_batches%ROWTYPE;
  v_movement_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_line FROM public.stock_count_lines WHERE id = p_line_id FOR UPDATE;
  IF v_line.id IS NULL OR v_line.session_id <> p_session_id THEN
    RAISE EXCEPTION 'Stock count line not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_session FROM public.ops_checklist_sessions WHERE id = v_line.session_id;
  IF v_session.id IS NULL OR v_session.branch_id <> v_line.branch_id THEN
    RAISE EXCEPTION 'Stock count line not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_manager(v_session.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This stock count is already finished.' USING ERRCODE = '22023';
  END IF;

  -- Idempotent: applying again returns the line unchanged and never re-checks an
  -- old snapshot after the correction has already been recorded.
  IF v_line.applied_at IS NOT NULL THEN
    RETURN v_line.id;
  END IF;

  SELECT * INTO v_batch FROM public.inventory_batches WHERE id = v_line.batch_id FOR UPDATE;
  IF v_batch.id IS NULL OR v_batch.branch_id <> v_session.branch_id THEN
    RAISE EXCEPTION 'Stock item not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_batch.remaining_weight_kg <> v_line.system_weight_kg THEN
    RAISE EXCEPTION 'STALE_STOCK_COUNT: stock changed since this count was recorded; re-count before applying.'
      USING ERRCODE = 'P0001';
  END IF;

  v_reason := coalesce(v_reason, 'Stock count ' || to_char(v_session.business_date, 'YYYY-MM-DD'));

  IF v_line.counted_weight_kg = v_line.system_weight_kg THEN
    -- Counted matches the current locked batch value - reconcile with no correction.
    UPDATE public.stock_count_lines SET applied_at = now() WHERE id = p_line_id;
    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
    VALUES ('stock_count_line_applied', 'inventory_batch', v_line.batch_id, v_session.branch_id, v_actor,
      jsonb_build_object('system_kg', v_line.system_weight_kg, 'counted_kg', v_line.counted_weight_kg, 'difference_kg', 0));
    RETURN v_line.id;
  END IF;

  -- Differs - change stock through the established correction path
  -- (movement + reason + audit), after proving the count is still fresh.
  v_movement_id := public.admin_adjust_inventory_remaining(v_line.batch_id, v_line.counted_weight_kg, v_reason);

  UPDATE public.stock_count_lines
  SET applied_at = now(), correction_movement_id = v_movement_id
  WHERE id = p_line_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('stock_count_line_applied', 'inventory_batch', v_line.batch_id, v_session.branch_id, v_actor,
    jsonb_build_object(
      'system_kg', v_line.system_weight_kg,
      'counted_kg', v_line.counted_weight_kg,
      'difference_kg', v_line.counted_weight_kg - v_line.system_weight_kg,
      'movement_id', v_movement_id));

  RETURN v_line.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ops_apply_stock_count_line(uuid, uuid, text) TO authenticated;

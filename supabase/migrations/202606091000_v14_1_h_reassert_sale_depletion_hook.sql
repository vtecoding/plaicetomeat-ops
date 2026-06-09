-- V14.1-H follow-up: reassert the sale-depletion hook on order collection.
--
-- Some local databases may have applied older authority migrations after V14.1
-- during drift repair. Those historical migrations redefine transition_order_status
-- without the V14 SALE_COLLECT call. This forward migration restores the hook
-- without resetting or rewriting any historical data.

CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id uuid,
  p_next_status text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event_id uuid;
  v_actor uuid := auth.uid();
  v_allowed boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF p_next_status NOT IN ('incoming', 'prepping', 'ready', 'collected', 'cancelled') THEN
    RAISE EXCEPTION 'Unknown order status: %', p_next_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  v_allowed := CASE
    WHEN v_order.status = 'incoming' AND p_next_status IN ('prepping', 'cancelled') THEN true
    WHEN v_order.status = 'prepping' AND p_next_status IN ('ready', 'cancelled') THEN true
    WHEN v_order.status = 'ready' AND p_next_status IN ('collected', 'cancelled') THEN true
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid transition from % to %.', v_order.status, p_next_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
  SET
    status = p_next_status,
    cancelled_by = CASE WHEN p_next_status = 'cancelled' THEN 'staff' ELSE cancelled_by END,
    cancellation_reason = CASE
      WHEN p_next_status = 'cancelled' THEN nullif(btrim(coalesce(p_note, '')), '')
      ELSE cancellation_reason
    END
  WHERE id = p_order_id;

  INSERT INTO public.order_status_events (branch_id, order_id, status, actor_id, note)
  VALUES (v_order.branch_id, p_order_id, p_next_status, v_actor, nullif(btrim(coalesce(p_note, '')), ''))
  RETURNING id INTO v_event_id;

  PERFORM public.emit_audit_log(
    'order_status_changed',
    'order',
    p_order_id,
    v_order.branch_id,
    jsonb_build_object('from', v_order.status, 'to', p_next_status, 'order_ref', v_order.order_ref)
  );

  IF p_next_status = 'collected' THEN
    PERFORM public.deplete_order_inventory(p_order_id);
  END IF;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_order_status(uuid, text, text) TO authenticated, service_role;

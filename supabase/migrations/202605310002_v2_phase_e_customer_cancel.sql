-- V2 Phase E (cont.): real customer self-service cancellation.
-- Anon-callable by order ref, but only cancels an 'incoming' order inside the
-- branch cancellation window. Mirrors the rules in canCustomerCancelOrder().
CREATE OR REPLACE FUNCTION public.cancel_order_by_ref(
  p_order_ref text,
  p_reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_window_minutes int;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_ref = p_order_ref;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.status <> 'incoming' THEN
    RAISE EXCEPTION 'This order can no longer be cancelled online.' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(cancellation_window_minutes, 60) INTO v_window_minutes
  FROM public.branch_settings WHERE branch_id = v_order.branch_id;
  v_window_minutes := coalesce(v_window_minutes, 60);

  IF now() > v_order.created_at + make_interval(mins => v_window_minutes) THEN
    RAISE EXCEPTION 'The online cancellation window has expired.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
  SET status = 'cancelled',
      cancelled_by = 'customer',
      cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
  WHERE id = v_order.id;

  INSERT INTO public.order_status_events (branch_id, order_id, status, note)
  VALUES (v_order.branch_id, v_order.id, 'cancelled', 'Cancelled by customer online.');

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, metadata)
  VALUES (
    'order_status_changed', 'order', v_order.id, v_order.branch_id,
    jsonb_build_object('from', v_order.status, 'to', 'cancelled', 'by', 'customer', 'order_ref', v_order.order_ref)
  );

  RETURN v_order.order_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_order_by_ref(text, text) TO anon, authenticated;

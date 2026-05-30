-- V2 Phase B: canonical order status transitions, staff notes, and realtime.
-- These functions run as SECURITY INVOKER so all access is enforced by RLS and
-- the is_branch_staff() helper. No privilege escalation is introduced.

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

  -- RLS on orders restricts this SELECT to the caller's branch, so an order in
  -- another branch simply appears as "not found" -> no cross-branch mutation.
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

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'order_status_changed',
    'order',
    p_order_id,
    v_order.branch_id,
    v_actor,
    jsonb_build_object('from', v_order.status, 'to', p_next_status, 'order_ref', v_order.order_ref)
  );

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_order_status(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_order_note(
  p_order_id uuid,
  p_note text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_note text := btrim(coalesce(p_note, ''));
  v_actor uuid := auth.uid();
  v_note_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF length(v_note) = 0 THEN
    RAISE EXCEPTION 'Note cannot be empty.' USING ERRCODE = '22023';
  END IF;

  IF length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Note is too long (max 1000 characters).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.order_notes (branch_id, order_id, note, created_by)
  VALUES (v_order.branch_id, p_order_id, v_note, v_actor)
  RETURNING id INTO v_note_id;

  RETURN v_note_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_order_note(uuid, text) TO authenticated;

-- Full row images so realtime branch_id filters apply to every event type.
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_status_events REPLICA IDENTITY FULL;
ALTER TABLE public.order_notes REPLICA IDENTITY FULL;

-- Add the operational tables to the realtime publication (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_status_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_status_events;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_notes;
  END IF;
END $$;

-- V2 Phase E: safe test orders + truthful SMS state machine.
--
-- Adds an is_test flag and an explicit, honest SMS status to orders, plus a
-- full sms_log audit trail. SMS sending itself is orchestrated and env-gated in
-- the application layer; this RPC only records the truthful outcome and never
-- claims success unless the caller reports it.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_status text
    CHECK (sms_status IN ('disabled', 'not_required', 'queued', 'dry_run', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS sms_failure_reason text;

CREATE INDEX IF NOT EXISTS idx_orders_branch_is_test ON public.orders(branch_id, is_test);

CREATE TABLE IF NOT EXISTS public.sms_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('disabled', 'not_required', 'queued', 'dry_run', 'sent', 'failed')),
  template_key text,
  recipient_redacted text,
  message_preview text,
  provider_response text,
  failure_reason text,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_log_branch_created ON public.sms_log(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_log_order ON public.sms_log(order_id);
CREATE INDEX IF NOT EXISTS idx_sms_log_branch_status_created ON public.sms_log(branch_id, status, created_at DESC);

ALTER TABLE public.sms_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff can read branch sms log" ON public.sms_log;
CREATE POLICY "staff can read branch sms log" ON public.sms_log
FOR SELECT USING (public.is_branch_staff(branch_id));

-- Record a truthful SMS attempt outcome and reflect it on the order.
-- SECURITY DEFINER + is_branch_staff() check: only branch staff can record, and
-- only for orders in their branch. Never sets 'sent' unless the caller passes it.
CREATE OR REPLACE FUNCTION public.record_sms_attempt(
  p_order_id uuid,
  p_event_type text,
  p_status text,
  p_template_key text DEFAULT NULL,
  p_recipient_redacted text DEFAULT NULL,
  p_message_preview text DEFAULT NULL,
  p_provider_response text DEFAULT NULL,
  p_failure_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_log_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF p_status NOT IN ('disabled', 'not_required', 'queued', 'dry_run', 'sent', 'failed') THEN
    RAISE EXCEPTION 'Unknown SMS status: %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.sms_log (
    branch_id, order_id, event_type, status, template_key, recipient_redacted,
    message_preview, provider_response, failure_reason, actor_id, is_test
  )
  VALUES (
    v_order.branch_id, p_order_id, p_event_type, p_status, p_template_key, p_recipient_redacted,
    p_message_preview, p_provider_response, p_failure_reason, v_actor, v_order.is_test
  )
  RETURNING id INTO v_log_id;

  UPDATE public.orders
  SET
    sms_status = p_status,
    sms_failure_reason = CASE WHEN p_status = 'failed' THEN p_failure_reason ELSE NULL END,
    ready_sms_sent_at = CASE
      WHEN p_status = 'sent' AND p_event_type = 'ready' THEN now()
      ELSE ready_sms_sent_at
    END
  WHERE id = p_order_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'sms_attempt', 'order', p_order_id, v_order.branch_id, v_actor,
    jsonb_build_object('sms_status', p_status, 'sms_event', p_event_type, 'is_test', v_order.is_test)
  );

  RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_sms_attempt(uuid, text, text, text, text, text, text, text) TO authenticated;

-- Drop the previous 9-arg overload so PostgREST resolves the new signature
-- unambiguously (the new one adds a trailing p_is_test argument).
DROP FUNCTION IF EXISTS public.create_checkout_order(
  uuid, text, text, text, date, uuid, text, text, jsonb
);

-- Recreate create_checkout_order with an explicit p_is_test flag (defaults false).
-- Marked test orders are written exactly like real ones but flagged is_test=true
-- so they can be filtered out of owner metrics and never trigger real SMS.
CREATE OR REPLACE FUNCTION public.create_checkout_order(
  p_branch_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_pickup_date date,
  p_pickup_window_id uuid,
  p_notes text,
  p_idempotency_key text,
  p_items jsonb,
  p_is_test boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_ref text;
  v_order_id uuid;
  v_order_ref text;
  v_subtotal numeric(10,2);
  v_min_order_value numeric(10,2);
  v_same_day_cutoff time;
  v_window public.pickup_windows%ROWTYPE;
  v_branch_timezone text;
  v_now_local timestamp;
  v_today_local date;
  v_order_count int;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Basket cannot be empty.';
  END IF;

  SELECT order_ref INTO v_existing_ref
  FROM public.orders
  WHERE idempotency_key = p_idempotency_key;

  IF v_existing_ref IS NOT NULL THEN
    RETURN v_existing_ref;
  END IF;

  SELECT timezone INTO v_branch_timezone
  FROM public.branches
  WHERE id = p_branch_id AND is_active = true;

  IF v_branch_timezone IS NULL THEN
    RAISE EXCEPTION 'Branch is not available.';
  END IF;

  SELECT * INTO v_window
  FROM public.pickup_windows
  WHERE id = p_pickup_window_id
    AND branch_id = p_branch_id
    AND is_active = true;

  IF v_window.id IS NULL THEN
    RAISE EXCEPTION 'Pickup window is not available.';
  END IF;

  SELECT
    coalesce(min_order_value, 0),
    coalesce(same_day_cutoff_time, '16:00'::time)
  INTO v_min_order_value, v_same_day_cutoff
  FROM public.branch_settings
  WHERE branch_id = p_branch_id;

  v_min_order_value := coalesce(v_min_order_value, 0);
  v_same_day_cutoff := coalesce(v_same_day_cutoff, '16:00'::time);
  v_now_local := now() AT TIME ZONE v_branch_timezone;
  v_today_local := v_now_local::date;

  IF p_pickup_date < v_today_local THEN
    RAISE EXCEPTION 'Pickup date cannot be in the past.';
  END IF;

  IF p_pickup_date = v_today_local AND v_now_local::time >= v_same_day_cutoff THEN
    RAISE EXCEPTION 'Same-day orders close at 4pm.';
  END IF;

  IF NOT (extract(isodow from p_pickup_date)::int = ANY(v_window.days_of_week)) THEN
    RAISE EXCEPTION 'Pickup window is not available on this date.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shop_closures
    WHERE branch_id = p_branch_id AND close_date = p_pickup_date
  ) THEN
    RAISE EXCEPTION 'The shop is closed on this pickup date.';
  END IF;

  IF v_window.max_orders IS NOT NULL THEN
    SELECT count(*) INTO v_order_count
    FROM public.orders
    WHERE branch_id = p_branch_id
      AND pickup_date = p_pickup_date
      AND pickup_window_id = p_pickup_window_id
      AND status <> 'cancelled';

    IF v_order_count >= v_window.max_orders THEN
      RAISE EXCEPTION 'This pickup window is full.';
    END IF;
  END IF;

  WITH requested AS (
    SELECT
      (item->>'productId')::uuid AS product_id,
      (item->>'quantity')::numeric AS quantity
    FROM jsonb_array_elements(p_items) AS item
  )
  SELECT sum(round(requested.quantity * products.price_per_unit, 2))::numeric(10,2)
  INTO v_subtotal
  FROM requested
  JOIN public.products products
    ON products.id = requested.product_id
   AND products.branch_id = p_branch_id
  WHERE products.is_available = true
    AND products.stock_status <> 'out_of_stock'
    AND requested.quantity >= products.min_order_quantity
    AND requested.quantity <= coalesce(products.max_order_quantity, 20);

  IF v_subtotal IS NULL THEN
    RAISE EXCEPTION 'One or more basket items are no longer available.';
  END IF;

  IF EXISTS (
    WITH requested AS (
      SELECT
        (item->>'productId')::uuid AS product_id,
        (item->>'quantity')::numeric AS quantity
      FROM jsonb_array_elements(p_items) AS item
    )
    SELECT 1
    FROM requested
    LEFT JOIN public.products products
      ON products.id = requested.product_id
     AND products.branch_id = p_branch_id
    WHERE products.id IS NULL
       OR products.is_available = false
       OR products.stock_status = 'out_of_stock'
       OR requested.quantity < products.min_order_quantity
       OR requested.quantity > coalesce(products.max_order_quantity, 20)
  ) THEN
    RAISE EXCEPTION 'One or more basket items are no longer available.';
  END IF;

  IF v_subtotal < v_min_order_value THEN
    RAISE EXCEPTION 'Minimum order is GBP %.', v_min_order_value;
  END IF;

  v_order_ref := public.next_order_ref(p_branch_id, p_pickup_date);

  INSERT INTO public.orders (
    branch_id,
    order_ref,
    customer_name,
    customer_phone,
    customer_email,
    pickup_window_id,
    pickup_date,
    subtotal,
    notes,
    idempotency_key,
    is_test
  )
  VALUES (
    p_branch_id,
    v_order_ref,
    btrim(p_customer_name),
    p_customer_phone,
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    p_pickup_window_id,
    p_pickup_date,
    v_subtotal,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_idempotency_key,
    coalesce(p_is_test, false)
  )
  RETURNING id INTO v_order_id;

  WITH requested AS (
    SELECT
      (item->>'productId')::uuid AS product_id,
      (item->>'quantity')::numeric AS quantity
    FROM jsonb_array_elements(p_items) AS item
  )
  INSERT INTO public.order_items (
    branch_id,
    order_id,
    product_id,
    product_name_snapshot,
    quantity,
    unit_type,
    unit_price_snapshot,
    line_total
  )
  SELECT
    p_branch_id,
    v_order_id,
    products.id,
    products.name,
    requested.quantity,
    products.unit_type,
    products.price_per_unit,
    round(requested.quantity * products.price_per_unit, 2)
  FROM requested
  JOIN public.products products
    ON products.id = requested.product_id
   AND products.branch_id = p_branch_id;

  INSERT INTO public.order_status_events(branch_id, order_id, status, note)
  VALUES (p_branch_id, v_order_id, 'incoming', 'Order received from checkout.');

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, metadata)
  VALUES (
    'order_created',
    'order',
    v_order_id,
    p_branch_id,
    jsonb_build_object('order_ref', v_order_ref, 'subtotal', v_subtotal, 'is_test', coalesce(p_is_test, false))
  );

  RETURN v_order_ref;
EXCEPTION
  WHEN unique_violation THEN
    SELECT order_ref INTO v_existing_ref
    FROM public.orders
    WHERE idempotency_key = p_idempotency_key;

    IF v_existing_ref IS NOT NULL THEN
      RETURN v_existing_ref;
    END IF;

    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_checkout_order(
  uuid, text, text, text, date, uuid, text, text, jsonb, boolean
) TO anon, authenticated, service_role;

-- Add sms_log to realtime so the counter SMS badge updates live.
ALTER TABLE public.sms_log REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sms_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_log;
  END IF;
END $$;

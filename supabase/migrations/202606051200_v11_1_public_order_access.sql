-- V11.1 — Emergency Public Security Boundary
--
-- Replaces the reference-only public order flow (data disclosure + unauthorised
-- cancellation via enumerable PTM-YYYY-NNNNN references) with:
--   * a random, unguessable public_access_id handle on each order;
--   * safe-DTO status reads keyed by that handle (never the reference);
--   * identity-checked access establishment (order_ref + phone);
--   * a row-locked, race-safe cancellation transaction;
--   * bounded rate limiting for public endpoints.
--
-- Invariants (spec §6.1): a sequential reference must never authorise access or
-- cancellation; public responses expose only the documented safe DTO;
-- cancellation locks the row and re-checks status in one transaction.
--
-- Rollback/forward-fix: this migration is additive (new columns default-filled,
-- new functions, one function dropped). To roll back, restore cancel_order_by_ref
-- from 202605310002 and re-grant; the new columns can remain (harmless).

-- 1. Random public access handle ------------------------------------------------
-- gen_random_uuid() is volatile, so the ADD COLUMN backfills every existing row
-- with a distinct value; NOT NULL is therefore satisfiable immediately.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS public_access_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS public_access_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS public_access_version integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_access_id
  ON public.orders(public_access_id);

-- 2. Phone normalisation (single SQL authority for matching) ---------------------
-- Returns the UK "national significant number": digits only, with a leading
-- country code (44) or trunk 0 stripped. Mirrored in TS for tests only.
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
BEGIN
  IF p_phone IS NULL THEN
    RETURN NULL;
  END IF;
  d := regexp_replace(p_phone, '[^0-9]', '', 'g');
  IF left(d, 2) = '44' THEN
    d := substr(d, 3);
  ELSIF left(d, 1) = '0' THEN
    d := substr(d, 2);
  END IF;
  RETURN d;
END;
$$;

-- 3. Bounded rate limiting ------------------------------------------------------
-- Fixed-window counters. `identity` is an opaque hash supplied by the caller
-- (never plaintext phone). PK gives atomic upsert; old windows are pruned cheaply.
CREATE TABLE IF NOT EXISTS public.public_rate_limits (
  bucket text NOT NULL,
  identity text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, identity, window_start)
);

CREATE INDEX IF NOT EXISTS idx_public_rate_limits_window
  ON public.public_rate_limits(window_start);

ALTER TABLE public.public_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: only the SECURITY DEFINER function below may touch it.

-- Returns TRUE when the request is allowed (count within p_max for the window),
-- FALSE when the limit is exceeded. Atomic increment via ON CONFLICT.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket text,
  p_identity text,
  p_max integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_count integer;
BEGIN
  IF p_identity IS NULL OR p_bucket IS NULL OR p_max < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate-limit parameters.' USING ERRCODE = '22023';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  -- Opportunistic prune of windows older than one day (bounded retention).
  DELETE FROM public.public_rate_limits
  WHERE window_start < now() - interval '1 day';

  INSERT INTO public.public_rate_limits(bucket, identity, window_start, count)
  VALUES (p_bucket, p_identity, v_window_start, 1)
  ON CONFLICT (bucket, identity, window_start)
  DO UPDATE SET count = public.public_rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= p_max;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer)
  TO anon, authenticated, service_role;

-- 4. Safe public status read ----------------------------------------------------
-- Keyed by the unguessable handle. Returns ONLY the documented safe DTO, or NULL
-- if the handle is unknown or access was revoked. Never returns phone, email,
-- raw id, notes, staff notes, SMS diagnostics or branch internals.
CREATE OR REPLACE FUNCTION public.get_public_order_status(p_public_access_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_window_minutes int;
  v_deadline timestamptz;
  v_can_cancel boolean;
  v_window_label text;
  v_items jsonb;
BEGIN
  IF p_public_access_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE public_access_id = p_public_access_id
    AND public_access_revoked_at IS NULL;

  IF v_order.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(cancellation_window_minutes, 60) INTO v_window_minutes
  FROM public.branch_settings WHERE branch_id = v_order.branch_id;
  v_window_minutes := coalesce(v_window_minutes, 60);
  v_deadline := v_order.created_at + make_interval(mins => v_window_minutes);
  v_can_cancel := (v_order.status = 'incoming' AND now() <= v_deadline);

  SELECT label INTO v_window_label
  FROM public.pickup_windows WHERE id = v_order.pickup_window_id;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', oi.product_name_snapshot,
        'quantity', oi.quantity,
        'unitType', oi.unit_type,
        'lineTotal', oi.line_total
      ) ORDER BY oi.created_at
    ),
    '[]'::jsonb
  ) INTO v_items
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id;

  RETURN jsonb_build_object(
    'orderRef', v_order.order_ref,
    'customerDisplayName', split_part(btrim(v_order.customer_name), ' ', 1),
    'status', v_order.status,
    'pickupDate', v_order.pickup_date,
    'pickupWindowLabel', coalesce(v_window_label, 'Selected window'),
    'items', v_items,
    'subtotal', v_order.subtotal,
    'canCancel', v_can_cancel,
    'cancellationDeadline',
      CASE WHEN v_order.status = 'incoming'
        THEN to_char(v_deadline AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_order_status(uuid) TO anon, authenticated, service_role;

-- 5. Identity-checked access establishment --------------------------------------
-- Returns the public_access_id ONLY when order_ref + normalized phone match an
-- order whose access is not revoked. Returns NULL otherwise (indistinguishable
-- to the caller whether the ref or the phone was wrong). Rate-limited by caller.
CREATE OR REPLACE FUNCTION public.establish_public_order_access(
  p_order_ref text,
  p_phone text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_access_id uuid;
BEGIN
  IF p_order_ref IS NULL OR p_phone IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT public_access_id INTO v_access_id
  FROM public.orders
  WHERE order_ref = p_order_ref
    AND public_access_revoked_at IS NULL
    AND public.normalize_phone(customer_phone) = public.normalize_phone(p_phone)
    AND public.normalize_phone(p_phone) <> '';

  RETURN v_access_id; -- NULL when no match
END;
$$;

GRANT EXECUTE ON FUNCTION public.establish_public_order_access(text, text) TO anon, authenticated, service_role;

-- 6. Race-safe public cancellation ---------------------------------------------
-- Keyed by the unguessable handle (never the reference). Locks the row, re-checks
-- status and deadline inside the transaction, performs a conditional transition,
-- and records status + audit evidence. A concurrent staff transition makes the
-- conditional UPDATE affect zero rows -> we report "no longer cancellable".
CREATE OR REPLACE FUNCTION public.cancel_public_order(
  p_public_access_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_order public.orders%ROWTYPE;
  v_window_minutes int;
  v_deadline timestamptz;
  v_updated int;
BEGIN
  IF p_public_access_id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_id
  FROM public.orders
  WHERE public_access_id = p_public_access_id
    AND public_access_revoked_at IS NULL;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Lock the target row; any concurrent staff transition serialises here.
  SELECT * INTO v_order FROM public.orders WHERE id = v_id FOR UPDATE;

  IF v_order.status <> 'incoming' THEN
    RAISE EXCEPTION 'This order can no longer be cancelled online.' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(cancellation_window_minutes, 60) INTO v_window_minutes
  FROM public.branch_settings WHERE branch_id = v_order.branch_id;
  v_window_minutes := coalesce(v_window_minutes, 60);
  v_deadline := v_order.created_at + make_interval(mins => v_window_minutes);

  IF now() > v_deadline THEN
    RAISE EXCEPTION 'The online cancellation window has expired.' USING ERRCODE = '22023';
  END IF;

  -- Conditional transition: only succeeds if still 'incoming' under the lock.
  UPDATE public.orders
  SET status = 'cancelled',
      cancelled_by = 'customer',
      cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
  WHERE id = v_id AND status = 'incoming';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'This order can no longer be cancelled online.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.order_status_events (branch_id, order_id, status, note)
  VALUES (v_order.branch_id, v_id, 'cancelled', 'Cancelled by customer online.');

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, metadata)
  VALUES (
    'order_status_changed', 'order', v_id, v_order.branch_id,
    jsonb_build_object('from', 'incoming', 'to', 'cancelled', 'by', 'customer', 'order_ref', v_order.order_ref)
  );

  RETURN jsonb_build_object('ok', true, 'orderRef', v_order.order_ref);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_public_order(uuid, text) TO anon, authenticated, service_role;

-- 7. Retire the reference-only cancellation ------------------------------------
-- Remove the enumerable, lock-free cancellation path entirely.
REVOKE EXECUTE ON FUNCTION public.cancel_order_by_ref(text, text) FROM anon, authenticated;
DROP FUNCTION IF EXISTS public.cancel_order_by_ref(text, text);

-- 8. create_checkout_order now returns { orderRef, publicAccessId } -------------
-- Drop the text-returning 10-arg overload and recreate it returning jsonb so the
-- trusted checkout path can establish the access session WITHOUT any
-- reference->data read. Body is otherwise unchanged from 202605310001.
DROP FUNCTION IF EXISTS public.create_checkout_order(
  uuid, text, text, text, date, uuid, text, text, jsonb, boolean
);

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
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_ref text;
  v_existing_access uuid;
  v_order_id uuid;
  v_order_ref text;
  v_public_access_id uuid;
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

  SELECT order_ref, public_access_id INTO v_existing_ref, v_existing_access
  FROM public.orders
  WHERE idempotency_key = p_idempotency_key;

  IF v_existing_ref IS NOT NULL THEN
    RETURN jsonb_build_object('orderRef', v_existing_ref, 'publicAccessId', v_existing_access);
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
  RETURNING id, public_access_id INTO v_order_id, v_public_access_id;

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

  RETURN jsonb_build_object('orderRef', v_order_ref, 'publicAccessId', v_public_access_id);
EXCEPTION
  WHEN unique_violation THEN
    SELECT order_ref, public_access_id INTO v_existing_ref, v_existing_access
    FROM public.orders
    WHERE idempotency_key = p_idempotency_key;

    IF v_existing_ref IS NOT NULL THEN
      RETURN jsonb_build_object('orderRef', v_existing_ref, 'publicAccessId', v_existing_access);
    END IF;

    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_checkout_order(
  uuid, text, text, text, date, uuid, text, text, jsonb, boolean
) TO anon, authenticated, service_role;

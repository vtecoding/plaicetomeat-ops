-- V12.3 — Checkout Integrity (forward-only).
--
-- Hardens public.create_checkout_order without changing its signature (so the
-- V12.1 authority seal — service_role only — is preserved). Changes:
--   1. Add orders.idempotency_fingerprint to detect "same key, different payload".
--   2. Merge duplicate SKUs (sum quantity) BEFORE pricing/validation/insert, so a
--      duplicate-line payload can no longer bypass per-product max quantity.
--   3. Cap distinct SKUs per order (30).
--   4. Recheck pickup-window capacity UNDER a row lock (FOR UPDATE on the window),
--      the same deterministic-lock pattern transition_order_status already uses, so
--      concurrent checkouts can never overbook a capacity-limited window.
--   5. Idempotency: same key + identical payload returns the existing order;
--      same key + different payload is rejected (legacy NULL fingerprints tolerated).
--
-- Server price authority is unchanged: only {product_id, quantity} drive the RPC;
-- every price/line total is recomputed from products.price_per_unit.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint text;

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
  v_existing_fp text;
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
  v_items jsonb;
  v_fingerprint text;
  c_max_distinct_skus constant int := 30;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Basket cannot be empty.';
  END IF;

  -- Merge duplicate SKUs (sum quantity); deterministic order for fingerprinting.
  SELECT jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity) ORDER BY product_id)
  INTO v_items
  FROM (
    SELECT (item->>'productId')::uuid AS product_id,
           sum((item->>'quantity')::numeric) AS quantity
    FROM jsonb_array_elements(p_items) AS item
    GROUP BY (item->>'productId')::uuid
  ) merged;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Basket cannot be empty.';
  END IF;

  IF jsonb_array_length(v_items) > c_max_distinct_skus THEN
    RAISE EXCEPTION 'Too many different items in one order.';
  END IF;

  -- Canonical fingerprint over the merged, normalised payload.
  v_fingerprint := md5(
    coalesce(p_branch_id::text, '') || '|' ||
    btrim(coalesce(p_customer_name, '')) || '|' ||
    coalesce(p_customer_phone, '') || '|' ||
    lower(btrim(coalesce(p_customer_email, ''))) || '|' ||
    coalesce(p_pickup_date::text, '') || '|' ||
    coalesce(p_pickup_window_id::text, '') || '|' ||
    btrim(coalesce(p_notes, '')) || '|' ||
    coalesce(p_is_test::text, 'false') || '|' ||
    v_items::text
  );

  SELECT order_ref, public_access_id, idempotency_fingerprint
  INTO v_existing_ref, v_existing_access, v_existing_fp
  FROM public.orders
  WHERE idempotency_key = p_idempotency_key;

  IF v_existing_ref IS NOT NULL THEN
    IF v_existing_fp IS NOT NULL AND v_existing_fp IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This order was already placed with different details.';
    END IF;
    RETURN jsonb_build_object('orderRef', v_existing_ref, 'publicAccessId', v_existing_access);
  END IF;

  SELECT timezone INTO v_branch_timezone
  FROM public.branches
  WHERE id = p_branch_id AND is_active = true;

  IF v_branch_timezone IS NULL THEN
    RAISE EXCEPTION 'Branch is not available.';
  END IF;

  -- Serialize checkouts into this window for the txn: capacity check-then-insert
  -- becomes atomic, so concurrent orders cannot overbook (no TOCTOU race).
  SELECT * INTO v_window
  FROM public.pickup_windows
  WHERE id = p_pickup_window_id
    AND branch_id = p_branch_id
    AND is_active = true
  FOR UPDATE;

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

  -- Capacity is rechecked while holding the window lock above.
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

  -- Subtotal from merged items, recomputed server-side from product prices.
  SELECT sum(round(r.quantity * pr.price_per_unit, 2))::numeric(10,2)
  INTO v_subtotal
  FROM jsonb_to_recordset(v_items) AS r(product_id uuid, quantity numeric)
  JOIN public.products pr
    ON pr.id = r.product_id
   AND pr.branch_id = p_branch_id
  WHERE pr.is_available = true
    AND pr.stock_status <> 'out_of_stock'
    AND r.quantity >= pr.min_order_quantity
    AND r.quantity <= coalesce(pr.max_order_quantity, 20);

  IF v_subtotal IS NULL THEN
    RAISE EXCEPTION 'One or more basket items are no longer available.';
  END IF;

  -- Aggregate quantity (post-merge) is validated against per-product limits here,
  -- so duplicate-line payloads cannot exceed max_order_quantity.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_items) AS r(product_id uuid, quantity numeric)
    LEFT JOIN public.products pr
      ON pr.id = r.product_id
     AND pr.branch_id = p_branch_id
    WHERE pr.id IS NULL
       OR pr.is_available = false
       OR pr.stock_status = 'out_of_stock'
       OR r.quantity < pr.min_order_quantity
       OR r.quantity > coalesce(pr.max_order_quantity, 20)
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
    idempotency_fingerprint,
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
    v_fingerprint,
    coalesce(p_is_test, false)
  )
  RETURNING id, public_access_id INTO v_order_id, v_public_access_id;

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
    pr.id,
    pr.name,
    r.quantity,
    pr.unit_type,
    pr.price_per_unit,
    round(r.quantity * pr.price_per_unit, 2)
  FROM jsonb_to_recordset(v_items) AS r(product_id uuid, quantity numeric)
  JOIN public.products pr
    ON pr.id = r.product_id
   AND pr.branch_id = p_branch_id;

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
    SELECT order_ref, public_access_id, idempotency_fingerprint
    INTO v_existing_ref, v_existing_access, v_existing_fp
    FROM public.orders
    WHERE idempotency_key = p_idempotency_key;

    IF v_existing_ref IS NOT NULL THEN
      IF v_existing_fp IS NOT NULL AND v_existing_fp IS DISTINCT FROM v_fingerprint THEN
        RAISE EXCEPTION 'This order was already placed with different details.';
      END IF;
      RETURN jsonb_build_object('orderRef', v_existing_ref, 'publicAccessId', v_existing_access);
    END IF;

    RAISE;
END;
$$;

-- Preserve the V12.1 authority seal (CREATE OR REPLACE keeps grants, but we
-- re-assert idempotently so this migration carries the full contract).
REVOKE ALL ON FUNCTION public.create_checkout_order(
  uuid, text, text, text, date, uuid, text, text, jsonb, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(
  uuid, text, text, text, date, uuid, text, text, jsonb, boolean
) TO service_role;

-- Self-verify: column present, and the seal holds (no anon/authenticated execute).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'idempotency_fingerprint'
  ) THEN
    RAISE EXCEPTION 'V12.3 self-check failed: orders.idempotency_fingerprint missing';
  END IF;

  IF has_function_privilege('anon',
       'public.create_checkout_order(uuid,text,text,text,date,uuid,text,text,jsonb,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V12.3 self-check failed: anon can execute create_checkout_order';
  END IF;

  IF has_function_privilege('authenticated',
       'public.create_checkout_order(uuid,text,text,text,date,uuid,text,text,jsonb,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V12.3 self-check failed: authenticated can execute create_checkout_order';
  END IF;
END $$;

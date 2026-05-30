-- V2 Phase D: admin pickup windows + shop closures.
-- SECURITY DEFINER RPCs enforcing manager/owner role + branch scope, validation,
-- canonical write, and audit logging. Staff are rejected. Checkout enforcement of
-- active windows / closures / cutoff already lives in create_checkout_order.

-- Create a pickup window (manager/owner only).
CREATE OR REPLACE FUNCTION public.admin_create_pickup_window(
  p_branch_id uuid,
  p_label text,
  p_start_time time,
  p_end_time time,
  p_cutoff_time time DEFAULT NULL,
  p_max_orders int DEFAULT NULL,
  p_days_of_week int[] DEFAULT '{1,2,3,4,5}',
  p_window_type text DEFAULT 'standard'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_label text := btrim(coalesce(p_label, ''));
  v_days int[] := coalesce(p_days_of_week, '{1,2,3,4,5}');
  v_id uuid;
  v_day int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF length(v_label) = 0 THEN
    RAISE EXCEPTION 'Window label is required.' USING ERRCODE = '22023';
  END IF;

  IF p_start_time IS NULL OR p_end_time IS NULL OR p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Start time must be before end time.' USING ERRCODE = '22023';
  END IF;

  IF p_max_orders IS NOT NULL AND p_max_orders < 0 THEN
    RAISE EXCEPTION 'Capacity must be zero or greater.' USING ERRCODE = '22023';
  END IF;

  IF array_length(v_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one day of the week.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_day IN ARRAY v_days LOOP
    IF v_day < 1 OR v_day > 7 THEN
      RAISE EXCEPTION 'Days of week must be between 1 and 7.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_window_type NOT IN ('standard', 'commuter', 'weekend') THEN
    RAISE EXCEPTION 'Window type is invalid.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.pickup_windows (
    branch_id, label, start_time, end_time, cutoff_time, max_orders, days_of_week, window_type, is_active
  )
  VALUES (
    p_branch_id, v_label, p_start_time, p_end_time, p_cutoff_time, p_max_orders, v_days, p_window_type, true
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'pickup_window_created', 'pickup_window', v_id, p_branch_id, v_actor,
    jsonb_build_object('label', v_label, 'start', p_start_time::text, 'end', p_end_time::text)
  );

  RETURN v_id;
END;
$$;

-- Update a pickup window (manager/owner only).
CREATE OR REPLACE FUNCTION public.admin_update_pickup_window(
  p_window_id uuid,
  p_label text,
  p_start_time time,
  p_end_time time,
  p_cutoff_time time DEFAULT NULL,
  p_max_orders int DEFAULT NULL,
  p_days_of_week int[] DEFAULT NULL,
  p_window_type text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_window public.pickup_windows%ROWTYPE;
  v_label text := btrim(coalesce(p_label, ''));
  v_days int[];
  v_type text;
  v_day int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_window FROM public.pickup_windows WHERE id = p_window_id;
  IF v_window.id IS NULL THEN
    RAISE EXCEPTION 'Pickup window not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_window.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF length(v_label) = 0 THEN
    RAISE EXCEPTION 'Window label is required.' USING ERRCODE = '22023';
  END IF;

  IF p_start_time IS NULL OR p_end_time IS NULL OR p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Start time must be before end time.' USING ERRCODE = '22023';
  END IF;

  IF p_max_orders IS NOT NULL AND p_max_orders < 0 THEN
    RAISE EXCEPTION 'Capacity must be zero or greater.' USING ERRCODE = '22023';
  END IF;

  v_days := coalesce(p_days_of_week, v_window.days_of_week);
  IF array_length(v_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one day of the week.' USING ERRCODE = '22023';
  END IF;
  FOREACH v_day IN ARRAY v_days LOOP
    IF v_day < 1 OR v_day > 7 THEN
      RAISE EXCEPTION 'Days of week must be between 1 and 7.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_type := coalesce(p_window_type, v_window.window_type);
  IF v_type NOT IN ('standard', 'commuter', 'weekend') THEN
    RAISE EXCEPTION 'Window type is invalid.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.pickup_windows
  SET label = v_label, start_time = p_start_time, end_time = p_end_time,
      cutoff_time = p_cutoff_time, max_orders = p_max_orders, days_of_week = v_days, window_type = v_type
  WHERE id = p_window_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'pickup_window_updated', 'pickup_window', p_window_id, v_window.branch_id, v_actor,
    jsonb_build_object('label', v_label)
  );

  RETURN p_window_id;
END;
$$;

-- Enable/disable a pickup window (manager/owner only).
CREATE OR REPLACE FUNCTION public.admin_set_pickup_window_active(
  p_window_id uuid,
  p_is_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_window public.pickup_windows%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_window FROM public.pickup_windows WHERE id = p_window_id;
  IF v_window.id IS NULL THEN
    RAISE EXCEPTION 'Pickup window not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_window.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pickup_windows SET is_active = p_is_active WHERE id = p_window_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    CASE WHEN p_is_active THEN 'pickup_window_updated' ELSE 'pickup_window_disabled' END,
    'pickup_window', p_window_id, v_window.branch_id, v_actor,
    jsonb_build_object('is_active', p_is_active)
  );

  RETURN p_window_id;
END;
$$;

-- Create a shop closure (manager/owner only).
CREATE OR REPLACE FUNCTION public.admin_create_shop_closure(
  p_branch_id uuid,
  p_close_date date,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF p_close_date IS NULL THEN
    RAISE EXCEPTION 'Closure date is required.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.shop_closures (branch_id, close_date, reason, created_by)
  VALUES (p_branch_id, p_close_date, nullif(btrim(coalesce(p_reason, '')), ''), v_actor)
  ON CONFLICT (branch_id, close_date)
  DO UPDATE SET reason = excluded.reason
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'shop_closure_created', 'shop_closure', v_id, p_branch_id, v_actor,
    jsonb_build_object('close_date', p_close_date::text)
  );

  RETURN v_id;
END;
$$;

-- Remove a shop closure (manager/owner only).
CREATE OR REPLACE FUNCTION public.admin_remove_shop_closure(
  p_closure_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_closure public.shop_closures%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_closure FROM public.shop_closures WHERE id = p_closure_id;
  IF v_closure.id IS NULL THEN
    RAISE EXCEPTION 'Closure not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_closure.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.shop_closures WHERE id = p_closure_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'shop_closure_removed', 'shop_closure', p_closure_id, v_closure.branch_id, v_actor,
    jsonb_build_object('close_date', v_closure.close_date::text)
  );

  RETURN p_closure_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_pickup_window(uuid, text, time, time, time, int, int[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_pickup_window(uuid, text, time, time, time, int, int[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_pickup_window_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_shop_closure(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_shop_closure(uuid) TO authenticated;

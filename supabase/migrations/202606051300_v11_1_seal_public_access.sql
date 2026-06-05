-- V11.1 release sealing — tighten the public order access authority boundary.
--
-- Problem sealed: cancel_public_order / establish_public_order_access were granted
-- to anon, so an attacker holding a leaked public_access_id could cancel directly
-- via the anon REST endpoint, bypassing the signed HttpOnly session, and could
-- brute-force establishment without the application rate limiter.
--
-- Fix: these two RPCs become service_role-only. They are reachable solely through
-- a trusted server module (src/lib/server/order-access-privileged.ts) that runs
-- AFTER the server action verifies the session cookie / applies fail-closed rate
-- limiting. The effective enforcement layer therefore requires session + access
-- id for cancellation, and rate-limited server mediation for establishment.
--
-- Also: cancellation now enforces public_access_version (compare-and-check), so a
-- version bump invalidates outstanding cancellation authority; establishment
-- returns the current version so the session can bind to it.
--
-- Rollback/forward-fix: additive function redefinitions + grant changes. To roll
-- back, re-grant the prior signatures to anon (not recommended — reopens the gap).

-- 1. cancel_public_order: service_role only, with expected-version enforcement ---
-- DROP IF EXISTS removes the old signature and its grants; the new signature is
-- locked down after CREATE. (No pre-drop REVOKE so the migration is re-runnable.)
DROP FUNCTION IF EXISTS public.cancel_public_order(uuid, text);

CREATE OR REPLACE FUNCTION public.cancel_public_order(
  p_public_access_id uuid,
  p_reason text DEFAULT NULL,
  p_expected_version integer DEFAULT NULL
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

  -- Revocation re-checked under the lock.
  IF v_order.public_access_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Version binding: a bumped version invalidates outstanding cancel authority.
  IF p_expected_version IS NOT NULL AND v_order.public_access_version <> p_expected_version THEN
    RAISE EXCEPTION 'This order can no longer be cancelled online.' USING ERRCODE = '22023';
  END IF;

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

  -- Audit metadata deliberately excludes public_access_id / session material.
  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, metadata)
  VALUES (
    'order_status_changed', 'order', v_id, v_order.branch_id,
    jsonb_build_object('from', 'incoming', 'to', 'cancelled', 'by', 'customer', 'order_ref', v_order.order_ref)
  );

  RETURN jsonb_build_object('ok', true, 'orderRef', v_order.order_ref);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_public_order(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_public_order(uuid, text, integer) TO service_role;

-- 2. establish_public_order_access: service_role only, returns id + version ------
DROP FUNCTION IF EXISTS public.establish_public_order_access(text, text);

CREATE OR REPLACE FUNCTION public.establish_public_order_access(
  p_order_ref text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_ver integer;
BEGIN
  IF p_order_ref IS NULL OR p_phone IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT public_access_id, public_access_version INTO v_id, v_ver
  FROM public.orders
  WHERE order_ref = p_order_ref
    AND public_access_revoked_at IS NULL
    AND public.normalize_phone(customer_phone) = public.normalize_phone(p_phone)
    AND public.normalize_phone(p_phone) <> '';

  IF v_id IS NULL THEN
    RETURN NULL; -- identical result for unknown ref and wrong phone
  END IF;

  RETURN jsonb_build_object('publicAccessId', v_id, 'version', v_ver);
END;
$$;

REVOKE ALL ON FUNCTION public.establish_public_order_access(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.establish_public_order_access(text, text) TO service_role;

-- 3. Remove the legacy reference-keyed reader -----------------------------------
-- get_public_order(order_ref) was a SECURITY DEFINER reader from init.sql that
-- anon could call via PostgREST to retrieve customer_name + order details by the
-- enumerable reference. It is the same disclosure class V11.1 closes and has no
-- application caller (the app used the now-removed getOrderByRef). Drop it
-- (DROP removes its grants too).
DROP FUNCTION IF EXISTS public.get_public_order(text);

-- One Shop Day: make operational sequencing a database invariant.
--
-- UI and server actions already guide the person, but those boundaries cannot
-- close a stale-tab or closing race. These wrappers keep the proven V18 atomic
-- writers intact and add one branch/day transaction lock before new trading
-- work. Completed workflow runs and existing till idempotency keys still replay
-- through the original writer, so a lost response never asks for duplicate work.

CREATE OR REPLACE FUNCTION public.assert_shop_day_trading_v19(p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_business_date date := public.branch_business_date(p_branch_id, now());
  v_opening_status text;
  v_closing_status text;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'No branch is assigned to this account.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'shop-day:' || p_branch_id::text || ':' || v_business_date::text,
    0
  ));

  SELECT status INTO v_opening_status
  FROM public.ops_checklist_sessions
  WHERE branch_id = p_branch_id
    AND business_date = v_business_date
    AND kind = 'opening'
  ORDER BY started_at DESC, id DESC
  LIMIT 1;

  SELECT status INTO v_closing_status
  FROM public.ops_checklist_sessions
  WHERE branch_id = p_branch_id
    AND business_date = v_business_date
    AND kind = 'closing'
  ORDER BY started_at DESC, id DESC
  LIMIT 1;

  IF v_opening_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'Finish opening the shop before recording trading work.' USING ERRCODE = '55000';
  END IF;
  IF v_closing_status IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'Closing has started. Finish the close before starting more trading work.' USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_shop_day_trading_v19(uuid) FROM PUBLIC, anon, authenticated;

-- Preserve the certified V18 implementations behind guarded public names.
ALTER FUNCTION public.create_operator_serve_order_v18(uuid, jsonb, text)
  RENAME TO create_operator_serve_order_unguarded_v18;
ALTER FUNCTION public.complete_operator_no_waste_v18(uuid, uuid)
  RENAME TO complete_operator_no_waste_unguarded_v18;
ALTER FUNCTION public.record_operator_waste_v18(uuid, uuid, uuid, numeric, text, uuid, jsonb)
  RENAME TO record_operator_waste_unguarded_v18;
ALTER FUNCTION public.record_operator_delivery_v18(uuid, uuid, uuid, uuid, numeric, text, text, uuid, jsonb)
  RENAME TO record_operator_delivery_unguarded_v18;
ALTER FUNCTION public.record_till_event(uuid, text, integer, text, text, text)
  RENAME TO record_till_event_unguarded_v18;
ALTER FUNCTION public.ops_start_or_resume_session(uuid, text, date, text)
  RENAME TO ops_start_or_resume_session_unguarded_v18;

CREATE FUNCTION public.create_operator_serve_order_v18(
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
  v_branch_id uuid;
BEGIN
  SELECT branch_id INTO v_branch_id
  FROM public.operator_workflow_runs
  WHERE id = p_run_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.operator_workflow_runs
    WHERE id = p_run_id AND status = 'completed'
  ) THEN
    PERFORM public.assert_shop_day_trading_v19(v_branch_id);
  END IF;

  RETURN public.create_operator_serve_order_unguarded_v18(p_run_id, p_lines, p_payment_method);
END;
$$;

CREATE FUNCTION public.complete_operator_no_waste_v18(p_run_id uuid, p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.operator_workflow_runs
    WHERE id = p_run_id AND branch_id = p_branch_id AND status = 'completed'
  ) THEN
    PERFORM public.assert_shop_day_trading_v19(p_branch_id);
  END IF;
  RETURN public.complete_operator_no_waste_unguarded_v18(p_run_id, p_branch_id);
END;
$$;

CREATE FUNCTION public.record_operator_waste_v18(
  p_run_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_quantity_kg numeric,
  p_reason text,
  p_photo_evidence_id uuid,
  p_steps jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.operator_workflow_runs
    WHERE id = p_run_id AND branch_id = p_branch_id AND status = 'completed'
  ) THEN
    PERFORM public.assert_shop_day_trading_v19(p_branch_id);
  END IF;
  RETURN public.record_operator_waste_unguarded_v18(
    p_run_id, p_branch_id, p_product_id, p_quantity_kg, p_reason, p_photo_evidence_id, p_steps
  );
END;
$$;

CREATE FUNCTION public.record_operator_delivery_v18(
  p_run_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_supplier_id uuid,
  p_quantity_kg numeric,
  p_expiry_choice text,
  p_storage_choice text,
  p_note_evidence_id uuid,
  p_steps jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.operator_workflow_runs
    WHERE id = p_run_id AND branch_id = p_branch_id AND status = 'completed'
  ) THEN
    PERFORM public.assert_shop_day_trading_v19(p_branch_id);
  END IF;
  RETURN public.record_operator_delivery_unguarded_v18(
    p_run_id, p_branch_id, p_product_id, p_supplier_id, p_quantity_kg,
    p_expiry_choice, p_storage_choice, p_note_evidence_id, p_steps
  );
END;
$$;

CREATE FUNCTION public.record_till_event(
  p_branch_id uuid,
  p_kind text,
  p_amount_pence integer,
  p_reason_code text,
  p_idempotency_key text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.till_events
    WHERE branch_id = p_branch_id AND idempotency_key = nullif(btrim(coalesce(p_idempotency_key, '')), '')
  ) THEN
    PERFORM public.assert_shop_day_trading_v19(p_branch_id);
  END IF;
  RETURN public.record_till_event_unguarded_v18(
    p_branch_id, p_kind, p_amount_pence, p_reason_code, p_idempotency_key, p_note
  );
END;
$$;

CREATE FUNCTION public.ops_start_or_resume_session(
  p_branch_id uuid,
  p_kind text,
  p_business_date date DEFAULT NULL,
  p_source text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date := coalesce(p_business_date, public.branch_business_date(p_branch_id, now()));
  v_existing_id uuid;
BEGIN
  IF p_kind IN ('opening', 'closing') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'shop-day:' || p_branch_id::text || ':' || v_date::text,
      0
    ));

    SELECT id INTO v_existing_id
    FROM public.ops_checklist_sessions
    WHERE branch_id = p_branch_id
      AND business_date = v_date
      AND kind = p_kind
      AND status IN ('in_progress', 'completed')
    ORDER BY started_at DESC, id DESC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;

    IF p_kind = 'closing' THEN
      PERFORM public.assert_shop_day_trading_v19(p_branch_id);
    END IF;
  END IF;

  RETURN public.ops_start_or_resume_session_unguarded_v18(
    p_branch_id, p_kind, p_business_date, p_source
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_operator_serve_order_v18(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_operator_serve_order_v18(uuid, jsonb, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_operator_no_waste_v18(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_operator_no_waste_v18(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_operator_waste_v18(uuid, uuid, uuid, numeric, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_operator_waste_v18(uuid, uuid, uuid, numeric, text, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_operator_delivery_v18(uuid, uuid, uuid, uuid, numeric, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_operator_delivery_v18(uuid, uuid, uuid, uuid, numeric, text, text, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_till_event(uuid, text, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_till_event(uuid, text, integer, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ops_start_or_resume_session(uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_start_or_resume_session(uuid, text, date, text) TO authenticated, service_role;

-- Nobody should call the preserved implementations directly.
REVOKE ALL ON FUNCTION public.create_operator_serve_order_unguarded_v18(uuid, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_operator_no_waste_unguarded_v18(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_operator_waste_unguarded_v18(uuid, uuid, uuid, numeric, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_operator_delivery_unguarded_v18(uuid, uuid, uuid, uuid, numeric, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_till_event_unguarded_v18(uuid, text, integer, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ops_start_or_resume_session_unguarded_v18(uuid, text, date, text) FROM PUBLIC, anon, authenticated, service_role;

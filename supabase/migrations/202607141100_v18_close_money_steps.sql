-- V18 A1 — Closing money steps (audit finding PTM-OPS-001, part 2).
--
-- Closing now reconciles the drawer and the card machine against expected
-- money derived from the payment/till event ledgers shipped in 202607141000:
--
--   1. ops_checklist_sessions gains completion_metadata (additive) — closing
--      completion stamps expected/counted/variance pence there.
--   2. Closing checklist definition version 2 adds required numeric step
--      terminal_total ("Card machine total (Z report)"). The existing
--      required-numeric completion guard (202606291000) automatically blocks
--      finish without it — no guard change needed, the definition carries it.
--   3. ops_validate_checklist_payload (body-only) lets number steps carry an
--      optional integer expected_pence alongside value, so the money steps can
--      persist what was shown as expected at the moment of counting.
--   4. day_money_expected_v18() — the single authoritative expected-money
--      equation: expected cash = opening float + cash sales − cash refunds
--      + Σ signed till events; expected card = card sales − card refunds.
--      Float comes only from that day's opening float_ready reading; if the
--      ritual was skipped, expected cash is NULL ("float unknown") — never
--      guessed. Collected orders with no tender event (legacy/pre-A1) are
--      counted as missing_tender and make the variance alert unsafe to fire.
--   5. ops_complete_session (body-only) computes and stores the variances for
--      closing sessions and raises a warning owner_alert (kind till_variance)
--      when |variance| exceeds branch_settings.till_variance_alert_pence.
--      Completion is NEVER blocked on variance (audit rule) — blocking stays
--      only for missing required numerics.
--   6. ops_start_or_resume_session (body-only) defaults business_date to the
--      branch-local trading day via branch_business_date(), not the UTC date
--      (plan rule 1.11).

-- 1. Completion metadata (additive) ---------------------------------------------
ALTER TABLE public.ops_checklist_sessions
  ADD COLUMN IF NOT EXISTS completion_metadata jsonb;

-- 2. Closing definition version 2 with terminal_total ---------------------------
INSERT INTO public.ops_checklist_definitions(id, kind, definition_key, version, title, is_active)
VALUES
  ('00000000-0000-4000-8000-000000001263', 'closing', 'closing', 2, 'Closing the shop', true)
ON CONFLICT (definition_key, version) DO UPDATE
SET title = excluded.title, is_active = excluded.is_active;

INSERT INTO public.ops_checklist_definition_steps(definition_id, step_key, title, input_kind, unit, required, min_value, max_value, sort_order)
VALUES
  ('00000000-0000-4000-8000-000000001263', 'waste_logged', 'Log today''s waste', 'confirm', null, true, null, null, 10),
  ('00000000-0000-4000-8000-000000001263', 'stock_glance', 'Quick stock check', 'confirm', null, true, null, null, 20),
  ('00000000-0000-4000-8000-000000001263', 'cash_counted', 'Count the till', 'number', 'GBP', true, 0, 10000, 30),
  ('00000000-0000-4000-8000-000000001263', 'terminal_total', 'Card machine total (Z report)', 'number', 'GBP', true, 0, 10000, 35),
  ('00000000-0000-4000-8000-000000001263', 'fridges_closed', 'Fridges shut and still cold', 'number', 'C', true, -30, 30, 40),
  ('00000000-0000-4000-8000-000000001263', 'clean_done', 'Surfaces cleaned down', 'confirm', null, true, null, null, 50),
  ('00000000-0000-4000-8000-000000001263', 'lock_up', 'Locked up and alarm set', 'confirm', null, true, null, null, 60)
ON CONFLICT (definition_id, step_key) DO UPDATE
SET title = excluded.title,
    input_kind = excluded.input_kind,
    unit = excluded.unit,
    required = excluded.required,
    min_value = excluded.min_value,
    max_value = excluded.max_value,
    sort_order = excluded.sort_order;

-- 3. Number payloads may carry the expected value shown at capture time ---------
CREATE OR REPLACE FUNCTION public.ops_validate_checklist_payload(
  p_step public.ops_checklist_definition_steps,
  p_state text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_value numeric;
BEGIN
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid checklist evidence payload.' USING ERRCODE = '22023';
  END IF;

  IF p_state IN ('skipped', 'na') THEN
    IF NOT public.ops_checklist_payload_is_empty(v_payload) THEN
      RAISE EXCEPTION 'Skipped checklist steps cannot carry evidence values.' USING ERRCODE = '22023';
    END IF;
    RETURN '{}'::jsonb;
  END IF;

  IF p_state <> 'done' THEN
    RAISE EXCEPTION 'Invalid checklist step state.' USING ERRCODE = '22023';
  END IF;

  IF p_step.input_kind = 'confirm' THEN
    IF NOT public.ops_checklist_payload_is_empty(v_payload) THEN
      RAISE EXCEPTION 'Confirmation checklist steps cannot carry evidence values.' USING ERRCODE = '22023';
    END IF;
    RETURN '{}'::jsonb;
  END IF;

  IF NOT v_payload ? 'value' OR jsonb_typeof(v_payload->'value') <> 'number' THEN
    RAISE EXCEPTION 'Invalid checklist evidence value.' USING ERRCODE = '22023';
  END IF;

  v_value := (v_payload->>'value')::numeric;
  IF v_value < p_step.min_value OR v_value > p_step.max_value THEN
    RAISE EXCEPTION 'Checklist evidence value is out of range.' USING ERRCODE = '22023';
  END IF;

  -- V18 A1: money steps may persist the expected pence that was displayed at
  -- capture time (server-provided; kept as evidence of what the operator saw).
  IF v_payload ? 'expected_pence' AND jsonb_typeof(v_payload->'expected_pence') = 'number' THEN
    RETURN jsonb_build_object('value', v_value, 'expected_pence', round((v_payload->>'expected_pence')::numeric));
  END IF;

  RETURN jsonb_build_object('value', v_value);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ops_validate_checklist_payload(public.ops_checklist_definition_steps, text, jsonb)
  TO authenticated;

-- 4. The single authoritative expected-money equation ---------------------------
CREATE OR REPLACE FUNCTION public.day_money_expected_v18(
  p_branch_id uuid,
  p_business_date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_float_pence integer;
  v_cash_sales integer := 0;
  v_cash_refunds integer := 0;
  v_card_sales integer := 0;
  v_card_refunds integer := 0;
  v_till_sum integer := 0;
  v_missing integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_branch_staff(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  -- Opening float: only from that day's opening ritual reading; never guessed.
  SELECT round(((e.payload->>'value')::numeric) * 100)::integer INTO v_float_pence
  FROM public.ops_checklist_sessions s
  JOIN public.ops_checklist_events e ON e.session_id = s.id
  WHERE s.branch_id = p_branch_id
    AND s.kind = 'opening'
    AND s.business_date = p_business_date
    AND e.step_key = 'float_ready'
    AND e.state = 'done'
    AND e.payload ? 'value'
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 1;

  SELECT
    coalesce(sum(amount_pence) FILTER (WHERE direction = 'sale' AND method = 'cash'), 0),
    coalesce(sum(amount_pence) FILTER (WHERE direction = 'refund' AND method = 'cash'), 0),
    coalesce(sum(amount_pence) FILTER (WHERE direction = 'sale' AND method = 'card'), 0),
    coalesce(sum(amount_pence) FILTER (WHERE direction = 'refund' AND method = 'card'), 0)
  INTO v_cash_sales, v_cash_refunds, v_card_sales, v_card_refunds
  FROM public.payment_events
  WHERE branch_id = p_branch_id AND business_date = p_business_date;

  SELECT coalesce(sum(signed_amount_pence), 0) INTO v_till_sum
  FROM public.till_events
  WHERE branch_id = p_branch_id AND business_date = p_business_date;

  -- Orders collected on this branch-local day with no tender of record
  -- (legacy/pre-A1 rows). Listed, never guessed; makes variance alerts unsafe.
  SELECT count(DISTINCT ose.order_id)::integer INTO v_missing
  FROM public.order_status_events ose
  WHERE ose.branch_id = p_branch_id
    AND ose.status = 'collected'
    AND public.branch_business_date(p_branch_id, ose.created_at) = p_business_date
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_events pe
      WHERE pe.order_id = ose.order_id AND pe.direction = 'sale'
    );

  RETURN jsonb_build_object(
    'float_pence', v_float_pence,
    'cash_sales_pence', v_cash_sales,
    'cash_refunds_pence', v_cash_refunds,
    'card_sales_pence', v_card_sales,
    'card_refunds_pence', v_card_refunds,
    'till_movements_pence', v_till_sum,
    'expected_cash_pence',
      CASE WHEN v_float_pence IS NULL THEN NULL
           ELSE v_float_pence + v_cash_sales - v_cash_refunds + v_till_sum END,
    'expected_card_pence', v_card_sales - v_card_refunds,
    'missing_tender_count', v_missing
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.day_money_expected_v18(uuid, date)
  TO authenticated, service_role;

-- 5. Completion stamps variances + raises the till_variance alert ---------------
CREATE OR REPLACE FUNCTION public.ops_complete_session(
  p_session_id uuid,
  p_source text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.ops_checklist_sessions%ROWTYPE;
  v_definition public.ops_checklist_definitions%ROWTYPE;
  v_missing_count integer := 0;
  v_event_count integer := 0;
  v_completed_steps jsonb := '[]'::jsonb;
  v_expected jsonb;
  v_counted_cash_pence integer;
  v_counted_card_pence integer;
  v_expected_cash_pence integer;
  v_expected_card_pence integer;
  v_cash_variance integer;
  v_card_variance integer;
  v_missing_tender integer := 0;
  v_threshold integer := 500;
  v_alert_parts text[] := '{}';
  v_money jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_session FROM public.ops_checklist_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Checklist not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_manager(v_session.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF v_session.status = 'completed' THEN
    RETURN v_session.id;
  END IF;
  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This checklist can no longer be completed.' USING ERRCODE = '22023';
  END IF;

  IF v_session.kind IN ('opening', 'closing') THEN
    IF v_session.definition_id IS NULL THEN
      v_definition := public.ops_active_checklist_definition(v_session.kind);
      UPDATE public.ops_checklist_sessions
      SET definition_id = v_definition.id,
          definition_key = v_definition.definition_key,
          definition_version = v_definition.version
      WHERE id = p_session_id
      RETURNING * INTO v_session;
    END IF;

    SELECT count(*) INTO v_event_count
    FROM public.ops_checklist_events
    WHERE session_id = p_session_id;

    IF v_event_count = 0 THEN
      RAISE EXCEPTION 'Checklist cannot be completed without evidence.' USING ERRCODE = '22023';
    END IF;

    WITH latest AS (
      SELECT DISTINCT ON (step_key) step_key, state, payload, created_at
      FROM public.ops_checklist_events
      WHERE session_id = p_session_id
      ORDER BY step_key, created_at DESC, id DESC
    ),
    missing AS (
      SELECT s.step_key
      FROM public.ops_checklist_definition_steps s
      LEFT JOIN latest l ON l.step_key = s.step_key
      WHERE s.definition_id = v_session.definition_id
        AND s.required = true
        AND (
          -- required step never recorded at all
          l.step_key IS NULL
          -- required NUMERIC reading (e.g. fridge temperature, till count)
          -- skipped / na / anything that is not a captured value
          OR (s.input_kind = 'number' AND l.state <> 'done')
        )
    )
    SELECT count(*) INTO v_missing_count FROM missing;

    IF v_missing_count > 0 THEN
      RAISE EXCEPTION 'Checklist is incomplete; a required reading is missing.' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object('step_key', l.step_key, 'state', l.state) ORDER BY s.sort_order), '[]'::jsonb)
    INTO v_completed_steps
    FROM public.ops_checklist_definition_steps s
    JOIN (
      SELECT DISTINCT ON (step_key) step_key, state, created_at, id
      FROM public.ops_checklist_events
      WHERE session_id = p_session_id
      ORDER BY step_key, created_at DESC, id DESC
    ) l ON l.step_key = s.step_key
    WHERE s.definition_id = v_session.definition_id;
  END IF;

  -- V18 A1: closing money reconciliation. Variance NEVER blocks completion —
  -- only the required-numeric guard above blocks. Sessions on old definitions
  -- (no terminal_total) simply produce no card variance.
  IF v_session.kind = 'closing' THEN
    SELECT round(((e.payload->>'value')::numeric) * 100)::integer INTO v_counted_cash_pence
    FROM public.ops_checklist_events e
    WHERE e.session_id = p_session_id AND e.step_key = 'cash_counted' AND e.state = 'done' AND e.payload ? 'value'
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1;

    SELECT round(((e.payload->>'value')::numeric) * 100)::integer INTO v_counted_card_pence
    FROM public.ops_checklist_events e
    WHERE e.session_id = p_session_id AND e.step_key = 'terminal_total' AND e.state = 'done' AND e.payload ? 'value'
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1;

    v_expected := public.day_money_expected_v18(v_session.branch_id, v_session.business_date);
    v_expected_cash_pence := (v_expected->>'expected_cash_pence')::integer;
    v_expected_card_pence := (v_expected->>'expected_card_pence')::integer;
    v_missing_tender := coalesce((v_expected->>'missing_tender_count')::integer, 0);

    IF v_counted_cash_pence IS NOT NULL AND v_expected_cash_pence IS NOT NULL THEN
      v_cash_variance := v_counted_cash_pence - v_expected_cash_pence;
    END IF;
    IF v_counted_card_pence IS NOT NULL AND v_expected_card_pence IS NOT NULL THEN
      v_card_variance := v_counted_card_pence - v_expected_card_pence;
    END IF;

    SELECT coalesce(bs.till_variance_alert_pence, 500) INTO v_threshold
    FROM public.branch_settings bs
    WHERE bs.branch_id = v_session.branch_id;
    v_threshold := coalesce(v_threshold, 500);

    v_money := jsonb_build_object(
      'expected_cash_pence', v_expected_cash_pence,
      'expected_card_pence', v_expected_card_pence,
      'counted_cash_pence', v_counted_cash_pence,
      'counted_card_pence', v_counted_card_pence,
      'cash_variance_pence', v_cash_variance,
      'card_variance_pence', v_card_variance,
      'float_pence', v_expected->'float_pence',
      'till_movements_pence', v_expected->'till_movements_pence',
      'missing_tender_count', v_missing_tender,
      'alert_threshold_pence', v_threshold,
      -- Expected money is untrustworthy while collected-without-tender rows
      -- exist for the day (legacy/pre-A1) or the float is unknown — the alert
      -- is suppressed rather than guessed, and the suppression is recorded.
      'variance_alert_suppressed', (v_missing_tender > 0)
    );
  END IF;

  UPDATE public.ops_checklist_sessions
  SET status = 'completed', completed_by = v_actor, completed_at = now(),
      completion_metadata = v_money
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('ops_session_completed', 'ops_checklist_session', p_session_id, v_session.branch_id, v_actor,
    jsonb_build_object(
      'kind', v_session.kind,
      'business_date', v_session.business_date,
      'definition_key', v_session.definition_key,
      'definition_version', v_session.definition_version,
      'completed_steps', v_completed_steps)
    || CASE WHEN v_money IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('money', v_money) END);

  IF v_session.kind = 'closing' AND v_missing_tender = 0 THEN
    IF v_cash_variance IS NOT NULL AND abs(v_cash_variance) > v_threshold THEN
      v_alert_parts := array_append(v_alert_parts,
        'Till was £' || to_char(abs(v_cash_variance) / 100.0, 'FM999999990.00') ||
        CASE WHEN v_cash_variance < 0 THEN ' short' ELSE ' over' END || ' at closing.');
    END IF;
    IF v_card_variance IS NOT NULL AND abs(v_card_variance) > v_threshold THEN
      v_alert_parts := array_append(v_alert_parts,
        'Card machine total was £' || to_char(abs(v_card_variance) / 100.0, 'FM999999990.00') ||
        CASE WHEN v_card_variance < 0 THEN ' short' ELSE ' over' END || ' at closing.');
    END IF;

    IF array_length(v_alert_parts, 1) > 0 THEN
      INSERT INTO public.owner_alerts(branch_id, severity, kind, summary, entity_ref, created_by)
      SELECT
        v_session.branch_id,
        'warning',
        'till_variance',
        array_to_string(v_alert_parts, ' '),
        'close:' || v_session.id::text,
        v_actor
      WHERE NOT EXISTS (
        SELECT 1 FROM public.owner_alerts oa
        WHERE oa.branch_id = v_session.branch_id
          AND oa.kind = 'till_variance'
          AND oa.entity_ref = 'close:' || v_session.id::text
          AND oa.resolved_at IS NULL
      );
    END IF;
  END IF;

  RETURN v_session.id;
END;
$$;

-- CREATE OR REPLACE resets the function ACL, so re-assert the EXECUTE grant the
-- app role needs (mirrors the original V12.6 grant).
GRANT EXECUTE ON FUNCTION public.ops_complete_session(uuid, text) TO authenticated;

-- 6. Sessions default to the branch-local trading day (plan rule 1.11) ----------
CREATE OR REPLACE FUNCTION public.ops_start_or_resume_session(
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
  v_actor uuid := auth.uid();
  v_session_id uuid;
  -- V18 A1: the branch-local trading day, not the UTC calendar day.
  v_date date := coalesce(p_business_date, public.branch_business_date(p_branch_id, now()));
  v_definition public.ops_checklist_definitions%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('opening', 'closing', 'stock_count') THEN
    RAISE EXCEPTION 'Unknown checklist type.' USING ERRCODE = '22023';
  END IF;

  IF p_kind IN ('opening', 'closing') THEN
    v_definition := public.ops_active_checklist_definition(p_kind);
  END IF;

  SELECT id INTO v_session_id
  FROM public.ops_checklist_sessions
  WHERE branch_id = p_branch_id AND kind = p_kind AND business_date = v_date AND status = 'in_progress'
  LIMIT 1;
  IF v_session_id IS NOT NULL THEN
    IF p_kind IN ('opening', 'closing') THEN
      UPDATE public.ops_checklist_sessions
      SET definition_id = coalesce(definition_id, v_definition.id),
          definition_key = coalesce(definition_key, v_definition.definition_key),
          definition_version = coalesce(definition_version, v_definition.version)
      WHERE id = v_session_id;
    END IF;
    RETURN v_session_id;
  END IF;

  INSERT INTO public.ops_checklist_sessions(branch_id, kind, business_date, started_by, source, definition_id, definition_key, definition_version)
  VALUES (
    p_branch_id,
    p_kind,
    v_date,
    v_actor,
    nullif(btrim(coalesce(p_source, '')), ''),
    CASE WHEN p_kind IN ('opening', 'closing') THEN v_definition.id ELSE NULL END,
    CASE WHEN p_kind IN ('opening', 'closing') THEN v_definition.definition_key ELSE NULL END,
    CASE WHEN p_kind IN ('opening', 'closing') THEN v_definition.version ELSE NULL END
  )
  RETURNING id INTO v_session_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('ops_session_started', 'ops_checklist_session', v_session_id, p_branch_id, v_actor,
    jsonb_build_object('kind', p_kind, 'business_date', v_date, 'definition_version', v_definition.version));

  RETURN v_session_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT id INTO v_session_id
    FROM public.ops_checklist_sessions
    WHERE branch_id = p_branch_id AND kind = p_kind AND business_date = v_date AND status = 'in_progress'
    LIMIT 1;
    RETURN v_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ops_start_or_resume_session(uuid, text, date, text) TO authenticated;

-- Phase 1 / F8 (closes H4) - Required compliance readings cannot be silently
-- skipped at open/close.
--
-- Before: ops_complete_session only blocked completion when a required step had
-- NO event at all. A step recorded as 'skipped' / 'na' still produced an event,
-- so the operator could tap "I can't do this" on the fridge temperature and the
-- day would still close with no reading - a hole in the food-safety audit trail.
--
-- After: a required NUMERIC step (the temperature readings, the till counts) must
-- have its latest state = 'done'. Because ops_record_step already rejects a
-- 'done' numeric step without an in-range value, "latest state is done" proves a
-- valid reading was captured. Confirm-step "Not now" behaviour is unchanged.
--
-- This only redefines the completion guard; everything else in the RPC is identical.

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

  UPDATE public.ops_checklist_sessions
  SET status = 'completed', completed_by = v_actor, completed_at = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('ops_session_completed', 'ops_checklist_session', p_session_id, v_session.branch_id, v_actor,
    jsonb_build_object(
      'kind', v_session.kind,
      'business_date', v_session.business_date,
      'definition_key', v_session.definition_key,
      'definition_version', v_session.definition_version,
      'completed_steps', v_completed_steps));

  RETURN v_session.id;
END;
$$;

-- CREATE OR REPLACE resets the function ACL, so re-assert the EXECUTE grant the
-- app role needs (mirrors the original V12.6 grant).
GRANT EXECUTE ON FUNCTION public.ops_complete_session(uuid, text) TO authenticated;

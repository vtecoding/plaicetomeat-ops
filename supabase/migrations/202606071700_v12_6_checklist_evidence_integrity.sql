-- V12.6 - Checklist / Compliance Evidence Integrity.
--
-- Make guided opening/closing checklists evidence-backed instead of UI-only:
-- sessions bind to versioned definitions, step keys are known server-side,
-- evidence payloads are type/bounds checked, and completion is derived from
-- persisted required step events before success audit is emitted.

CREATE TABLE IF NOT EXISTS public.ops_checklist_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('opening', 'closing')),
  definition_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version),
  UNIQUE (definition_key, version)
);

CREATE TABLE IF NOT EXISTS public.ops_checklist_definition_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES public.ops_checklist_definitions(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  title text NOT NULL,
  input_kind text NOT NULL CHECK (input_kind IN ('confirm', 'number')),
  unit text,
  required boolean NOT NULL DEFAULT true,
  min_value numeric,
  max_value numeric,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, step_key),
  UNIQUE (definition_id, sort_order),
  CHECK (
    (input_kind = 'confirm' AND unit IS NULL AND min_value IS NULL AND max_value IS NULL)
    OR
    (input_kind = 'number' AND unit IS NOT NULL AND min_value IS NOT NULL AND max_value IS NOT NULL AND min_value <= max_value)
  )
);

ALTER TABLE public.ops_checklist_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_checklist_definition_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers read checklist definitions" ON public.ops_checklist_definitions;
CREATE POLICY "managers read checklist definitions" ON public.ops_checklist_definitions
FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "managers read checklist definition steps" ON public.ops_checklist_definition_steps;
CREATE POLICY "managers read checklist definition steps" ON public.ops_checklist_definition_steps
FOR SELECT USING (auth.role() = 'authenticated');

INSERT INTO public.ops_checklist_definitions(id, kind, definition_key, version, title, is_active)
VALUES
  ('00000000-0000-4000-8000-000000001261', 'opening', 'opening', 1, 'Opening the shop', true),
  ('00000000-0000-4000-8000-000000001262', 'closing', 'closing', 1, 'Closing the shop', true)
ON CONFLICT (definition_key, version) DO UPDATE
SET title = excluded.title, is_active = excluded.is_active;

INSERT INTO public.ops_checklist_definition_steps(definition_id, step_key, title, input_kind, unit, required, min_value, max_value, sort_order)
VALUES
  ('00000000-0000-4000-8000-000000001261', 'fridge_temp', 'Check the fridge & display are cold', 'number', 'C', true, -30, 30, 10),
  ('00000000-0000-4000-8000-000000001261', 'certs_visible', 'Halal & food-safety certificates on show', 'confirm', null, true, null, null, 20),
  ('00000000-0000-4000-8000-000000001261', 'display_ready', 'Counter and display set up', 'confirm', null, true, null, null, 30),
  ('00000000-0000-4000-8000-000000001261', 'float_ready', 'Till float counted and ready', 'number', 'GBP', true, 0, 10000, 40),
  ('00000000-0000-4000-8000-000000001261', 'open_sign', 'Open sign on, lights up', 'confirm', null, true, null, null, 50),
  ('00000000-0000-4000-8000-000000001262', 'waste_logged', 'Log today''s waste', 'confirm', null, true, null, null, 10),
  ('00000000-0000-4000-8000-000000001262', 'stock_glance', 'Quick stock check', 'confirm', null, true, null, null, 20),
  ('00000000-0000-4000-8000-000000001262', 'cash_counted', 'Count the till', 'number', 'GBP', true, 0, 10000, 30),
  ('00000000-0000-4000-8000-000000001262', 'fridges_closed', 'Fridges shut and still cold', 'number', 'C', true, -30, 30, 40),
  ('00000000-0000-4000-8000-000000001262', 'clean_done', 'Surfaces cleaned down', 'confirm', null, true, null, null, 50),
  ('00000000-0000-4000-8000-000000001262', 'lock_up', 'Locked up and alarm set', 'confirm', null, true, null, null, 60)
ON CONFLICT (definition_id, step_key) DO UPDATE
SET title = excluded.title,
    input_kind = excluded.input_kind,
    unit = excluded.unit,
    required = excluded.required,
    min_value = excluded.min_value,
    max_value = excluded.max_value,
    sort_order = excluded.sort_order;

ALTER TABLE public.ops_checklist_sessions
  ADD COLUMN IF NOT EXISTS definition_id uuid REFERENCES public.ops_checklist_definitions(id),
  ADD COLUMN IF NOT EXISTS definition_key text,
  ADD COLUMN IF NOT EXISTS definition_version integer;

UPDATE public.ops_checklist_sessions s
SET definition_id = d.id,
    definition_key = d.definition_key,
    definition_version = d.version
FROM public.ops_checklist_definitions d
WHERE s.kind = d.kind
  AND d.version = 1
  AND s.kind IN ('opening', 'closing')
  AND s.definition_id IS NULL;

CREATE OR REPLACE FUNCTION public.ops_active_checklist_definition(p_kind text)
RETURNS public.ops_checklist_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_definition public.ops_checklist_definitions%ROWTYPE;
BEGIN
  SELECT * INTO v_definition
  FROM public.ops_checklist_definitions
  WHERE kind = p_kind AND is_active = true
  ORDER BY version DESC
  LIMIT 1;

  IF v_definition.id IS NULL THEN
    RAISE EXCEPTION 'Checklist definition is not configured.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_definition;
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_checklist_payload_is_empty(p_payload jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_payload, '{}'::jsonb) = '{}'::jsonb;
$$;

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

  RETURN jsonb_build_object('value', v_value);
END;
$$;

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
  v_date date := coalesce(p_business_date, (now() AT TIME ZONE 'utc')::date);
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

CREATE OR REPLACE FUNCTION public.ops_record_step(
  p_session_id uuid,
  p_step_key text,
  p_state text,
  p_payload jsonb DEFAULT '{}',
  p_source text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.ops_checklist_sessions%ROWTYPE;
  v_event_id uuid;
  v_step_key text := nullif(btrim(coalesce(p_step_key, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_step public.ops_checklist_definition_steps%ROWTYPE;
  v_definition public.ops_checklist_definitions%ROWTYPE;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
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
  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This checklist is already finished.' USING ERRCODE = '22023';
  END IF;
  IF v_step_key IS NULL THEN
    RAISE EXCEPTION 'Checklist step is required.' USING ERRCODE = '22023';
  END IF;
  IF p_state NOT IN ('done', 'skipped', 'na') THEN
    RAISE EXCEPTION 'Invalid checklist step state.' USING ERRCODE = '22023';
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

    SELECT * INTO v_step
    FROM public.ops_checklist_definition_steps
    WHERE definition_id = v_session.definition_id AND step_key = v_step_key;

    IF v_step.id IS NULL THEN
      RAISE EXCEPTION 'Unknown checklist step.' USING ERRCODE = '22023';
    END IF;

    v_payload := public.ops_validate_checklist_payload(v_step, p_state, v_payload);
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT id INTO v_event_id FROM public.ops_checklist_events
    WHERE session_id = p_session_id AND step_key = v_step_key AND idempotency_key = v_key;
    IF v_event_id IS NOT NULL THEN
      RETURN v_event_id;
    END IF;
  END IF;

  INSERT INTO public.ops_checklist_events(session_id, branch_id, step_key, state, payload, actor_id, source, idempotency_key)
  VALUES (p_session_id, v_session.branch_id, v_step_key, p_state, v_payload, v_actor,
    nullif(btrim(coalesce(p_source, '')), ''), v_key)
  RETURNING id INTO v_event_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('ops_step_recorded', 'ops_checklist_session', p_session_id, v_session.branch_id, v_actor,
    jsonb_build_object('step', v_step_key, 'state', p_state, 'definition_version', v_session.definition_version));

  RETURN v_event_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT id INTO v_event_id FROM public.ops_checklist_events
    WHERE session_id = p_session_id AND step_key = v_step_key AND idempotency_key = v_key;
    RETURN v_event_id;
END;
$$;

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
        AND l.step_key IS NULL
    )
    SELECT count(*) INTO v_missing_count FROM missing;

    IF v_missing_count > 0 THEN
      RAISE EXCEPTION 'Checklist is incomplete; required evidence is missing.' USING ERRCODE = '22023';
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

GRANT EXECUTE ON FUNCTION public.ops_start_or_resume_session(uuid, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_record_step(uuid, text, text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_complete_session(uuid, text) TO authenticated;

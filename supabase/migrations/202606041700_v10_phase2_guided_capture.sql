-- V10 Phase 2a — Guided operational capture (data layer).
--
-- Stable sessions + append-only step events + stock-count evidence behind the opening,
-- closing and stock-count rituals. Manager/owner-gated throughout (is_branch_manager).
--
-- Integrity rules baked into this layer:
--   * Every write is idempotent (start-or-resume + idempotency keys + upserts).
--   * Every write is audit-logged and provenance-stamped (actor, source, timestamps).
--   * Step events are APPEND-ONLY — "current state of a step" is its latest event, so
--     nothing is ever destructively overwritten and partial progress always replays.
--   * Stock NEVER changes here by a silent overwrite: a count records evidence only, and
--     applying it goes through the existing correction path (admin_adjust_inventory_remaining),
--     which writes an inventory_movements correction + reason + audit row.
--   * Waste captured in the closing ritual uses the existing admin_record_inventory_waste
--     RPC (recorded elsewhere) so it feeds the established waste-intelligence path; this
--     layer only records provenance for it.

-- ── Tables ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ops_checklist_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('opening', 'closing', 'stock_count')),
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  started_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  source text
);

-- Exactly one live session per ritual per trading day → "start or resume" is deterministic
-- and a day can never fork into two competing sessions.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_sessions_one_active
ON public.ops_checklist_sessions(branch_id, kind, business_date)
WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_ops_sessions_branch_date
ON public.ops_checklist_sessions(branch_id, business_date);

CREATE TABLE IF NOT EXISTS public.ops_checklist_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.ops_checklist_sessions(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('done', 'skipped', 'na')),
  payload jsonb NOT NULL DEFAULT '{}',
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_events_session
ON public.ops_checklist_events(session_id, created_at);

-- Retry-safe: the same intent (same key) for a step can only land once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_events_idempotency
ON public.ops_checklist_events(session_id, step_key, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.ops_checklist_sessions(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.inventory_batches(id) ON DELETE CASCADE,
  system_weight_kg numeric NOT NULL,
  counted_weight_kg numeric NOT NULL,
  correction_movement_id uuid REFERENCES public.inventory_movements(id) ON DELETE SET NULL,
  applied_at timestamptz,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One evidence line per batch per count. Re-counting (pre-apply) updates the same line;
-- once applied the line is immutable. (session_id, batch_id) uniqueness gives idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_count_lines_session_batch
ON public.stock_count_lines(session_id, batch_id);

CREATE INDEX IF NOT EXISTS idx_stock_count_lines_session
ON public.stock_count_lines(session_id);

-- ── Row level security (reads only; all writes go through SECURITY DEFINER RPCs) ──

ALTER TABLE public.ops_checklist_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_checklist_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers read ops sessions" ON public.ops_checklist_sessions;
CREATE POLICY "managers read ops sessions" ON public.ops_checklist_sessions
FOR SELECT USING (public.is_branch_manager(branch_id));

DROP POLICY IF EXISTS "managers read ops events" ON public.ops_checklist_events;
CREATE POLICY "managers read ops events" ON public.ops_checklist_events
FOR SELECT USING (public.is_branch_manager(branch_id));

DROP POLICY IF EXISTS "managers read stock count lines" ON public.stock_count_lines;
CREATE POLICY "managers read stock count lines" ON public.stock_count_lines
FOR SELECT USING (public.is_branch_manager(branch_id));

-- ── RPCs ────────────────────────────────────────────────────────────────────────

-- Start the ritual for today, or resume the one already in progress. Idempotent by the
-- one-active-session unique index, with a concurrent-start fallback.
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

  SELECT id INTO v_session_id
  FROM public.ops_checklist_sessions
  WHERE branch_id = p_branch_id AND kind = p_kind AND business_date = v_date AND status = 'in_progress'
  LIMIT 1;
  IF v_session_id IS NOT NULL THEN
    RETURN v_session_id;
  END IF;

  INSERT INTO public.ops_checklist_sessions(branch_id, kind, business_date, started_by, source)
  VALUES (p_branch_id, p_kind, v_date, v_actor, nullif(btrim(coalesce(p_source, '')), ''))
  RETURNING id INTO v_session_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('ops_session_started', 'ops_checklist_session', v_session_id, p_branch_id, v_actor,
    jsonb_build_object('kind', p_kind, 'business_date', v_date));

  RETURN v_session_id;
EXCEPTION
  WHEN unique_violation THEN
    -- A concurrent caller created the live session first — return theirs.
    SELECT id INTO v_session_id
    FROM public.ops_checklist_sessions
    WHERE branch_id = p_branch_id AND kind = p_kind AND business_date = v_date AND status = 'in_progress'
    LIMIT 1;
    RETURN v_session_id;
END;
$$;

-- Record (append) one step outcome. 'skipped'/'na' are real, recorded states — there are
-- no fake completion ticks. Idempotent on the supplied key.
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
  v_step text := nullif(btrim(coalesce(p_step_key, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
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
  IF v_step IS NULL THEN
    RAISE EXCEPTION 'Checklist step is required.' USING ERRCODE = '22023';
  END IF;
  IF p_state NOT IN ('done', 'skipped', 'na') THEN
    RAISE EXCEPTION 'Invalid checklist step state.' USING ERRCODE = '22023';
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT id INTO v_event_id FROM public.ops_checklist_events
    WHERE session_id = p_session_id AND step_key = v_step AND idempotency_key = v_key;
    IF v_event_id IS NOT NULL THEN
      RETURN v_event_id;
    END IF;
  END IF;

  INSERT INTO public.ops_checklist_events(session_id, branch_id, step_key, state, payload, actor_id, source, idempotency_key)
  VALUES (p_session_id, v_session.branch_id, v_step, p_state, coalesce(p_payload, '{}'::jsonb), v_actor,
    nullif(btrim(coalesce(p_source, '')), ''), v_key)
  RETURNING id INTO v_event_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('ops_step_recorded', 'ops_checklist_session', p_session_id, v_session.branch_id, v_actor,
    jsonb_build_object('step', v_step, 'state', p_state));

  RETURN v_event_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT id INTO v_event_id FROM public.ops_checklist_events
    WHERE session_id = p_session_id AND step_key = v_step AND idempotency_key = v_key;
    RETURN v_event_id;
END;
$$;

-- Mark a ritual finished. Idempotent: completing an already-complete checklist returns it.
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

  UPDATE public.ops_checklist_sessions
  SET status = 'completed', completed_by = v_actor, completed_at = now()
  WHERE id = p_session_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('ops_session_completed', 'ops_checklist_session', p_session_id, v_session.branch_id, v_actor,
    jsonb_build_object('kind', v_session.kind, 'business_date', v_session.business_date));

  RETURN v_session.id;
END;
$$;

-- Record (or update, pre-apply) the counted weight for one batch. Snapshots what the
-- system currently believes, stores what was physically counted, and changes NO stock.
CREATE OR REPLACE FUNCTION public.ops_record_stock_count_line(
  p_session_id uuid,
  p_batch_id uuid,
  p_counted_weight_kg numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.ops_checklist_sessions%ROWTYPE;
  v_batch public.inventory_batches%ROWTYPE;
  v_line_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_session FROM public.ops_checklist_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Checklist not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_session.kind <> 'stock_count' THEN
    RAISE EXCEPTION 'This checklist is not a stock count.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_branch_manager(v_session.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This stock count is already finished.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_batch FROM public.inventory_batches WHERE id = p_batch_id;
  IF v_batch.id IS NULL OR v_batch.branch_id <> v_session.branch_id THEN
    RAISE EXCEPTION 'Stock item not found.' USING ERRCODE = 'P0002';
  END IF;
  IF p_counted_weight_kg IS NULL OR p_counted_weight_kg < 0 THEN
    RAISE EXCEPTION 'Counted weight cannot be negative.' USING ERRCODE = '22023';
  END IF;
  IF p_counted_weight_kg > v_batch.received_weight_kg THEN
    RAISE EXCEPTION 'Stock left cannot exceed the actual weight received.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stock_count_lines(session_id, branch_id, batch_id, system_weight_kg, counted_weight_kg, actor_id)
  VALUES (p_session_id, v_session.branch_id, p_batch_id, v_batch.remaining_weight_kg, p_counted_weight_kg, v_actor)
  ON CONFLICT (session_id, batch_id) DO UPDATE
    SET counted_weight_kg = excluded.counted_weight_kg,
        system_weight_kg = excluded.system_weight_kg,
        actor_id = excluded.actor_id,
        created_at = now()
    WHERE public.stock_count_lines.applied_at IS NULL
  RETURNING id INTO v_line_id;

  IF v_line_id IS NULL THEN
    RAISE EXCEPTION 'This stock count line is already applied.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('stock_count_recorded', 'inventory_batch', p_batch_id, v_session.branch_id, v_actor,
    jsonb_build_object('system_kg', v_batch.remaining_weight_kg, 'counted_kg', p_counted_weight_kg));

  RETURN v_line_id;
END;
$$;

-- Apply one counted line. If it matches the system, mark reconciled with no stock change.
-- If it differs, change stock ONLY through the existing correction-evidence path. Idempotent.
CREATE OR REPLACE FUNCTION public.ops_apply_stock_count_line(
  p_session_id uuid,
  p_line_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.ops_checklist_sessions%ROWTYPE;
  v_line public.stock_count_lines%ROWTYPE;
  v_movement_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_line FROM public.stock_count_lines WHERE id = p_line_id FOR UPDATE;
  IF v_line.id IS NULL OR v_line.session_id <> p_session_id THEN
    RAISE EXCEPTION 'Stock count line not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_session FROM public.ops_checklist_sessions WHERE id = v_line.session_id;
  IF NOT public.is_branch_manager(v_session.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This stock count is already finished.' USING ERRCODE = '22023';
  END IF;

  -- Idempotent: applying again returns the line unchanged.
  IF v_line.applied_at IS NOT NULL THEN
    RETURN v_line.id;
  END IF;

  v_reason := coalesce(v_reason, 'Stock count ' || to_char(v_session.business_date, 'YYYY-MM-DD'));

  IF v_line.counted_weight_kg = v_line.system_weight_kg THEN
    -- Counted matches the system — reconcile with no correction.
    UPDATE public.stock_count_lines SET applied_at = now() WHERE id = p_line_id;
    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
    VALUES ('stock_count_line_applied', 'inventory_batch', v_line.batch_id, v_session.branch_id, v_actor,
      jsonb_build_object('system_kg', v_line.system_weight_kg, 'counted_kg', v_line.counted_weight_kg, 'difference_kg', 0));
    RETURN v_line.id;
  END IF;

  -- Differs — change stock through the established correction path (movement + reason + audit).
  v_movement_id := public.admin_adjust_inventory_remaining(v_line.batch_id, v_line.counted_weight_kg, v_reason);

  UPDATE public.stock_count_lines
  SET applied_at = now(), correction_movement_id = v_movement_id
  WHERE id = p_line_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('stock_count_line_applied', 'inventory_batch', v_line.batch_id, v_session.branch_id, v_actor,
    jsonb_build_object(
      'system_kg', v_line.system_weight_kg,
      'counted_kg', v_line.counted_weight_kg,
      'difference_kg', v_line.counted_weight_kg - v_line.system_weight_kg,
      'movement_id', v_movement_id));

  RETURN v_line.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ops_start_or_resume_session(uuid, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_record_step(uuid, text, text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_complete_session(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_record_stock_count_line(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_apply_stock_count_line(uuid, uuid, text) TO authenticated;

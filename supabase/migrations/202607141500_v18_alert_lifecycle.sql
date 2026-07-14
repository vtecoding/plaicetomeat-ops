-- V18 B2 — one canonical owner work tray and full alert lifecycle.

ALTER TABLE public.owner_alerts
  ADD COLUMN IF NOT EXISTS seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_note text;

CREATE INDEX IF NOT EXISTS owner_alerts_branch_lifecycle_idx
  ON public.owner_alerts (branch_id, resolved_at, created_at DESC);

-- Reconcile any historical/racy duplicates before sealing the one-open-job
-- invariant for a delivery batch.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY branch_id, kind, entity_ref
           ORDER BY created_at, id
         ) AS ordinal
  FROM public.owner_alerts
  WHERE kind = 'operator_delivery_cost_pending'
    AND resolved_at IS NULL
)
UPDATE public.owner_alerts a
SET resolved_at = now(),
    resolution_note = coalesce(a.resolution_note, 'Duplicate delivery-cost job consolidated during V18 migration.')
FROM ranked r
WHERE a.id = r.id AND r.ordinal > 1;

CREATE UNIQUE INDEX IF NOT EXISTS owner_alerts_delivery_cost_open_uniq
  ON public.owner_alerts (branch_id, kind, entity_ref)
  WHERE kind = 'operator_delivery_cost_pending' AND resolved_at IS NULL;

-- Help/mistake submissions have their own immutable operation identity. The
-- identity is independent of kind and remains unique after resolution: a lost
-- response retried later must return the original row, while a genuinely new
-- report about the same run uses a new operation id and remains legitimate.
ALTER TABLE public.owner_alerts
  ADD COLUMN IF NOT EXISTS operation_id uuid,
  ADD COLUMN IF NOT EXISTS operation_fingerprint text;

ALTER TABLE public.owner_alerts
  DROP CONSTRAINT IF EXISTS owner_alerts_operation_fingerprint_shape,
  ADD CONSTRAINT owner_alerts_operation_fingerprint_shape CHECK (
    operation_fingerprint IS NULL OR length(operation_fingerprint) = 64
  ),
  DROP CONSTRAINT IF EXISTS owner_alerts_operation_kind_shape,
  ADD CONSTRAINT owner_alerts_operation_kind_shape CHECK (
    operation_id IS NULL OR kind IN ('operator_help', 'operator_mistake_flag')
  );

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY branch_id, kind, entity_ref
           ORDER BY created_at, id
         ) AS ordinal
  FROM public.owner_alerts
  WHERE kind = 'operator_help' AND resolved_at IS NULL
)
UPDATE public.owner_alerts a
SET resolved_at = now(),
    resolution_note = coalesce(a.resolution_note, 'Duplicate help job consolidated during V18 migration.')
FROM ranked r
WHERE a.id = r.id AND r.ordinal > 1;

-- Old help entity refs carried a parseable operation UUID. Preserve exactly
-- one canonical history row per operation; any duplicate legacy rows remain
-- present with a NULL operation_id rather than being rewritten or deleted.
WITH parsed AS (
  SELECT
    id,
    branch_id,
    substring(entity_ref FROM length('operator-help:') + 1)::uuid AS parsed_operation_id,
    row_number() OVER (
      PARTITION BY branch_id, substring(entity_ref FROM length('operator-help:') + 1)::uuid
      ORDER BY created_at, id
    ) AS ordinal
  FROM public.owner_alerts
  WHERE kind = 'operator_help'
    AND operation_id IS NULL
    AND entity_ref ~* '^operator-help:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
UPDATE public.owner_alerts a
SET operation_id = p.parsed_operation_id
FROM parsed p
WHERE a.id = p.id AND p.ordinal = 1;

DROP INDEX IF EXISTS public.owner_alerts_operator_help_operation_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS owner_alerts_help_operation_history_uniq
  ON public.owner_alerts (branch_id, operation_id)
  WHERE operation_id IS NOT NULL;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY branch_id, kind, entity_ref
           ORDER BY created_at, id
         ) AS ordinal
  FROM public.owner_alerts
  WHERE kind = 'operator_mistake_flag'
    AND resolved_at IS NULL
)
UPDATE public.owner_alerts a
SET resolved_at = now(),
    resolution_note = coalesce(a.resolution_note, 'Duplicate mistake job consolidated during V18 migration.')
FROM ranked r
WHERE a.id = r.id AND r.ordinal > 1;

DROP INDEX IF EXISTS public.owner_alerts_mistake_open_uniq;
CREATE UNIQUE INDEX owner_alerts_mistake_open_uniq
  ON public.owner_alerts (branch_id, kind, entity_ref)
  WHERE kind = 'operator_mistake_flag'
    AND operation_id IS NULL
    AND resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public.create_operator_help_alert_v18(
  p_operation_id uuid,
  p_problem text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_existing public.owner_alerts%ROWTYPE;
  v_problem text := nullif(btrim(coalesce(p_problem, '')), '');
  v_note text;
  v_label text;
  v_kind text;
  v_severity text;
  v_summary text;
  v_fingerprint text;
  v_run_id uuid;
  v_run_workflow text;
  v_run_result_ref text;
  v_entity_ref text;
  v_alert_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Help operation id is required.' USING ERRCODE = '22023';
  END IF;
  IF v_problem IS NULL OR v_problem NOT IN (
    'fridge', 'ran_out', 'equipment', 'unsure', 'mistake', 'other'
  ) THEN
    RAISE EXCEPTION 'Unknown help problem.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_actor
  FOR SHARE;
  IF v_profile.id IS NULL
     OR NOT coalesce(v_profile.is_active, false)
     OR v_profile.branch_id IS NULL
     OR v_profile.role NOT IN ('manager', 'owner') THEN
    RAISE EXCEPTION 'Not authorised to call the owner.' USING ERRCODE = '42501';
  END IF;

  v_note := nullif(btrim(substring(
    regexp_replace(coalesce(p_note, ''), '[^[:alnum:]_ .,:;()/\-]', '', 'g')
    FROM 1 FOR 200
  )), '');
  v_label := CASE v_problem
    WHEN 'fridge' THEN 'Fridge or freezer problem'
    WHEN 'ran_out' THEN 'Ran out of something'
    WHEN 'equipment' THEN 'A machine is broken'
    WHEN 'unsure' THEN 'I am not sure what to do'
    WHEN 'mistake' THEN 'I made a mistake just now'
    ELSE 'Something else'
  END;
  v_kind := CASE WHEN v_problem = 'mistake' THEN 'operator_mistake_flag' ELSE 'operator_help' END;
  v_severity := CASE WHEN v_problem IN ('fridge', 'equipment') THEN 'critical' ELSE 'warning' END;
  v_summary := 'Help from the shop: ' || v_label || '.' ||
    CASE WHEN v_note IS NULL THEN '' ELSE ' "' || v_note || '"' END;
  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'problem', v_problem,
    'note', v_note
  )::text, 'sha256'), 'hex');

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'operator-help:' || v_profile.branch_id::text || ':' || p_operation_id::text,
    0
  ));

  SELECT * INTO v_existing
  FROM public.owner_alerts
  WHERE branch_id = v_profile.branch_id
    AND operation_id = p_operation_id
  FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.operation_fingerprint IS NOT NULL
       AND v_existing.operation_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This help request was already sent with different details.'
        USING ERRCODE = '22023';
    END IF;
    IF v_existing.operation_fingerprint IS NULL
       AND (
         v_existing.kind IS DISTINCT FROM v_kind
         OR v_existing.summary IS DISTINCT FROM v_summary
         OR v_existing.entity_ref IS DISTINCT FROM 'operator-help:' || p_operation_id::text
       ) THEN
      RAISE EXCEPTION 'This help request was already sent with different details.'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'id', v_existing.id,
      'kind', v_existing.kind,
      'entity_ref', v_existing.entity_ref,
      'created', false,
      'replayed', true,
      'resolved', v_existing.resolved_at IS NOT NULL
    );
  END IF;

  IF v_problem = 'mistake' THEN
    SELECT r.id, r.workflow, r.result_ref
    INTO v_run_id, v_run_workflow, v_run_result_ref
    FROM public.operator_workflow_runs r
    WHERE r.branch_id = v_profile.branch_id
      AND r.operator_id = v_actor
      AND r.status = 'completed'
    ORDER BY r.updated_at DESC, r.id DESC
    LIMIT 1
    FOR SHARE;
    v_entity_ref := coalesce(v_run_result_ref, 'operator-run:' || coalesce(v_run_id, p_operation_id)::text);
  ELSE
    v_entity_ref := 'operator-help:' || p_operation_id::text;
  END IF;

  INSERT INTO public.owner_alerts(
    branch_id, severity, kind, summary, entity_ref, created_by,
    operation_id, operation_fingerprint
  ) VALUES (
    v_profile.branch_id, v_severity, v_kind, v_summary, v_entity_ref, v_actor,
    p_operation_id, v_fingerprint
  )
  RETURNING id INTO v_alert_id;

  PERFORM public.emit_audit_log(
    'inventory_reconciliation_issue', 'owner_alert', v_alert_id, v_profile.branch_id,
    jsonb_build_object(
      'kind', v_kind,
      'summary', v_summary,
      'operator_id', v_actor,
      'operation_id', p_operation_id,
      'problem', v_problem,
      'note', v_note,
      'workflow', v_run_workflow,
      'run_id', v_run_id,
      'result_ref', v_run_result_ref
    )
  );

  RETURN jsonb_build_object(
    'id', v_alert_id,
    'kind', v_kind,
    'entity_ref', v_entity_ref,
    'created', true,
    'replayed', false,
    'resolved', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_operator_help_alert_v18(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_operator_help_alert_v18(uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ensure_delivery_cost_owner_alert_v18(
  p_branch_id uuid,
  p_summary text,
  p_entity_ref text,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_created boolean := false;
BEGIN
  IF nullif(btrim(coalesce(p_summary, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_entity_ref, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Delivery-cost alert summary and entity are required.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.owner_alerts(
    branch_id, severity, kind, summary, entity_ref, created_by
  )
  VALUES (
    p_branch_id, 'warning', 'operator_delivery_cost_pending',
    btrim(p_summary), btrim(p_entity_ref), p_created_by
  )
  ON CONFLICT (branch_id, kind, entity_ref)
    WHERE kind = 'operator_delivery_cost_pending' AND resolved_at IS NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    v_created := true;
  ELSE
    SELECT id INTO v_id
    FROM public.owner_alerts
    WHERE branch_id = p_branch_id
      AND kind = 'operator_delivery_cost_pending'
      AND entity_ref = btrim(p_entity_ref)
      AND resolved_at IS NULL;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_delivery_cost_owner_alert_v18(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_delivery_cost_owner_alert_v18(uuid, text, text, uuid) TO service_role;

-- Criticality belongs to the versioned DB definition as well as the UI. That
-- lets a skipped step create its durable alert in the same transaction without
-- trusting a client-supplied severity.
ALTER TABLE public.ops_checklist_definition_steps
  ADD COLUMN IF NOT EXISTS critical boolean NOT NULL DEFAULT false;

UPDATE public.ops_checklist_definition_steps
SET critical = step_key IN ('fridge_temp', 'certs_visible', 'fridges_closed', 'clean_done');

DROP INDEX IF EXISTS public.owner_alerts_checklist_skip_uniq;
CREATE UNIQUE INDEX owner_alerts_checklist_skip_uniq
  ON public.owner_alerts (branch_id, kind, entity_ref)
  WHERE kind = 'checklist_skip' AND resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public.create_checklist_skip_alert_v18()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.ops_checklist_sessions%ROWTYPE;
  v_step public.ops_checklist_definition_steps%ROWTYPE;
  v_ref text;
  v_alert_id uuid;
BEGIN
  IF NEW.state <> 'skipped' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_session FROM public.ops_checklist_sessions WHERE id = NEW.session_id;
  IF v_session.id IS NULL OR v_session.kind NOT IN ('opening', 'closing') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_step
  FROM public.ops_checklist_definition_steps
  WHERE definition_id = v_session.definition_id AND step_key = NEW.step_key;
  IF v_step.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_ref := 'checklist:' || NEW.session_id::text || ':' || NEW.step_key;
  INSERT INTO public.owner_alerts(branch_id, severity, kind, summary, entity_ref, created_by)
  VALUES (
    v_session.branch_id,
    CASE WHEN v_step.critical THEN 'critical' ELSE 'warning' END,
    'checklist_skip',
    CASE WHEN v_step.critical THEN 'Critical checklist step skipped: ' ELSE 'Checklist step skipped: ' END || v_step.title || '.',
    v_ref,
    NEW.actor_id
  )
  ON CONFLICT (branch_id, kind, entity_ref)
    WHERE kind = 'checklist_skip' AND resolved_at IS NULL
  DO NOTHING
  RETURNING id INTO v_alert_id;
  IF v_alert_id IS NOT NULL THEN
    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
    VALUES (
      'owner_alert_lifecycle_changed', 'owner_alert', v_alert_id, v_session.branch_id, NEW.actor_id,
      jsonb_build_object(
        'kind', 'checklist_skip',
        'transition', 'created',
        'rule', 'checklist_skip',
        'session_id', NEW.session_id,
        'step_key', NEW.step_key,
        'critical', v_step.critical
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checklist_skip_creates_alert_v18 ON public.ops_checklist_events;
CREATE TRIGGER checklist_skip_creates_alert_v18
AFTER INSERT ON public.ops_checklist_events
FOR EACH ROW EXECUTE FUNCTION public.create_checklist_skip_alert_v18();

-- Resolve every open inventory shortfall whose depletion detail names the
-- product that was just counted or adjusted. This is database-side so every
-- stock write path gets the same self-heal behaviour.
CREATE OR REPLACE FUNCTION public.resolve_inventory_shortfalls_for_product_v18(
  p_branch_id uuid,
  p_product_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH resolved AS (
    UPDATE public.owner_alerts a
    SET resolved_at = now(),
        resolution_note = coalesce(a.resolution_note, 'Resolved automatically after this stock was checked.'),
        claimed_by = coalesce(a.claimed_by, auth.uid()),
        claimed_at = coalesce(a.claimed_at, now()),
        seen_at = coalesce(a.seen_at, now())
    WHERE a.branch_id = p_branch_id
      AND a.kind = 'inventory_shortfall'
      AND a.resolved_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.order_inventory_depletions d
        CROSS JOIN LATERAL jsonb_array_elements(d.shortfall_detail) detail(value)
        WHERE d.branch_id = p_branch_id
          AND a.entity_ref = 'order:' || d.order_id::text
          AND detail.value->>'product_id' = p_product_id::text
      )
    RETURNING a.id, a.kind
  ), audited AS (
    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
    SELECT
      'owner_alert_lifecycle_changed', 'owner_alert', r.id, p_branch_id, auth.uid(),
      jsonb_build_object(
        'kind', r.kind,
        'transition', 'auto_resolved',
        'rule', 'stock_touch',
        'product_id', p_product_id
      )
    FROM resolved r
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM resolved;
  RETURN v_count;
END;
$$;

-- Trigger-internal only. Exposing this SECURITY DEFINER function to an
-- authenticated caller would let them name another branch and clear its jobs.
REVOKE ALL ON FUNCTION public.resolve_inventory_shortfalls_for_product_v18(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_inventory_shortfalls_for_product_v18(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_resolve_shortfall_from_movement_v18()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
BEGIN
  -- Refund reversals are system compensation, not a human stock check. Only
  -- the controlled manual/count correction path proves the shortfall was
  -- actually investigated.
  IF NEW.movement_type <> 'ADJUSTMENT' OR NEW.source_event IS DISTINCT FROM 'MANUAL_ADJUST' THEN
    RETURN NEW;
  END IF;
  SELECT product_id INTO v_product_id FROM public.inventory_batches WHERE id = NEW.batch_id;
  IF v_product_id IS NOT NULL THEN
    PERFORM public.resolve_inventory_shortfalls_for_product_v18(NEW.branch_id, v_product_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_resolves_shortfall_v18 ON public.inventory_movements;
CREATE TRIGGER inventory_movement_resolves_shortfall_v18
AFTER INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.auto_resolve_shortfall_from_movement_v18();

-- A count which matches the system produces no adjustment movement, but still
-- counts as touching the product. Resolve on applied_at as well.
CREATE OR REPLACE FUNCTION public.auto_resolve_shortfall_from_count_v18()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
BEGIN
  IF OLD.applied_at IS NOT NULL OR NEW.applied_at IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT product_id INTO v_product_id FROM public.inventory_batches WHERE id = NEW.batch_id;
  IF v_product_id IS NOT NULL THEN
    PERFORM public.resolve_inventory_shortfalls_for_product_v18(NEW.branch_id, v_product_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_count_line_resolves_shortfall_v18 ON public.stock_count_lines;
CREATE TRIGGER stock_count_line_resolves_shortfall_v18
AFTER UPDATE OF applied_at ON public.stock_count_lines
FOR EACH ROW EXECUTE FUNCTION public.auto_resolve_shortfall_from_count_v18();

-- Checklist help/skip alerts self-heal when that same step is subsequently
-- completed. The alert remains as history with an explicit automatic note.
CREATE OR REPLACE FUNCTION public.auto_resolve_checklist_alert_v18()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.ops_checklist_sessions%ROWTYPE;
  v_ref text;
BEGIN
  IF NEW.state <> 'done' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_session FROM public.ops_checklist_sessions WHERE id = NEW.session_id;
  IF v_session.id IS NULL OR v_session.kind NOT IN ('opening', 'closing') THEN
    RETURN NEW;
  END IF;

  v_ref := 'checklist:' || NEW.session_id::text || ':' || NEW.step_key;
  WITH resolved AS (
    UPDATE public.owner_alerts
    SET resolved_at = now(),
        resolution_note = coalesce(resolution_note, 'Resolved automatically when the checklist step was completed.'),
        seen_at = coalesce(seen_at, now())
    WHERE branch_id = v_session.branch_id
      AND kind IN ('operator_checklist_help', 'checklist_skip')
      AND entity_ref IN (
        v_ref,
        -- Legacy F8 server alerts used this branch/kind/step/day shape.
        v_session.branch_id::text || ':' || v_session.kind || ':' || NEW.step_key || ':' || v_session.business_date::text
      )
      AND resolved_at IS NULL
    RETURNING id, kind
  )
  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  SELECT
    'owner_alert_lifecycle_changed', 'owner_alert', id, v_session.branch_id, auth.uid(),
    jsonb_build_object(
      'kind', kind,
      'transition', 'auto_resolved',
      'rule', 'checklist_step_complete',
      'session_id', NEW.session_id,
      'step_key', NEW.step_key
    )
  FROM resolved;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checklist_step_resolves_alert_v18 ON public.ops_checklist_events;
CREATE TRIGGER checklist_step_resolves_alert_v18
AFTER INSERT ON public.ops_checklist_events
FOR EACH ROW EXECUTE FUNCTION public.auto_resolve_checklist_alert_v18();

CREATE OR REPLACE FUNCTION public.auto_resolve_not_opened_alert_v18()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.kind = 'opening' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    WITH resolved AS (
      UPDATE public.owner_alerts
      SET resolved_at = now(),
          resolution_note = coalesce(resolution_note, 'Resolved automatically when opening was completed.'),
          seen_at = coalesce(seen_at, now())
      WHERE branch_id = NEW.branch_id
        AND kind = 'not_opened_by_time'
        AND entity_ref = 'opening:' || NEW.business_date::text
        AND resolved_at IS NULL
      RETURNING id, kind
    )
    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
    SELECT
      'owner_alert_lifecycle_changed', 'owner_alert', id, NEW.branch_id, auth.uid(),
      jsonb_build_object(
        'kind', kind,
        'transition', 'auto_resolved',
        'rule', 'opening_complete',
        'session_id', NEW.id,
        'business_date', NEW.business_date
      )
    FROM resolved;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opening_completion_resolves_alert_v18 ON public.ops_checklist_sessions;
CREATE TRIGGER opening_completion_resolves_alert_v18
AFTER UPDATE OF status ON public.ops_checklist_sessions
FOR EACH ROW EXECUTE FUNCTION public.auto_resolve_not_opened_alert_v18();

-- Resolve a note/confirmation owner job and write its audit fact in the same
-- transaction. The function is service-only because the TypeScript registry is
-- the canonical allow-list for note resolution; actor and branch authority are
-- nevertheless revalidated here before any mutation.
CREATE OR REPLACE FUNCTION public.resolve_owner_alert_lifecycle_v18(
  p_branch_id uuid,
  p_actor_id uuid,
  p_alert_id uuid,
  p_expected_kind text,
  p_resolution_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alert public.owner_alerts%ROWTYPE;
  v_note text := nullif(btrim(regexp_replace(coalesce(p_resolution_note, ''), '\s+', ' ', 'g')), '');
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_actor_id
      AND p.is_active IS TRUE
      AND p.role IN ('manager', 'owner')
      AND (p.role = 'owner' OR p.branch_id = p_branch_id)
  ) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF v_note IS NULL OR char_length(v_note) < 2 OR char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'A short resolution note is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_alert
  FROM public.owner_alerts
  WHERE id = p_alert_id
  FOR UPDATE;
  IF v_alert.id IS NULL OR v_alert.branch_id <> p_branch_id THEN
    RAISE EXCEPTION 'Owner job not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_alert.kind <> p_expected_kind THEN
    RAISE EXCEPTION 'Owner job kind no longer matches.' USING ERRCODE = '22023';
  END IF;

  -- A lost response may replay the exact completed operation without adding a
  -- second audit row. A different actor/note cannot rewrite resolved history.
  IF v_alert.resolved_at IS NOT NULL THEN
    IF v_alert.claimed_by = p_actor_id AND v_alert.resolution_note = v_note THEN
      RETURN jsonb_build_object('id', v_alert.id, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'Owner job is already resolved.' USING ERRCODE = '23505';
  END IF;
  IF v_alert.claimed_by IS NOT NULL
     AND v_alert.claimed_by <> p_actor_id
     AND v_alert.claimed_at IS NOT NULL
     AND v_alert.claimed_at >= v_now - interval '10 minutes' THEN
    RAISE EXCEPTION 'Owner job is already claimed.' USING ERRCODE = '55P03';
  END IF;

  UPDATE public.owner_alerts
  SET seen_at = coalesce(seen_at, v_now),
      claimed_by = p_actor_id,
      claimed_at = v_now,
      resolved_at = v_now,
      resolution_note = v_note
  WHERE id = v_alert.id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'inventory_reconciliation_issue', 'owner_alert', v_alert.id, p_branch_id, p_actor_id,
    jsonb_build_object('resolved', true, 'kind', v_alert.kind, 'resolutionNote', v_note)
  );

  RETURN jsonb_build_object('id', v_alert.id, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_owner_alert_lifecycle_v18(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_owner_alert_lifecycle_v18(uuid, uuid, uuid, text, text) TO service_role;

-- Delivery cost + lifecycle + both audit facts are one serialised transaction.
-- This replaces the old action-level sequence whose crash window could save a
-- cost while leaving the job leased and later permit a blind overwrite.
CREATE OR REPLACE FUNCTION public.resolve_delivery_cost_owner_job_v18(
  p_branch_id uuid,
  p_actor_id uuid,
  p_alert_id uuid,
  p_batch_id uuid,
  p_invoice_cost numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alert public.owner_alerts%ROWTYPE;
  v_batch public.inventory_batches%ROWTYPE;
  v_cost numeric := round(p_invoice_cost, 2);
  v_cost_per_kg numeric;
  v_note text;
  v_now timestamptz := clock_timestamp();
  v_cost_already_saved boolean := false;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_actor_id
      AND p.is_active IS TRUE
      AND p.role IN ('manager', 'owner')
      AND (p.role = 'owner' OR p.branch_id = p_branch_id)
  ) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_cost IS NULL OR p_invoice_cost <= 0 OR v_cost <> p_invoice_cost THEN
    RAISE EXCEPTION 'Cost must be greater than zero with at most 2 decimal places.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_alert
  FROM public.owner_alerts
  WHERE id = p_alert_id
  FOR UPDATE;
  IF v_alert.id IS NULL OR v_alert.branch_id <> p_branch_id THEN
    RAISE EXCEPTION 'Owner job not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_alert.kind <> 'operator_delivery_cost_pending'
     OR v_alert.entity_ref IS DISTINCT FROM p_batch_id::text || ':cost' THEN
    RAISE EXCEPTION 'This delivery job no longer matches.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_batch
  FROM public.inventory_batches
  WHERE id = p_batch_id
    AND branch_id = p_branch_id
  FOR UPDATE;
  IF v_batch.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = v_batch.product_id
      AND p.branch_id = p_branch_id
      AND p.inventory_policy = 'kg_batch'
  ) THEN
    RAISE EXCEPTION 'Delivery batch not found.' USING ERRCODE = 'P0002';
  END IF;

  v_note := 'Invoice cost saved: £' || to_char(v_cost, 'FM999999990.00') || '.';
  IF v_alert.resolved_at IS NOT NULL THEN
    IF v_alert.claimed_by = p_actor_id
       AND v_alert.resolution_note = v_note
       AND v_batch.invoice_cost = v_cost THEN
      RETURN jsonb_build_object('id', v_alert.id, 'batchId', v_batch.id, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'Owner job is already resolved.' USING ERRCODE = '23505';
  END IF;
  IF v_alert.claimed_by IS NOT NULL
     AND v_alert.claimed_by <> p_actor_id
     AND v_alert.claimed_at IS NOT NULL
     AND v_alert.claimed_at >= v_now - interval '10 minutes' THEN
    RAISE EXCEPTION 'Owner job is already claimed.' USING ERRCODE = '55P03';
  END IF;

  IF coalesce(v_batch.invoice_cost, 0) > 0 THEN
    IF v_batch.invoice_cost <> v_cost THEN
      RAISE EXCEPTION 'The delivery cost changed. Refresh this job before continuing.' USING ERRCODE = '40001';
    END IF;
    v_cost_already_saved := true;
  ELSE
    v_cost_per_kg := CASE
      WHEN coalesce(v_batch.received_weight_kg, 0) > 0 THEN round(v_cost / v_batch.received_weight_kg, 2)
      ELSE 0
    END;
    UPDATE public.inventory_batches
    SET invoice_cost = v_cost,
        cost_per_kg = v_cost_per_kg
    WHERE id = v_batch.id;

    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
    VALUES (
      'cost_changed', 'inventory_batch', v_batch.id, p_branch_id, p_actor_id,
      jsonb_build_object(
        'from', v_batch.invoice_cost,
        'to', v_cost,
        'cost_per_kg', v_cost_per_kg,
        'reason', 'operator_delivery_cost_reconciled'
      )
    );
  END IF;

  UPDATE public.owner_alerts
  SET seen_at = coalesce(seen_at, v_now),
      claimed_by = p_actor_id,
      claimed_at = v_now,
      resolved_at = v_now,
      resolution_note = v_note
  WHERE id = v_alert.id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'inventory_reconciliation_issue', 'owner_alert', v_alert.id, p_branch_id, p_actor_id,
    jsonb_build_object(
      'resolved', true,
      'kind', v_alert.kind,
      'batchId', v_batch.id,
      'invoiceCost', v_cost,
      'costAlreadySaved', v_cost_already_saved
    )
  );

  RETURN jsonb_build_object(
    'id', v_alert.id,
    'batchId', v_batch.id,
    'replayed', false,
    'costAlreadySaved', v_cost_already_saved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_delivery_cost_owner_job_v18(uuid, uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_delivery_cost_owner_job_v18(uuid, uuid, uuid, uuid, numeric) TO service_role;

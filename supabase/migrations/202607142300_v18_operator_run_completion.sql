-- V18 B6 hardening: a workflow run is the durable operation identity.
--
-- Draft state may fail without blocking the real operation, but completion of a
-- delivery/waste business fact must be atomic with the run's terminal state.
-- A server-derived fingerprint rejects a stale tab which reuses a run id with
-- changed answers. Completed and abandoned runs are terminal at the database
-- boundary, so Start Fresh is also a business-operation fence.

ALTER TABLE public.operator_workflow_runs
  ADD COLUMN IF NOT EXISTS completion_fingerprint text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_receipt jsonb;

CREATE OR REPLACE FUNCTION public.enforce_operator_run_terminal_v18()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('completed', 'abandoned') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A completed or replaced operator run cannot be changed.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operator_workflow_run_terminal_v18 ON public.operator_workflow_runs;
CREATE TRIGGER operator_workflow_run_terminal_v18
BEFORE UPDATE ON public.operator_workflow_runs
FOR EACH ROW EXECUTE FUNCTION public.enforce_operator_run_terminal_v18();

REVOKE ALL ON FUNCTION public.enforce_operator_run_terminal_v18()
  FROM PUBLIC, anon, authenticated;

-- Runs which were already open at cutover may have crossed the old action's
-- non-atomic boundary (business fact first, run completion later). Mark only
-- that finite set so the completion RPCs can recover conservatively without
-- changing the behaviour of runs opened after this migration.
UPDATE public.operator_workflow_runs
SET steps = CASE WHEN jsonb_typeof(steps) = 'object' THEN steps ELSE '{}'::jsonb END
  || jsonb_build_object('_completionCutover', 'pre_202607142300')
WHERE status = 'in_progress'
  AND workflow IN ('delivery', 'waste');

-- Historical duplicate open cards are consolidated before the open-run index
-- is installed. A completed run prevents a later replay even after resolution.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY branch_id, kind, entity_ref
           ORDER BY created_at, id
         ) AS ordinal
  FROM public.owner_alerts
  WHERE kind IN (
    'operator_delivery_unknown_product',
    'operator_delivery_needs_owner',
    'operator_delivery_unknown_supplier',
    'operator_delivery_check_needed',
    'operator_stock_ran_out',
    'operator_stock_help_needed',
    'operator_waste_unknown_product',
    'operator_waste_needs_owner',
    'operator_waste_no_matching_stock',
    'operator_waste_reason_check',
    'operator_waste_recovery_needed'
  )
    AND resolved_at IS NULL
)
UPDATE public.owner_alerts a
SET resolved_at = now(),
    resolution_note = coalesce(a.resolution_note, 'Duplicate operator-run job consolidated during V18 migration.')
FROM ranked r
WHERE a.id = r.id AND r.ordinal > 1;

CREATE UNIQUE INDEX IF NOT EXISTS owner_alerts_operator_run_open_uniq
  ON public.owner_alerts(branch_id, kind, entity_ref)
  WHERE kind IN (
    'operator_delivery_unknown_product',
    'operator_delivery_needs_owner',
    'operator_delivery_unknown_supplier',
    'operator_delivery_check_needed',
    'operator_stock_ran_out',
    'operator_stock_help_needed',
    'operator_waste_unknown_product',
    'operator_waste_needs_owner',
    'operator_waste_no_matching_stock',
    'operator_waste_reason_check',
    'operator_waste_recovery_needed'
  ) AND resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public.prepare_operator_run_v18(
  p_run_id uuid,
  p_branch_id uuid,
  p_workflow text,
  p_completion_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_run public.operator_workflow_runs%ROWTYPE;
  v_fingerprint text := nullif(btrim(coalesce(p_completion_fingerprint, '')), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF p_run_id IS NULL OR p_branch_id IS NULL OR p_workflow IS NULL
     OR p_workflow NOT IN ('serve', 'delivery', 'waste') THEN
    RAISE EXCEPTION 'Operator run identity is invalid.' USING ERRCODE = '22023';
  END IF;
  IF v_fingerprint IS NULL OR length(v_fingerprint) > 128 THEN
    RAISE EXCEPTION 'Operator completion fingerprint is invalid.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('operator-run:' || p_run_id::text, 0));

  SELECT * INTO v_run
  FROM public.operator_workflow_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    INSERT INTO public.operator_workflow_runs(
      id, branch_id, operator_id, workflow, status, steps, updated_at
    ) VALUES (
      p_run_id, p_branch_id, v_actor, p_workflow, 'in_progress', '{}'::jsonb, now()
    )
    RETURNING * INTO v_run;
  ELSIF v_run.branch_id IS DISTINCT FROM p_branch_id
     OR v_run.operator_id IS DISTINCT FROM v_actor
     OR v_run.workflow IS DISTINCT FROM p_workflow THEN
    RAISE EXCEPTION 'Operator run does not belong to this workflow.' USING ERRCODE = '42501';
  END IF;

  IF v_run.status = 'abandoned' THEN
    RAISE EXCEPTION 'This operator run was replaced. Use the newer run.' USING ERRCODE = '55000';
  END IF;
  IF v_run.status = 'completed' THEN
    IF v_run.completion_fingerprint IS NOT NULL
       AND v_run.completion_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'This operator run was already completed with different answers.'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'replayed', true,
      'legacy', v_run.completion_fingerprint IS NULL,
      'result_ref', v_run.result_ref,
      'receipt', v_run.completion_receipt,
      'steps', v_run.steps
    );
  END IF;

  RETURN jsonb_build_object('replayed', false, 'steps', coalesce(v_run.steps, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_operator_run_v18(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_operator_completion_audit_v18(
  p_run_id uuid,
  p_branch_id uuid,
  p_workflow text,
  p_result_ref text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_existing public.audit_logs%ROWTYPE;
  v_existing_count integer;
BEGIN
  IF v_actor IS NULL OR p_run_id IS NULL OR p_branch_id IS NULL
     OR p_workflow IS NULL
     OR p_workflow NOT IN ('delivery', 'waste', 'certificate')
     OR nullif(btrim(coalesce(p_result_ref, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Operator completion audit is invalid.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_existing_count
  FROM public.audit_logs
  WHERE event_type = 'ops_session_completed'
    AND target_type = 'operator_workflow_run'
    AND target_id = p_run_id;
  IF v_existing_count > 1 THEN
    RAISE EXCEPTION 'Operator completion has duplicate audit evidence.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_existing
  FROM public.audit_logs
  WHERE event_type = 'ops_session_completed'
    AND target_type = 'operator_workflow_run'
    AND target_id = p_run_id
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.branch_id IS DISTINCT FROM p_branch_id
       OR (
         nullif(v_existing.metadata->>'workflow', '') IS NOT NULL
         AND v_existing.metadata->>'workflow' IS DISTINCT FROM p_workflow
       )
       OR (
         nullif(v_existing.metadata->>'result_ref', '') IS NOT NULL
         AND v_existing.metadata->>'result_ref' IS DISTINCT FROM btrim(p_result_ref)
       ) THEN
      RAISE EXCEPTION 'Operator completion audit conflicts with the completed run.'
        USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.audit_logs(
    event_type, target_type, target_id, branch_id, actor_id, metadata
  ) VALUES (
    'ops_session_completed', 'operator_workflow_run', p_run_id,
    p_branch_id, v_actor,
    jsonb_build_object(
      'workflow', p_workflow,
      'operator_id', v_actor,
      'result_ref', btrim(p_result_ref),
      'repaired_or_completed_by', 'operator_completion_v18'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_operator_completion_audit_v18(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finalize_operator_run_v18(
  p_run_id uuid,
  p_branch_id uuid,
  p_workflow text,
  p_completion_fingerprint text,
  p_steps jsonb,
  p_result_ref text,
  p_receipt jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_changed uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF jsonb_typeof(coalesce(p_steps, 'null'::jsonb)) <> 'object'
     OR octet_length(p_steps::text) > 32000 THEN
    RAISE EXCEPTION 'Operator completion steps are invalid.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_receipt, 'null'::jsonb)) <> 'object'
     OR nullif(btrim(coalesce(p_result_ref, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Operator completion receipt is invalid.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.operator_workflow_runs
  SET status = 'completed',
      steps = p_steps,
      result_ref = btrim(p_result_ref),
      completion_fingerprint = p_completion_fingerprint,
      completion_receipt = p_receipt,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_run_id
    AND branch_id = p_branch_id
    AND operator_id = v_actor
    AND workflow = p_workflow
    AND status = 'in_progress'
  RETURNING id INTO v_changed;

  IF v_changed IS NULL THEN
    RAISE EXCEPTION 'Operator run could not be completed.' USING ERRCODE = '55000';
  END IF;

  PERFORM public.ensure_operator_completion_audit_v18(
    p_run_id, p_branch_id, p_workflow, btrim(p_result_ref)
  );

  RETURN p_receipt || jsonb_build_object('replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_operator_run_v18(uuid, uuid, text, text, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_operator_run_alert_v18(
  p_branch_id uuid,
  p_run_id uuid,
  p_kind text,
  p_summary text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
  v_inserted boolean := false;
  v_allowed constant text[] := ARRAY[
    'operator_delivery_unknown_product',
    'operator_delivery_needs_owner',
    'operator_delivery_unknown_supplier',
    'operator_delivery_check_needed',
    'operator_stock_ran_out',
    'operator_stock_help_needed',
    'operator_waste_unknown_product',
    'operator_waste_needs_owner',
    'operator_waste_no_matching_stock',
    'operator_waste_reason_check',
    'operator_waste_recovery_needed'
  ];
BEGIN
  IF v_actor IS NULL OR NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR NOT (p_kind = ANY(v_allowed))
     OR nullif(btrim(coalesce(p_summary, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Owner-check alert is invalid.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.owner_alerts(
    branch_id, severity, kind, summary, entity_ref, created_by
  ) VALUES (
    p_branch_id, 'warning', p_kind, btrim(p_summary), p_run_id::text, v_actor
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    v_inserted := true;
  ELSE
    SELECT id INTO v_id
    FROM public.owner_alerts
    WHERE branch_id = p_branch_id
      AND kind = p_kind
      AND entity_ref = p_run_id::text
      AND resolved_at IS NULL;
  END IF;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Owner-check alert could not be recorded.' USING ERRCODE = '23514';
  END IF;

  IF v_inserted THEN
    PERFORM public.emit_audit_log(
      'inventory_reconciliation_issue',
      'owner_alert',
      v_id,
      p_branch_id,
      jsonb_build_object(
        'kind', p_kind,
        'summary', btrim(p_summary),
        'operator_id', v_actor,
        'run_id', p_run_id,
        'metadata', coalesce(p_metadata, '{}'::jsonb)
      )
    );
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_operator_run_alert_v18(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_operator_owner_check_v18(
  p_run_id uuid,
  p_branch_id uuid,
  p_workflow text,
  p_kind text,
  p_summary text,
  p_steps jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fingerprint text;
  v_prepared jsonb;
  v_alert_id uuid;
  v_receipt jsonb;
  v_legacy_steps jsonb;
  v_legacy_result_ref text;
  v_legacy_alert public.owner_alerts%ROWTYPE;
BEGIN
  IF p_workflow IS NULL OR p_workflow NOT IN ('delivery', 'waste')
     OR jsonb_typeof(coalesce(p_steps, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Owner-check completion is invalid.' USING ERRCODE = '22023';
  END IF;
  v_fingerprint := encode(extensions.digest(
    concat_ws('|',
      'operator-owner-check:v1', p_workflow, p_kind,
      btrim(coalesce(p_summary, '')), p_steps::text
    ),
    'sha256'
  ), 'hex');
  v_prepared := public.prepare_operator_run_v18(
    p_run_id, p_branch_id, p_workflow, v_fingerprint
  );
  IF coalesce((v_prepared->>'replayed')::boolean, false) THEN
    IF coalesce((v_prepared->>'legacy')::boolean, false) THEN
      v_legacy_steps := coalesce(v_prepared->'steps', '{}'::jsonb);
      v_legacy_result_ref := v_prepared->>'result_ref';
      IF NOT (v_legacy_steps @> p_steps)
         OR coalesce(v_legacy_result_ref, '') !~
           '^owner_alert:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'This operator run was already completed with different answers.'
          USING ERRCODE = '22023';
      END IF;
      v_alert_id := replace(v_legacy_result_ref, 'owner_alert:', '')::uuid;
      IF nullif(v_legacy_steps->>'ownerAlertId', '') IS NOT NULL
         AND v_legacy_steps->>'ownerAlertId' IS DISTINCT FROM v_alert_id::text THEN
        RAISE EXCEPTION 'This operator run was already completed with different answers.'
          USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_legacy_alert
      FROM public.owner_alerts
      WHERE id = v_alert_id
      FOR UPDATE;
      IF v_legacy_alert.id IS NULL
         OR v_legacy_alert.branch_id IS DISTINCT FROM p_branch_id
         OR v_legacy_alert.kind IS DISTINCT FROM p_kind
         OR v_legacy_alert.entity_ref IS DISTINCT FROM p_run_id::text THEN
        RAISE EXCEPTION 'This operator run points to a missing or foreign owner job.'
          USING ERRCODE = '23514';
      END IF;
      PERFORM public.ensure_operator_completion_audit_v18(
        p_run_id, p_branch_id, p_workflow, v_legacy_result_ref
      );
      RETURN jsonb_build_object(
        'outcome', 'owner_check',
        'id', v_alert_id,
        'owner_alert_id', v_alert_id,
        'owner_alert_kind', p_kind,
        'needs_owner', true,
        'replayed', true
      );
    END IF;
    RETURN coalesce(v_prepared->'receipt', '{}'::jsonb)
      || jsonb_build_object('replayed', true);
  END IF;

  v_alert_id := public.ensure_operator_run_alert_v18(
    p_branch_id, p_run_id, p_kind, p_summary, p_steps
  );
  v_receipt := jsonb_build_object(
    'outcome', 'owner_check',
    'id', v_alert_id,
    'owner_alert_id', v_alert_id,
    'owner_alert_kind', p_kind,
    'needs_owner', true
  );
  RETURN public.finalize_operator_run_v18(
    p_run_id,
    p_branch_id,
    p_workflow,
    v_fingerprint,
    p_steps || jsonb_build_object('ownerAlertId', v_alert_id, 'outcome', 'owner_check'),
    'owner_alert:' || v_alert_id::text,
    v_receipt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_operator_owner_check_v18(uuid, uuid, text, text, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_operator_owner_check_v18(uuid, uuid, text, text, text, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_operator_no_waste_v18(
  p_run_id uuid,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fingerprint constant text := encode(extensions.digest('operator-waste:none:v1', 'sha256'), 'hex');
  v_prepared jsonb;
  v_receipt jsonb;
BEGIN
  v_prepared := public.prepare_operator_run_v18(p_run_id, p_branch_id, 'waste', v_fingerprint);
  IF coalesce((v_prepared->>'replayed')::boolean, false) THEN
    IF coalesce((v_prepared->>'legacy')::boolean, false)
       AND (
         coalesce(v_prepared->'steps'->>'waste', '') <> 'none'
         OR coalesce(v_prepared->>'result_ref', '') <> 'no_waste'
       ) THEN
      RAISE EXCEPTION 'This operator run was already completed with different answers.'
        USING ERRCODE = '22023';
    END IF;
    IF coalesce((v_prepared->>'legacy')::boolean, false) THEN
      PERFORM public.ensure_operator_completion_audit_v18(
        p_run_id, p_branch_id, 'waste', 'no_waste'
      );
    END IF;
    RETURN coalesce(v_prepared->'receipt', jsonb_build_object(
      'outcome', 'no_waste', 'id', p_run_id, 'needs_owner', false
    )) || jsonb_build_object('replayed', true);
  END IF;

  v_receipt := jsonb_build_object(
    'outcome', 'no_waste', 'id', p_run_id, 'needs_owner', false
  );
  RETURN public.finalize_operator_run_v18(
    p_run_id,
    p_branch_id,
    'waste',
    v_fingerprint,
    jsonb_build_object('waste', 'none'),
    'no_waste',
    v_receipt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_operator_no_waste_v18(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_operator_no_waste_v18(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_operator_waste_v18(
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
DECLARE
  v_actor uuid := auth.uid();
  v_fingerprint text;
  v_prepared jsonb;
  v_product public.products%ROWTYPE;
  v_batch public.inventory_batches%ROWTYPE;
  v_waste_id uuid;
  v_alert_id uuid;
  v_kind text;
  v_summary text;
  v_steps jsonb;
  v_receipt jsonb;
  v_result_ref text;
  v_target_id uuid;
  v_event public.inventory_waste_events%ROWTYPE;
  v_evidence public.operator_evidence%ROWTYPE;
  v_legacy_alert public.owner_alerts%ROWTYPE;
  v_cutover_steps jsonb;
  v_cutover boolean := false;
  v_recovered boolean := false;
  v_audit_count integer;
BEGIN
  IF p_quantity_kg IS NULL OR p_quantity_kg <= 0 OR scale(p_quantity_kg) > 3 THEN
    RAISE EXCEPTION 'Waste quantity must be positive with at most three decimal places.'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_steps, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Waste answers are invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN (
    'expired', 'damaged', 'trim_loss', 'customer_issue', 'contaminated',
    'customer_return', 'other', 'review'
  ) THEN
    RAISE EXCEPTION 'Waste reason is invalid.' USING ERRCODE = '22023';
  END IF;
  IF nullif(p_steps->>'productId', '') IS DISTINCT FROM p_product_id::text
     OR nullif(p_steps->>'quantity', '')::numeric IS DISTINCT FROM p_quantity_kg
     OR nullif(p_steps->>'reason', '') IS DISTINCT FROM p_reason
     OR nullif(p_steps->>'photoEvidenceId', '') IS DISTINCT FROM p_photo_evidence_id::text THEN
    RAISE EXCEPTION 'Waste answers do not match the completion request.' USING ERRCODE = '22023';
  END IF;

  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'contract', 'operator-waste:v1',
    'product_id', p_product_id,
    'quantity_milli', round(p_quantity_kg * 1000)::bigint,
    'reason', p_reason,
    'photo_evidence_id', p_photo_evidence_id
  )::text, 'sha256'), 'hex');
  v_prepared := public.prepare_operator_run_v18(p_run_id, p_branch_id, 'waste', v_fingerprint);
  IF coalesce((v_prepared->>'replayed')::boolean, false) THEN
    IF coalesce((v_prepared->>'legacy')::boolean, false) THEN
      v_steps := coalesce(v_prepared->'steps', '{}'::jsonb);
      v_result_ref := v_prepared->>'result_ref';
      IF nullif(v_steps->>'productId', '') IS DISTINCT FROM p_product_id::text
         OR nullif(v_steps->>'quantity', '')::numeric IS DISTINCT FROM p_quantity_kg
         OR nullif(v_steps->>'reason', '') IS DISTINCT FROM p_reason
         OR nullif(v_steps->>'photoEvidenceId', '') IS DISTINCT FROM p_photo_evidence_id::text
         OR coalesce(v_result_ref, '') !~
           '^(waste|owner_alert):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'This operator run was already completed with different answers.'
          USING ERRCODE = '22023';
      END IF;
      IF v_result_ref LIKE 'owner_alert:%' THEN
        v_target_id := replace(v_result_ref, 'owner_alert:', '')::uuid;
        IF nullif(v_steps->>'ownerAlertId', '') IS NOT NULL
           AND v_steps->>'ownerAlertId' IS DISTINCT FROM v_target_id::text THEN
          RAISE EXCEPTION 'This operator run was already completed with different answers.'
            USING ERRCODE = '22023';
        END IF;
        SELECT * INTO v_legacy_alert
        FROM public.owner_alerts
        WHERE id = v_target_id
        FOR UPDATE;
        IF v_legacy_alert.id IS NULL
           OR v_legacy_alert.branch_id IS DISTINCT FROM p_branch_id
           OR v_legacy_alert.entity_ref IS DISTINCT FROM p_run_id::text
           OR v_legacy_alert.kind IS NULL
           OR NOT (v_legacy_alert.kind = ANY(ARRAY[
             'operator_waste_unknown_product', 'operator_waste_needs_owner',
             'operator_waste_no_matching_stock', 'operator_waste_reason_check',
             'operator_waste_recovery_needed'
           ]::text[])) THEN
          RAISE EXCEPTION 'This operator run points to a missing or foreign owner job.'
            USING ERRCODE = '23514';
        END IF;
        PERFORM public.ensure_operator_completion_audit_v18(
          p_run_id, p_branch_id, 'waste', v_result_ref
        );
        RETURN jsonb_build_object(
          'outcome', 'owner_check',
          'id', v_target_id,
          'owner_alert_id', v_target_id,
          'owner_alert_kind', v_legacy_alert.kind,
          'needs_owner', true,
          'replayed', true
        );
      END IF;

      v_target_id := replace(v_result_ref, 'waste:', '')::uuid;
      IF p_product_id IS NULL
         OR v_steps->>'wasteId' IS DISTINCT FROM v_target_id::text
         OR coalesce(v_steps->>'batchId', '') !~
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'This operator run was already completed with different answers.'
          USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_event
      FROM public.inventory_waste_events
      WHERE id = v_target_id
      FOR UPDATE;
      IF v_event.id IS NOT NULL THEN
        SELECT * INTO v_batch
        FROM public.inventory_batches
        WHERE id = v_event.batch_id
        FOR UPDATE;
      END IF;
      IF v_event.id IS NULL
         OR v_batch.id IS NULL
         OR v_event.batch_id::text IS DISTINCT FROM v_steps->>'batchId'
         OR v_batch.branch_id IS DISTINCT FROM p_branch_id
         OR v_batch.product_id IS DISTINCT FROM p_product_id
         OR v_event.product_id IS DISTINCT FROM p_product_id
         OR v_event.created_by IS DISTINCT FROM v_actor
         OR v_event.waste_kg IS DISTINCT FROM p_quantity_kg
         OR v_event.reason IS DISTINCT FROM p_reason
         OR NOT EXISTS (
           SELECT 1 FROM public.inventory_movements m
           WHERE m.reference_id = v_event.id
             AND m.batch_id = v_event.batch_id
             AND m.source_event = 'WASTE_RECORDED'
             AND m.delta_kg = -p_quantity_kg
         ) THEN
        RAISE EXCEPTION 'This operator run points to missing, foreign, or corrupt waste.'
          USING ERRCODE = '23514';
      END IF;
      IF p_reason = 'review' THEN
        v_alert_id := public.ensure_operator_run_alert_v18(
          p_branch_id, p_run_id, 'operator_waste_reason_check',
          coalesce(v_steps->>'productName', 'Waste') || ' waste was saved. Owner should check the reason.',
          v_steps
        );
      END IF;
      PERFORM public.ensure_operator_completion_audit_v18(
        p_run_id, p_branch_id, 'waste', v_result_ref
      );
      RETURN jsonb_build_object(
        'outcome', 'waste',
        'id', v_target_id,
        'waste_id', v_target_id,
        'batch_id', v_batch.id,
        'product_name', v_steps->>'productName',
        'owner_alert_id', v_alert_id,
        'needs_owner', p_reason = 'review',
        'replayed', true
      );
    END IF;
    RETURN coalesce(v_prepared->'receipt', '{}'::jsonb)
      || jsonb_build_object('replayed', true);
  END IF;

  v_cutover_steps := coalesce(v_prepared->'steps', '{}'::jsonb);
  v_cutover := v_cutover_steps->>'_completionCutover' = 'pre_202607142300';
  IF v_cutover THEN
    -- Old waste had no operation key. Recover only when the pre-cutover saved
    -- answers, exact evidence link, inventory event/movement and both audit
    -- edges all agree. Anything less is ambiguous and must not reduce stock a
    -- second time.
    IF nullif(v_cutover_steps->>'productId', '') IS NOT DISTINCT FROM p_product_id::text
       AND nullif(v_cutover_steps->>'quantity', '')::numeric IS NOT DISTINCT FROM p_quantity_kg
       AND nullif(v_cutover_steps->>'reason', '') IS NOT DISTINCT FROM p_reason
       AND nullif(v_cutover_steps->>'photoEvidenceId', '') IS NOT DISTINCT FROM p_photo_evidence_id::text
       AND p_photo_evidence_id IS NOT NULL THEN
      SELECT * INTO v_evidence
      FROM public.operator_evidence
      WHERE id = p_photo_evidence_id
      FOR UPDATE;
      IF v_evidence.id IS NOT NULL
         AND v_evidence.branch_id IS NOT DISTINCT FROM p_branch_id
         AND v_evidence.uploaded_by IS NOT DISTINCT FROM v_actor
         AND v_evidence.evidence_type IS NOT DISTINCT FROM 'waste_photo'
         AND v_evidence.source_type IS NOT DISTINCT FROM 'waste_event'
         AND v_evidence.source_id IS NOT NULL
         AND v_evidence.status IN ('linked', 'needs_owner_review')
         AND v_evidence.review_required IS NOT DISTINCT FROM (p_reason = 'review')
         AND nullif(btrim(coalesce(v_evidence.object_path, '')), '') IS NOT NULL THEN
        SELECT * INTO v_event
        FROM public.inventory_waste_events
        WHERE id = v_evidence.source_id
        FOR UPDATE;
        IF v_event.id IS NOT NULL THEN
          SELECT * INTO v_batch
          FROM public.inventory_batches
          WHERE id = v_event.batch_id
          FOR UPDATE;
        END IF;
        SELECT count(*) INTO v_audit_count
        FROM public.audit_logs a
        WHERE a.event_type = 'evidence_linked'
          AND a.target_type = 'operator_evidence'
          AND a.target_id = p_photo_evidence_id
          AND a.branch_id IS NOT DISTINCT FROM p_branch_id
          AND a.metadata->>'source_type' = 'waste_event'
          AND a.metadata->>'source_id' = v_event.id::text;
        v_recovered := v_event.id IS NOT NULL
          AND v_batch.id IS NOT NULL
          AND v_batch.branch_id IS NOT DISTINCT FROM p_branch_id
          AND v_batch.product_id IS NOT DISTINCT FROM p_product_id
          AND v_event.product_id IS NOT DISTINCT FROM p_product_id
          AND v_event.created_by IS NOT DISTINCT FROM v_actor
          AND v_event.waste_kg IS NOT DISTINCT FROM p_quantity_kg
          AND v_event.reason IS NOT DISTINCT FROM p_reason
          AND v_audit_count = 1
          AND EXISTS (
            SELECT 1 FROM public.inventory_movements m
            WHERE m.reference_id = v_event.id
              AND m.batch_id = v_event.batch_id
              AND m.source_event = 'WASTE_RECORDED'
              AND m.delta_kg = -p_quantity_kg
          )
          AND 1 = (
            SELECT count(*) FROM public.audit_logs a
            WHERE a.event_type = 'waste_recorded'
              AND a.target_type = 'inventory_batch'
              AND a.target_id = v_event.batch_id
              AND a.branch_id IS NOT DISTINCT FROM p_branch_id
              AND a.actor_id IS NOT DISTINCT FROM v_actor
              AND a.metadata->>'waste_event_id' = v_event.id::text
              AND (a.metadata->>'quantity_kg')::numeric = p_quantity_kg
              AND a.metadata->>'reason' = p_reason
          );
      END IF;
    END IF;

    IF NOT v_recovered THEN
      v_alert_id := public.ensure_operator_run_alert_v18(
        p_branch_id, p_run_id, 'operator_waste_recovery_needed',
        'A waste entry crossed the completion upgrade. Owner must reconcile it before any more stock is changed.',
        p_steps || jsonb_build_object('cutoverReview', true)
      );
      v_steps := p_steps || jsonb_build_object(
        'outcome', 'owner_check', 'ownerAlertId', v_alert_id,
        'cutoverReview', true
      );
      v_result_ref := 'owner_alert:' || v_alert_id::text;
      v_receipt := jsonb_build_object(
        'outcome', 'owner_check', 'id', v_alert_id,
        'owner_alert_id', v_alert_id,
        'owner_alert_kind', 'operator_waste_recovery_needed',
        'needs_owner', true
      );
      RETURN public.finalize_operator_run_v18(
        p_run_id, p_branch_id, 'waste', v_fingerprint,
        v_steps, v_result_ref, v_receipt
      );
    END IF;

    v_waste_id := v_event.id;
    SELECT * INTO v_product
    FROM public.products
    WHERE id = p_product_id AND branch_id = p_branch_id;
    IF p_reason = 'review' THEN
      v_alert_id := public.ensure_operator_run_alert_v18(
        p_branch_id, p_run_id, 'operator_waste_reason_check',
        coalesce(v_product.name, 'Waste') || ' waste was saved. Owner should check the reason.',
        p_steps || jsonb_build_object('batchId', v_batch.id, 'wasteId', v_waste_id)
      );
    END IF;
    v_steps := p_steps || jsonb_build_object(
      'productName', v_product.name, 'batchId', v_batch.id,
      'wasteId', v_waste_id, 'ownerAlertId', v_alert_id,
      'needsOwner', v_alert_id IS NOT NULL, 'cutoverRecovered', true
    );
    v_result_ref := 'waste:' || v_waste_id::text;
    v_receipt := jsonb_build_object(
      'outcome', 'waste', 'id', v_waste_id, 'waste_id', v_waste_id,
      'batch_id', v_batch.id, 'product_name', v_product.name,
      'owner_alert_id', v_alert_id, 'needs_owner', v_alert_id IS NOT NULL
    );
    RETURN public.finalize_operator_run_v18(
      p_run_id, p_branch_id, 'waste', v_fingerprint,
      v_steps, v_result_ref, v_receipt
    );
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id AND branch_id = p_branch_id;

  IF v_product.id IS NULL THEN
    v_kind := 'operator_waste_unknown_product';
    v_summary := 'Waste was recorded, but the product was not clear.';
  ELSIF v_product.inventory_policy <> 'kg_batch' THEN
    v_kind := 'operator_waste_needs_owner';
    v_summary := v_product.name || ' waste needs the owner to check it.';
  ELSE
    SELECT * INTO v_batch
    FROM public.inventory_batches
    WHERE branch_id = p_branch_id
      AND product_id = v_product.id
      AND status = 'active'
      AND remaining_weight_kg >= p_quantity_kg
    ORDER BY expiry_date, received_date, id
    LIMIT 1
    FOR UPDATE;

    IF v_batch.id IS NULL THEN
      v_kind := 'operator_waste_no_matching_stock';
      v_summary := v_product.name || ' waste was noted, but matching stock was not found.';
    END IF;
  END IF;

  IF v_kind IS NOT NULL THEN
    v_alert_id := public.ensure_operator_run_alert_v18(
      p_branch_id, p_run_id, v_kind, v_summary,
      p_steps || jsonb_build_object('productName', v_product.name)
    );
    v_steps := p_steps || jsonb_build_object(
      'productName', v_product.name,
      'outcome', 'owner_check',
      'ownerAlertId', v_alert_id
    );
    v_result_ref := 'owner_alert:' || v_alert_id::text;
    v_receipt := jsonb_build_object(
      'outcome', 'owner_check',
      'id', v_alert_id,
      'owner_alert_id', v_alert_id,
      'owner_alert_kind', v_kind,
      'needs_owner', true
    );
  ELSE
    v_waste_id := public.admin_record_inventory_waste(v_batch.id, p_quantity_kg, p_reason);
    IF btrim(coalesce(p_reason, '')) = 'review' THEN
      v_alert_id := public.ensure_operator_run_alert_v18(
        p_branch_id,
        p_run_id,
        'operator_waste_reason_check',
        v_product.name || ' waste was saved. Owner should check the reason.',
        p_steps || jsonb_build_object('batchId', v_batch.id, 'wasteId', v_waste_id)
      );
    END IF;
    v_steps := p_steps || jsonb_build_object(
      'productName', v_product.name,
      'batchId', v_batch.id,
      'wasteId', v_waste_id,
      'ownerAlertId', v_alert_id,
      'needsOwner', v_alert_id IS NOT NULL
    );
    v_result_ref := 'waste:' || v_waste_id::text;
    v_receipt := jsonb_build_object(
      'outcome', 'waste',
      'id', v_waste_id,
      'waste_id', v_waste_id,
      'batch_id', v_batch.id,
      'product_name', v_product.name,
      'owner_alert_id', v_alert_id,
      'needs_owner', v_alert_id IS NOT NULL
    );
  END IF;

  RETURN public.finalize_operator_run_v18(
    p_run_id, p_branch_id, 'waste', v_fingerprint,
    v_steps, v_result_ref, v_receipt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_operator_waste_v18(uuid, uuid, uuid, numeric, text, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_operator_waste_v18(uuid, uuid, uuid, numeric, text, uuid, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_operator_delivery_v18(
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
DECLARE
  v_actor uuid := auth.uid();
  v_fingerprint text;
  v_prepared jsonb;
  v_product public.products%ROWTYPE;
  v_supplier public.suppliers%ROWTYPE;
  v_received_date date;
  v_expiry_date date;
  v_storage_location text;
  v_needs_owner boolean;
  v_note_evidence_id uuid;
  v_batch_id uuid;
  v_alert_id uuid;
  v_cost_alert jsonb;
  v_cost_alert_id uuid;
  v_kind text;
  v_summary text;
  v_note text;
  v_steps jsonb;
  v_receipt jsonb;
  v_result_ref text;
  v_batch public.inventory_batches%ROWTYPE;
  v_evidence public.operator_evidence%ROWTYPE;
  v_legacy_alert public.owner_alerts%ROWTYPE;
  v_target_id uuid;
  v_cutover boolean := false;
  v_adopted_legacy_batch boolean := false;
  v_details_uncertain boolean := false;
  v_legacy_batch_count integer := 0;
BEGIN
  IF p_quantity_kg IS NULL OR p_quantity_kg <= 0 OR scale(p_quantity_kg) > 3 THEN
    RAISE EXCEPTION 'Delivery quantity must be positive with at most three decimal places.'
      USING ERRCODE = '22023';
  END IF;
  IF p_expiry_choice IS NULL
     OR p_expiry_choice NOT IN ('today', 'tomorrow', 'two_days', 'not_sure')
     OR p_storage_choice IS NULL
     OR p_storage_choice NOT IN ('fridge', 'freezer', 'counter', 'back_store', 'not_sure')
     OR jsonb_typeof(coalesce(p_steps, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Delivery answers are invalid.' USING ERRCODE = '22023';
  END IF;
  IF nullif(p_steps->>'productId', '') IS DISTINCT FROM p_product_id::text
     OR nullif(p_steps->>'supplierId', '') IS DISTINCT FROM p_supplier_id::text
     OR nullif(p_steps->>'quantity', '')::numeric IS DISTINCT FROM p_quantity_kg
     OR nullif(p_steps->>'expiryChoice', '') IS DISTINCT FROM p_expiry_choice
     OR nullif(p_steps->>'storageChoice', '') IS DISTINCT FROM p_storage_choice
     OR nullif(p_steps->>'noteEvidenceId', '') IS DISTINCT FROM p_note_evidence_id::text THEN
    RAISE EXCEPTION 'Delivery answers do not match the completion request.' USING ERRCODE = '22023';
  END IF;

  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'contract', 'operator-delivery:v1',
    'product_id', p_product_id,
    'supplier_id', p_supplier_id,
    'quantity_milli', round(p_quantity_kg * 1000)::bigint,
    'expiry_choice', p_expiry_choice,
    'storage_choice', p_storage_choice,
    'note_evidence_id', p_note_evidence_id
  )::text, 'sha256'), 'hex');
  v_prepared := public.prepare_operator_run_v18(p_run_id, p_branch_id, 'delivery', v_fingerprint);
  IF coalesce((v_prepared->>'replayed')::boolean, false) THEN
    IF coalesce((v_prepared->>'legacy')::boolean, false) THEN
      v_steps := coalesce(v_prepared->'steps', '{}'::jsonb);
      v_result_ref := v_prepared->>'result_ref';
      IF nullif(v_steps->>'productId', '') IS DISTINCT FROM p_product_id::text
         OR nullif(v_steps->>'supplierId', '') IS DISTINCT FROM p_supplier_id::text
         OR nullif(v_steps->>'quantity', '')::numeric IS DISTINCT FROM p_quantity_kg
         OR nullif(v_steps->>'expiryChoice', '') IS DISTINCT FROM p_expiry_choice
         OR nullif(v_steps->>'storageChoice', '') IS DISTINCT FROM p_storage_choice
         OR nullif(v_steps->>'noteEvidenceId', '') IS DISTINCT FROM p_note_evidence_id::text
         OR coalesce(v_result_ref, '') !~
           '^(inventory_batch|owner_alert):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'This operator run was already completed with different answers.'
          USING ERRCODE = '22023';
      END IF;
      IF v_result_ref LIKE 'owner_alert:%' THEN
        v_target_id := replace(v_result_ref, 'owner_alert:', '')::uuid;
        IF nullif(v_steps->>'ownerAlertId', '') IS NOT NULL
           AND v_steps->>'ownerAlertId' IS DISTINCT FROM v_target_id::text THEN
          RAISE EXCEPTION 'This operator run was already completed with different answers.'
            USING ERRCODE = '22023';
        END IF;
        SELECT * INTO v_legacy_alert
        FROM public.owner_alerts
        WHERE id = v_target_id
        FOR UPDATE;
        IF v_legacy_alert.id IS NULL
           OR v_legacy_alert.branch_id IS DISTINCT FROM p_branch_id
           OR v_legacy_alert.entity_ref IS DISTINCT FROM p_run_id::text
           OR v_legacy_alert.kind IS NULL
           OR NOT (v_legacy_alert.kind = ANY(ARRAY[
             'operator_delivery_unknown_product', 'operator_delivery_needs_owner',
             'operator_delivery_unknown_supplier', 'operator_delivery_check_needed'
           ]::text[])) THEN
          RAISE EXCEPTION 'This operator run points to a missing or foreign owner job.'
            USING ERRCODE = '23514';
        END IF;
        PERFORM public.ensure_operator_completion_audit_v18(
          p_run_id, p_branch_id, 'delivery', v_result_ref
        );
        RETURN jsonb_build_object(
          'outcome', 'owner_check',
          'id', v_target_id,
          'owner_alert_id', v_target_id,
          'owner_alert_kind', v_legacy_alert.kind,
          'needs_owner', true,
          'replayed', true
        );
      END IF;

      v_target_id := replace(v_result_ref, 'inventory_batch:', '')::uuid;
      IF p_product_id IS NULL OR p_supplier_id IS NULL
         OR v_steps->>'batchId' IS DISTINCT FROM v_target_id::text THEN
        RAISE EXCEPTION 'This operator run was already completed with different answers.'
          USING ERRCODE = '22023';
      END IF;
      SELECT * INTO v_batch
      FROM public.inventory_batches
      WHERE id = v_target_id
      FOR UPDATE;
      SELECT count(*) INTO v_legacy_batch_count
      FROM public.inventory_batches
      WHERE intake_idempotency_key LIKE 'operator-delivery:' || p_run_id::text || ':%';
      IF v_batch.id IS NULL
         OR v_legacy_batch_count <> 1
         OR v_batch.branch_id IS DISTINCT FROM p_branch_id
         OR v_batch.product_id IS DISTINCT FROM p_product_id
         OR v_batch.supplier_id IS DISTINCT FROM p_supplier_id
         OR v_batch.created_by IS DISTINCT FROM v_actor
         OR v_batch.received_weight_kg IS DISTINCT FROM p_quantity_kg
         OR v_batch.invoice_cost IS NULL
         OR v_batch.invoice_cost < 0
         OR v_batch.expiry_date IS DISTINCT FROM (
           v_batch.received_date + CASE p_expiry_choice
             WHEN 'tomorrow' THEN 1 WHEN 'two_days' THEN 2 ELSE 0 END
         )
         OR v_batch.storage_location IS DISTINCT FROM (CASE p_storage_choice
           WHEN 'fridge' THEN 'Fridge' WHEN 'freezer' THEN 'Freezer'
           WHEN 'counter' THEN 'Counter' WHEN 'back_store' THEN 'Back store'
           ELSE NULL END)
         OR coalesce(v_batch.intake_idempotency_key, '') !~
           ('^operator-delivery:' || p_run_id::text ||
            ':[0-9a-f-]{36}:[0-9]+([.][0-9]+)?:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
         OR split_part(v_batch.intake_idempotency_key, ':', 3) IS DISTINCT FROM p_product_id::text
         OR split_part(v_batch.intake_idempotency_key, ':', 4)::numeric IS DISTINCT FROM p_quantity_kg
         OR split_part(v_batch.intake_idempotency_key, ':', 5)::date IS DISTINCT FROM v_batch.expiry_date THEN
        RAISE EXCEPTION 'This operator run points to a missing, foreign, or corrupt delivery.'
          USING ERRCODE = '23514';
      END IF;

      v_details_uncertain := p_expiry_choice = 'not_sure' OR p_storage_choice = 'not_sure';
      IF p_note_evidence_id IS NOT NULL THEN
        SELECT * INTO v_evidence
        FROM public.operator_evidence
        WHERE id = p_note_evidence_id
        FOR UPDATE;
      END IF;
      v_needs_owner := v_details_uncertain
        OR v_evidence.id IS NULL
        OR v_evidence.branch_id IS DISTINCT FROM p_branch_id
        OR v_evidence.uploaded_by IS DISTINCT FROM v_actor
        OR v_evidence.evidence_type IS DISTINCT FROM 'delivery_note'
        OR v_evidence.source_type IS DISTINCT FROM 'inventory_batch'
        OR v_evidence.source_id IS DISTINCT FROM v_target_id
        OR v_evidence.status IS DISTINCT FROM (CASE WHEN v_details_uncertain
          THEN 'needs_owner_review' ELSE 'linked' END)
        OR nullif(btrim(coalesce(v_evidence.object_path, '')), '') IS NULL;
      IF v_needs_owner THEN
        v_alert_id := public.ensure_operator_run_alert_v18(
          p_branch_id, p_run_id, 'operator_delivery_check_needed',
          coalesce(v_steps->>'productName', 'Delivery') || ' was added. Owner should check the details.',
          v_steps
        );
      END IF;
      IF v_batch.invoice_cost = 0 THEN
        v_cost_alert := public.ensure_delivery_cost_owner_alert_v18(
          p_branch_id,
          coalesce(v_steps->>'productName', 'Delivery') || ' was added with no cost - add the invoice cost.',
          v_target_id::text || ':cost',
          v_actor
        );
        v_cost_alert_id := (v_cost_alert->>'id')::uuid;
        IF v_cost_alert_id IS NULL THEN
          RAISE EXCEPTION 'Delivery cost owner job could not be recorded.' USING ERRCODE = '23514';
        END IF;
        IF coalesce((v_cost_alert->>'created')::boolean, false) THEN
          PERFORM public.emit_audit_log(
            'inventory_reconciliation_issue', 'owner_alert', v_cost_alert_id, p_branch_id,
            jsonb_build_object('kind', 'operator_delivery_cost_pending', 'run_id', p_run_id,
              'batch_id', v_target_id, 'product_id', p_product_id, 'quantity_kg', p_quantity_kg)
          );
        END IF;
      END IF;
      PERFORM public.ensure_operator_completion_audit_v18(
        p_run_id, p_branch_id, 'delivery', v_result_ref
      );
      RETURN jsonb_build_object(
        'outcome', 'delivery',
        'id', v_target_id,
        'batch_id', v_target_id,
        'product_name', v_steps->>'productName',
        'supplier_name', v_steps->>'supplierName',
        'owner_alert_id', v_alert_id,
        'cost_alert_id', v_cost_alert_id,
        'needs_owner', v_needs_owner,
        'evidence_review_required', v_details_uncertain,
        'replayed', true
      );
    END IF;
    RETURN coalesce(v_prepared->'receipt', '{}'::jsonb)
      || jsonb_build_object('replayed', true);
  END IF;

  v_cutover := coalesce(v_prepared->'steps'->>'_completionCutover', '')
    = 'pre_202607142300';

  -- A UUID supplied by the browser is not evidence. Accept delivery-note
  -- provenance only when the durable database row belongs to this branch,
  -- run and operator; object_path is provenance, not proof of object storage.
  -- The row lock prevents it being deleted or retargeted while the delivery
  -- transaction decides whether an owner details-check job is mandatory.
  IF p_note_evidence_id IS NOT NULL THEN
    SELECT id INTO v_note_evidence_id
    FROM public.operator_evidence
    WHERE id = p_note_evidence_id
      AND branch_id = p_branch_id
      AND uploaded_by = v_actor
      AND evidence_type = 'delivery_note'
      AND source_type = 'operator_workflow_run'
      AND source_id = p_run_id
      AND status IN ('uploaded', 'needs_owner_review')
      AND nullif(btrim(coalesce(object_path, '')), '') IS NOT NULL
    FOR UPDATE;
  END IF;
  v_steps := p_steps || jsonb_build_object('noteEvidenceId', v_note_evidence_id);

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id AND branch_id = p_branch_id;

  IF v_product.id IS NULL THEN
    v_kind := 'operator_delivery_unknown_product';
    v_summary := 'Delivery arrived, but the product was not clear.';
  ELSIF v_product.inventory_policy <> 'kg_batch' THEN
    v_kind := 'operator_delivery_needs_owner';
    v_summary := v_product.name || ' arrived and needs the owner to add it.';
  ELSE
    SELECT * INTO v_supplier
    FROM public.suppliers
    WHERE id = p_supplier_id AND branch_id = p_branch_id AND active = true;
    IF v_supplier.id IS NULL THEN
      v_kind := 'operator_delivery_unknown_supplier';
      v_summary := v_product.name || ' arrived, but the supplier was not clear.';
    END IF;
  END IF;

  IF v_kind IS NOT NULL THEN
    v_alert_id := public.ensure_operator_run_alert_v18(
      p_branch_id, p_run_id, v_kind, v_summary,
      v_steps || jsonb_build_object('productName', v_product.name)
    );
    v_steps := v_steps || jsonb_build_object(
      'productName', v_product.name,
      'outcome', 'owner_check',
      'ownerAlertId', v_alert_id
    );
    v_result_ref := 'owner_alert:' || v_alert_id::text;
    v_receipt := jsonb_build_object(
      'outcome', 'owner_check',
      'id', v_alert_id,
      'owner_alert_id', v_alert_id,
      'owner_alert_kind', v_kind,
      'needs_owner', true
    );
  ELSE
    v_received_date := public.branch_business_date(p_branch_id, now());
    v_expiry_date := v_received_date + CASE p_expiry_choice
      WHEN 'tomorrow' THEN 1
      WHEN 'two_days' THEN 2
      ELSE 0
    END;
    v_storage_location := CASE p_storage_choice
      WHEN 'fridge' THEN 'Fridge'
      WHEN 'freezer' THEN 'Freezer'
      WHEN 'counter' THEN 'Counter'
      WHEN 'back_store' THEN 'Back store'
      ELSE NULL
    END;
    v_details_uncertain := p_expiry_choice = 'not_sure'
      OR p_storage_choice = 'not_sure';
    -- Completion precedes evidence retargeting. Keep the details job open until
    -- link_operator_evidence_v18 validates and commits that exact graph edge.
    v_needs_owner := true;
    v_note := concat_ws(' ',
      CASE WHEN v_details_uncertain OR v_note_evidence_id IS NULL THEN
        'Operator delivery needs owner check. Location: ' || coalesce(v_storage_location, 'Not sure') ||
        '. Note photo: ' || CASE WHEN v_note_evidence_id IS NULL THEN 'no.' ELSE 'yes.' END
      END,
      'Cost pending: operator delivery - owner to add the invoice cost.'
    );

    IF v_cutover THEN
      SELECT count(*) INTO v_legacy_batch_count
      FROM public.inventory_batches
      WHERE intake_idempotency_key LIKE 'operator-delivery:' || p_run_id::text || ':%';
      IF v_legacy_batch_count > 1 THEN
        RAISE EXCEPTION 'Multiple pre-upgrade delivery facts conflict with this run.'
          USING ERRCODE = '23514';
      END IF;
      SELECT * INTO v_batch
      FROM public.inventory_batches
      WHERE intake_idempotency_key LIKE 'operator-delivery:' || p_run_id::text || ':%'
      FOR UPDATE;
      IF v_batch.id IS NOT NULL THEN
        IF v_batch.branch_id IS DISTINCT FROM p_branch_id
           OR v_batch.product_id IS DISTINCT FROM p_product_id
           OR v_batch.supplier_id IS DISTINCT FROM p_supplier_id
           OR v_batch.created_by IS DISTINCT FROM v_actor
           OR v_batch.received_weight_kg IS DISTINCT FROM p_quantity_kg
           OR v_batch.invoice_cost IS NULL
           OR v_batch.invoice_cost < 0
           OR v_batch.expiry_date IS DISTINCT FROM (
             v_batch.received_date + CASE p_expiry_choice
               WHEN 'tomorrow' THEN 1 WHEN 'two_days' THEN 2 ELSE 0 END
           )
           OR v_batch.storage_location IS DISTINCT FROM v_storage_location
           OR coalesce(v_batch.intake_idempotency_key, '') !~
             ('^operator-delivery:' || p_run_id::text ||
              ':[0-9a-f-]{36}:[0-9]+([.][0-9]+)?:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
           OR split_part(v_batch.intake_idempotency_key, ':', 3) IS DISTINCT FROM p_product_id::text
           OR split_part(v_batch.intake_idempotency_key, ':', 4)::numeric IS DISTINCT FROM p_quantity_kg
           OR split_part(v_batch.intake_idempotency_key, ':', 5)::date IS DISTINCT FROM v_batch.expiry_date THEN
          RAISE EXCEPTION 'A pre-upgrade delivery fact conflicts with this run.'
            USING ERRCODE = '23514';
        END IF;
        v_batch_id := v_batch.id;
        v_adopted_legacy_batch := true;

        -- The old action may already have linked the note before it crashed.
        IF p_note_evidence_id IS NOT NULL THEN
          SELECT * INTO v_evidence
          FROM public.operator_evidence
          WHERE id = p_note_evidence_id
          FOR UPDATE;
          IF v_evidence.id IS NOT NULL
             AND v_evidence.branch_id IS NOT DISTINCT FROM p_branch_id
             AND v_evidence.uploaded_by IS NOT DISTINCT FROM v_actor
             AND v_evidence.evidence_type IS NOT DISTINCT FROM 'delivery_note'
             AND v_evidence.source_type IS NOT DISTINCT FROM 'inventory_batch'
             AND v_evidence.source_id IS NOT DISTINCT FROM v_batch_id
             AND v_evidence.status IN ('linked', 'needs_owner_review')
             AND nullif(btrim(coalesce(v_evidence.object_path, '')), '') IS NOT NULL THEN
            v_note_evidence_id := p_note_evidence_id;
          END IF;
        END IF;
      END IF;
    END IF;

    IF NOT v_adopted_legacy_batch THEN
      v_batch_id := public.admin_create_inventory_batch(
        p_branch_id => p_branch_id,
        p_product_id => v_product.id,
        p_supplier_id => v_supplier.id,
        p_received_date => v_received_date,
        p_expiry_date => v_expiry_date,
        p_received_weight_kg => p_quantity_kg,
        p_remaining_weight_kg => p_quantity_kg,
        p_invoice_cost => 0,
        p_storage_location => v_storage_location,
        p_batch_number => 'OP-' || left(p_run_id::text, 8),
        p_intake_idempotency_key => 'operator-delivery:' || p_run_id::text,
        p_expected_weight_kg => p_quantity_kg,
        p_actual_review_note => v_note
      );
    END IF;

    v_steps := p_steps || jsonb_build_object('noteEvidenceId', v_note_evidence_id);
    v_alert_id := public.ensure_operator_run_alert_v18(
      p_branch_id,
      p_run_id,
      'operator_delivery_check_needed',
      v_product.name || ' was added. Owner should check the details.',
      v_steps || jsonb_build_object(
        'productName', v_product.name,
        'supplierName', v_supplier.name,
        'batchId', v_batch_id,
        'waitingForExactEvidenceLink', true
      )
    );

    IF NOT v_adopted_legacy_batch OR v_batch.invoice_cost = 0 THEN
      v_cost_alert := public.ensure_delivery_cost_owner_alert_v18(
        p_branch_id,
        v_product.name || ' was added with no cost - add the invoice cost.',
        v_batch_id::text || ':cost',
        v_actor
      );
      v_cost_alert_id := (v_cost_alert->>'id')::uuid;
      IF v_cost_alert_id IS NULL THEN
        RAISE EXCEPTION 'Delivery cost owner job could not be recorded.' USING ERRCODE = '23514';
      END IF;
      IF coalesce((v_cost_alert->>'created')::boolean, false) THEN
        PERFORM public.emit_audit_log(
          'inventory_reconciliation_issue',
          'owner_alert',
          v_cost_alert_id,
          p_branch_id,
          jsonb_build_object(
            'kind', 'operator_delivery_cost_pending',
            'run_id', p_run_id,
            'batch_id', v_batch_id,
            'product_id', v_product.id,
            'quantity_kg', p_quantity_kg
          )
        );
      END IF;
    END IF;

    v_steps := v_steps || jsonb_build_object(
      'productName', v_product.name,
      'supplierName', v_supplier.name,
      'batchId', v_batch_id,
      'ownerAlertId', v_alert_id,
      'costAlertId', v_cost_alert_id,
      'needsOwner', v_needs_owner,
      'evidenceReviewRequired', v_details_uncertain,
      'adoptedLegacyBatch', v_adopted_legacy_batch
    );
    v_result_ref := 'inventory_batch:' || v_batch_id::text;
    v_receipt := jsonb_build_object(
      'outcome', 'delivery',
      'id', v_batch_id,
      'batch_id', v_batch_id,
      'product_name', v_product.name,
      'supplier_name', v_supplier.name,
      'owner_alert_id', v_alert_id,
      'cost_alert_id', v_cost_alert_id,
      'needs_owner', v_needs_owner,
      'evidence_review_required', v_details_uncertain,
      'adopted_legacy_batch', v_adopted_legacy_batch
    );
  END IF;

  RETURN public.finalize_operator_run_v18(
    p_run_id, p_branch_id, 'delivery', v_fingerprint,
    v_steps, v_result_ref, v_receipt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_operator_delivery_v18(uuid, uuid, uuid, uuid, numeric, text, text, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_operator_delivery_v18(uuid, uuid, uuid, uuid, numeric, text, text, uuid, jsonb)
  TO authenticated, service_role;

-- Linking an already-uploaded photo happens after the delivery/waste fact has
-- committed so a storage outage can never roll back real stock. Make that
-- recovery step itself replay-safe: the row lock and exact-target comparison
-- ensure repeated or concurrent action retries emit one link audit only.
CREATE OR REPLACE FUNCTION public.link_operator_evidence_v18(
  p_evidence_id uuid,
  p_branch_id uuid,
  p_expected_run_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_source_ref text,
  p_review_required boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_evidence public.operator_evidence%ROWTYPE;
  v_run public.operator_workflow_runs%ROWTYPE;
  v_status text := CASE WHEN coalesce(p_review_required, false)
    THEN 'needs_owner_review' ELSE 'linked' END;
  v_source_ref text := nullif(left(btrim(coalesce(p_source_ref, '')), 160), '');
  v_target_in_branch boolean := false;
  v_expected_workflow text;
  v_expected_result_ref text;
  v_expected_evidence_type text;
  v_replayed boolean := false;
  v_audit_count integer;
  v_audit_exact_count integer;
  v_owner_alert_resolved boolean := false;
  v_needs_owner boolean := false;
  v_expected_review_required boolean;
BEGIN
  IF v_actor IS NULL OR NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_evidence_id IS NULL OR p_expected_run_id IS NULL OR p_source_id IS NULL
     OR p_source_type IS NULL
     OR p_source_type NOT IN ('inventory_batch', 'waste_event') THEN
    RAISE EXCEPTION 'Photo link is not valid.' USING ERRCODE = '22023';
  END IF;

  v_expected_workflow := CASE p_source_type
    WHEN 'inventory_batch' THEN 'delivery'
    WHEN 'waste_event' THEN 'waste'
  END;
  v_expected_result_ref := CASE p_source_type
    WHEN 'inventory_batch' THEN 'inventory_batch:' || p_source_id::text
    WHEN 'waste_event' THEN 'waste:' || p_source_id::text
  END;
  v_expected_evidence_type := CASE p_source_type
    WHEN 'inventory_batch' THEN 'delivery_note'
    WHEN 'waste_event' THEN 'waste_photo'
  END;

  SELECT * INTO v_run
  FROM public.operator_workflow_runs
  WHERE id = p_expected_run_id
  FOR UPDATE;
  IF v_run.id IS NULL
     OR v_run.branch_id IS DISTINCT FROM p_branch_id
     OR v_run.operator_id IS DISTINCT FROM v_actor
     OR v_run.status IS DISTINCT FROM 'completed'
     OR v_run.workflow IS DISTINCT FROM v_expected_workflow
     OR v_run.result_ref IS DISTINCT FROM v_expected_result_ref
     OR (CASE p_source_type
       WHEN 'inventory_batch' THEN
         nullif(v_run.steps->>'noteEvidenceId', '') IS DISTINCT FROM p_evidence_id::text
       WHEN 'waste_event' THEN
         nullif(v_run.steps->>'photoEvidenceId', '') IS DISTINCT FROM p_evidence_id::text
       ELSE true
     END) THEN
    RAISE EXCEPTION 'Completed operator run does not authorise this photo target.'
      USING ERRCODE = '42501';
  END IF;

  v_expected_review_required := CASE p_source_type
    WHEN 'inventory_batch' THEN coalesce(
      (v_run.steps->>'evidenceReviewRequired')::boolean,
      v_run.steps->>'expiryChoice' = 'not_sure'
        OR v_run.steps->>'storageChoice' = 'not_sure',
      false
    )
    WHEN 'waste_event' THEN coalesce(v_run.steps->>'reason', '') = 'review'
  END;
  IF coalesce(p_review_required, false) IS DISTINCT FROM v_expected_review_required THEN
    RAISE EXCEPTION 'Photo review state does not match the completed run.' USING ERRCODE = '22023';
  END IF;

  v_target_in_branch := CASE p_source_type
    WHEN 'inventory_batch' THEN EXISTS (
      SELECT 1 FROM public.inventory_batches
      WHERE id = p_source_id AND branch_id = p_branch_id
    )
    WHEN 'waste_event' THEN EXISTS (
      SELECT 1
      FROM public.inventory_waste_events w
      JOIN public.inventory_batches b ON b.id = w.batch_id
      WHERE w.id = p_source_id AND b.branch_id = p_branch_id
    )
    ELSE false
  END;
  IF NOT v_target_in_branch THEN
    RAISE EXCEPTION 'Photo target is not available in this branch.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_evidence
  FROM public.operator_evidence
  WHERE id = p_evidence_id
  FOR UPDATE;

  IF v_evidence.id IS NULL
     OR v_evidence.branch_id IS DISTINCT FROM p_branch_id
     OR v_evidence.uploaded_by IS DISTINCT FROM v_actor
     OR v_evidence.evidence_type IS DISTINCT FROM v_expected_evidence_type
     OR v_evidence.status IN ('deleted', 'failed') THEN
    RAISE EXCEPTION 'Photo link is not available.' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(v_evidence.object_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Photo provenance is incomplete.' USING ERRCODE = '42501';
  END IF;

  v_replayed := v_evidence.source_type IS NOT DISTINCT FROM p_source_type
     AND v_evidence.source_id IS NOT DISTINCT FROM p_source_id
     AND v_evidence.source_ref IS NOT DISTINCT FROM v_source_ref
     AND v_evidence.status IS NOT DISTINCT FROM v_status
     AND v_evidence.review_required IS NOT DISTINCT FROM coalesce(p_review_required, false);

  IF NOT v_replayed THEN
    IF v_evidence.source_type IS DISTINCT FROM 'operator_workflow_run'
       OR v_evidence.source_id IS DISTINCT FROM p_expected_run_id
       OR v_evidence.status IS NULL
       OR v_evidence.status NOT IN ('uploaded', 'needs_owner_review') THEN
      RAISE EXCEPTION 'Photo is already linked or belongs to different work.'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.operator_evidence
    SET source_type = p_source_type,
        source_id = p_source_id,
        source_ref = v_source_ref,
        status = v_status,
        review_required = coalesce(p_review_required, false),
        linked_at = now()
    WHERE id = v_evidence.id;
  END IF;

  SELECT count(*), count(*) FILTER (
    WHERE branch_id IS NOT DISTINCT FROM p_branch_id
      AND (
        nullif(metadata->>'run_id', '') IS NULL
        OR metadata->>'run_id' IS NOT DISTINCT FROM p_expected_run_id::text
      )
  )
  INTO v_audit_count, v_audit_exact_count
  FROM public.audit_logs
  WHERE event_type = 'evidence_linked'
    AND target_type = 'operator_evidence'
    AND target_id = v_evidence.id
    AND metadata->>'source_type' IS NOT DISTINCT FROM p_source_type
    AND metadata->>'source_id' IS NOT DISTINCT FROM p_source_id::text;
  IF v_audit_count > 1 OR (v_audit_count = 1 AND v_audit_exact_count <> 1) THEN
    RAISE EXCEPTION 'Photo link audit evidence is duplicate or conflicting.' USING ERRCODE = '23514';
  END IF;
  IF v_audit_count = 0 THEN
    INSERT INTO public.audit_logs(
      event_type, target_type, target_id, branch_id, actor_id, metadata
    ) VALUES (
      'evidence_linked', 'operator_evidence', v_evidence.id, p_branch_id, v_actor,
      jsonb_build_object(
        'source_type', p_source_type, 'source_id', p_source_id,
        'source_ref', v_source_ref, 'operator_id', v_actor,
        'run_id', p_expected_run_id,
        'repaired_or_linked_by', 'operator_completion_v18'
      )
    );
  END IF;

  IF p_source_type = 'inventory_batch' AND NOT v_expected_review_required THEN
    WITH resolved AS (
      UPDATE public.owner_alerts
      SET resolved_at = now(),
          seen_at = coalesce(seen_at, now()),
          resolution_note = coalesce(
            resolution_note,
            'Exact delivery-note database provenance linked; details check completed automatically.'
          )
      WHERE branch_id = p_branch_id
        AND kind = 'operator_delivery_check_needed'
        AND entity_ref = p_expected_run_id::text
        AND resolved_at IS NULL
      RETURNING id
    ), audited AS (
      INSERT INTO public.audit_logs(
        event_type, target_type, target_id, branch_id, actor_id, metadata
      )
      SELECT 'inventory_reconciliation_issue', 'owner_alert', id,
        p_branch_id, v_actor,
        jsonb_build_object(
          'resolved', true, 'kind', 'operator_delivery_check_needed',
          'run_id', p_expected_run_id, 'evidence_id', p_evidence_id
        )
      FROM resolved
      RETURNING target_id
    )
    SELECT EXISTS(SELECT 1 FROM audited) INTO v_owner_alert_resolved;
  END IF;

  IF p_source_type = 'inventory_batch' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.owner_alerts
      WHERE branch_id = p_branch_id
        AND kind = 'operator_delivery_check_needed'
        AND entity_ref = p_expected_run_id::text
        AND resolved_at IS NULL
    ) INTO v_needs_owner;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.owner_alerts
      WHERE branch_id = p_branch_id
        AND kind = 'operator_waste_reason_check'
        AND entity_ref = p_expected_run_id::text
        AND resolved_at IS NULL
    ) INTO v_needs_owner;
  END IF;

  RETURN jsonb_build_object(
    'id', v_evidence.id,
    'replayed', v_replayed,
    'needs_owner', v_needs_owner,
    'owner_alert_resolved', v_owner_alert_resolved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_operator_evidence_v18(uuid, uuid, uuid, text, uuid, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_operator_evidence_v18(uuid, uuid, uuid, text, uuid, text, boolean)
  TO authenticated, service_role;

-- Certificate capture has one unavoidable external boundary (object storage).
-- Once an uploaded evidence row exists, document creation, evidence linking,
-- owner-job creation and run completion are one replay-safe DB transaction.
CREATE OR REPLACE FUNCTION public.complete_operator_certificate_v18(
  p_run_id uuid,
  p_branch_id uuid,
  p_evidence_id uuid,
  p_paper_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_run public.operator_workflow_runs%ROWTYPE;
  v_evidence public.operator_evidence%ROWTYPE;
  v_document public.compliance_documents%ROWTYPE;
  v_alert_id uuid;
  v_label text;
  v_expected_evidence_type text;
  v_fingerprint text;
  v_receipt jsonb;
  v_rows integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR p_evidence_id IS NULL OR p_paper_kind IS NULL
     OR p_paper_kind NOT IN ('halal', 'supplier', 'fridge', 'other') THEN
    RAISE EXCEPTION 'Paper capture is invalid.' USING ERRCODE = '22023';
  END IF;
  v_label := CASE p_paper_kind
    WHEN 'halal' THEN 'Halal paper'
    WHEN 'supplier' THEN 'Supplier paper'
    WHEN 'fridge' THEN 'Fridge paper'
    ELSE 'Other paper'
  END;
  v_expected_evidence_type := CASE p_paper_kind
    WHEN 'halal' THEN 'certificate'
    WHEN 'supplier' THEN 'supplier_document'
    WHEN 'fridge' THEN 'fridge_check'
    ELSE 'other'
  END;
  v_fingerprint := encode(extensions.digest(
    concat_ws('|', 'operator-certificate:v1', p_paper_kind, p_evidence_id::text),
    'sha256'
  ), 'hex');

  PERFORM pg_advisory_xact_lock(hashtextextended('operator-run:' || p_run_id::text, 0));
  SELECT * INTO v_run
  FROM public.operator_workflow_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    INSERT INTO public.operator_workflow_runs(
      id, branch_id, operator_id, workflow, status, steps, updated_at
    ) VALUES (
      p_run_id, p_branch_id, v_actor, 'certificate', 'in_progress', '{}'::jsonb, now()
    )
    RETURNING * INTO v_run;
  ELSIF v_run.branch_id IS DISTINCT FROM p_branch_id
     OR v_run.operator_id IS DISTINCT FROM v_actor
     OR v_run.workflow IS DISTINCT FROM 'certificate' THEN
    RAISE EXCEPTION 'This paper capture belongs to another workflow.' USING ERRCODE = '42501';
  ELSIF v_run.status = 'abandoned' THEN
    RAISE EXCEPTION 'This paper capture was replaced. Start again.' USING ERRCODE = '55000';
  ELSIF v_run.status = 'completed' THEN
    IF v_run.completion_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This paper capture was already saved with different details.' USING ERRCODE = '22023';
    END IF;
    RETURN coalesce(v_run.completion_receipt, '{}'::jsonb)
      || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO v_evidence
  FROM public.operator_evidence
  WHERE id = p_evidence_id
  FOR UPDATE;
  IF v_evidence.id IS NULL
     OR v_evidence.branch_id IS DISTINCT FROM p_branch_id
     OR v_evidence.uploaded_by IS DISTINCT FROM v_actor
     OR v_evidence.source_type IS DISTINCT FROM 'operator_workflow_run'
     OR v_evidence.source_id IS DISTINCT FROM p_run_id
     OR v_evidence.evidence_type IS DISTINCT FROM v_expected_evidence_type
     OR v_evidence.status IS NULL
     OR v_evidence.status NOT IN ('uploaded', 'needs_owner_review')
     OR nullif(btrim(coalesce(v_evidence.object_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'The paper photo is not available for this run.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_document
  FROM public.compliance_documents
  WHERE branch_id = p_branch_id
    AND document_url = 'operator_evidence:' || p_evidence_id::text
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;
  IF v_document.id IS NULL THEN
    INSERT INTO public.compliance_documents(
      branch_id, document_url, doc_type, status, uploaded_by
    ) VALUES (
      p_branch_id, 'operator_evidence:' || p_evidence_id::text,
      p_paper_kind, 'needs_owner_review', v_actor
    )
    RETURNING * INTO v_document;

    PERFORM public.emit_audit_log(
      'evidence_uploaded', 'compliance_document', v_document.id, p_branch_id,
      jsonb_build_object(
        'paper_kind', p_paper_kind,
        'evidence_id', p_evidence_id,
        'operator_id', v_actor,
        'run_id', p_run_id,
        'paperKind', p_paper_kind,
        'evidenceId', p_evidence_id,
        'operatorId', v_actor,
        'runId', p_run_id
      )
    );
  END IF;

  SELECT id INTO v_alert_id
  FROM public.owner_alerts
  WHERE branch_id = p_branch_id
    AND kind = 'operator_document_review'
    AND entity_ref = v_document.id::text
    AND resolved_at IS NULL
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;
  IF v_alert_id IS NULL THEN
    INSERT INTO public.owner_alerts(
      branch_id, severity, kind, summary, entity_ref, created_by
    ) VALUES (
      p_branch_id, 'warning', 'operator_document_review',
      v_label || ' was saved for owner review.', v_document.id::text, v_actor
    )
    RETURNING id INTO v_alert_id;

    PERFORM public.emit_audit_log(
      'inventory_reconciliation_issue', 'owner_alert', v_alert_id, p_branch_id,
      jsonb_build_object(
        'kind', 'operator_document_review',
        'document_id', v_document.id,
        'evidence_id', p_evidence_id,
        'paper_kind', p_paper_kind,
        'operator_id', v_actor,
        'run_id', p_run_id,
        'documentId', v_document.id,
        'evidenceId', p_evidence_id,
        'paperKind', p_paper_kind,
        'operatorId', v_actor,
        'runId', p_run_id
      )
    );
  END IF;

  v_receipt := jsonb_build_object(
    'outcome', 'certificate',
    'id', v_document.id,
    'document_id', v_document.id,
    'evidence_id', p_evidence_id,
    'owner_alert_id', v_alert_id,
    'needs_owner', true
  );

  -- Complete the run before retargeting evidence. Both changes still share one
  -- transaction, and the exact completed run is therefore the link authority.
  UPDATE public.operator_workflow_runs
  SET status = 'completed',
      steps = jsonb_build_object(
        'paperKind', p_paper_kind,
        'evidenceId', p_evidence_id,
        'documentId', v_document.id,
        'documentSaved', true
      ),
      result_ref = 'compliance_document:' || v_document.id::text,
      completion_fingerprint = v_fingerprint,
      completion_receipt = v_receipt,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_run_id
    AND branch_id = p_branch_id
    AND operator_id = v_actor
    AND workflow = 'certificate'
    AND status = 'in_progress';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Paper capture changed before completion.' USING ERRCODE = '40001';
  END IF;

  UPDATE public.operator_evidence
  SET source_type = 'compliance_document',
      source_id = v_document.id,
      source_ref = v_label,
      status = 'needs_owner_review',
      review_required = true,
      linked_at = now()
  WHERE id = p_evidence_id
    AND branch_id = p_branch_id
    AND uploaded_by = v_actor
    AND source_type = 'operator_workflow_run'
    AND source_id = p_run_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Paper photo link changed before completion.' USING ERRCODE = '40001';
  END IF;

  PERFORM public.emit_audit_log(
    'evidence_linked', 'operator_evidence', p_evidence_id, p_branch_id,
    jsonb_build_object(
      'source_type', 'compliance_document',
      'source_id', v_document.id,
      'source_ref', v_label,
      'operator_id', v_actor,
      'run_id', p_run_id
    )
  );
  PERFORM public.ensure_operator_completion_audit_v18(
    p_run_id, p_branch_id, 'certificate',
    'compliance_document:' || v_document.id::text
  );

  -- The document-specific job supersedes the generic upload-review job.
  WITH resolved AS (
    UPDATE public.owner_alerts
    SET resolved_at = now(),
        seen_at = coalesce(seen_at, now()),
        resolution_note = coalesce(resolution_note, 'Superseded by the supplier-paper review job.')
    WHERE branch_id = p_branch_id
      AND kind = 'operator_evidence_review'
      AND entity_ref = p_evidence_id::text
      AND resolved_at IS NULL
    RETURNING id
  )
  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  SELECT
    'inventory_reconciliation_issue', 'owner_alert', id, p_branch_id, v_actor,
    jsonb_build_object('resolved', true, 'kind', 'operator_evidence_review', 'superseded_by', v_alert_id)
  FROM resolved;

  RETURN v_receipt || jsonb_build_object('replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_operator_certificate_v18(uuid, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_operator_certificate_v18(uuid, uuid, uuid, text)
  TO authenticated, service_role;

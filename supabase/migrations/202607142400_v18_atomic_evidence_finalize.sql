-- V18 Phase B hardening: atomically finalise operator evidence metadata.
--
-- Object storage cannot participate in the PostgreSQL transaction. The server
-- therefore uploads the private object first and calls this purpose-built RPC
-- to commit the evidence row, its append-only audit fact and (when required)
-- the owner-review job together. A deterministic evidence id makes a lost RPC
-- response replay-safe; changed payloads are rejected instead of being folded
-- into the first upload.

CREATE OR REPLACE FUNCTION public.assert_operator_evidence_source_v18(
  p_branch_id uuid,
  p_actor_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_evidence_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.operator_workflow_runs%ROWTYPE;
  v_expected_workflow text;
BEGIN
  -- Upload is an operator-workflow concern. Domain rows are linked only later
  -- by their purpose-built completion/link RPCs; accepting a caller-shaped
  -- domain source here would allow a same-branch evidence provenance forgery.
  IF p_source_type IS DISTINCT FROM 'operator_workflow_run' OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'Evidence must belong to an operator workflow.' USING ERRCODE = '22023';
  END IF;

  CASE p_evidence_type
    WHEN 'delivery_note' THEN v_expected_workflow := 'delivery';
    WHEN 'waste_photo' THEN v_expected_workflow := 'waste';
    WHEN 'certificate' THEN v_expected_workflow := 'certificate';
    WHEN 'supplier_document' THEN v_expected_workflow := 'certificate';
    WHEN 'other' THEN v_expected_workflow := 'certificate';
    WHEN 'fridge_check' THEN v_expected_workflow := NULL;
    ELSE RAISE EXCEPTION 'Evidence type is invalid.' USING ERRCODE = '22023';
  END CASE;

  -- Draft persistence is deliberately best effort. Reserve a missing run here
  -- so an upload does not depend on a debounce having landed first. A later
  -- draft save updates this same in-progress row with the real step payload.
  IF v_expected_workflow IS NOT NULL THEN
    INSERT INTO public.operator_workflow_runs(
      id, branch_id, operator_id, workflow, status, steps
    )
    VALUES (
      p_source_id, p_branch_id, p_actor_id, v_expected_workflow,
      'in_progress', jsonb_build_object('evidenceReserved', true)
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  SELECT * INTO v_run
  FROM public.operator_workflow_runs r
  WHERE r.id = p_source_id
  FOR UPDATE;

  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Evidence workflow has not started.' USING ERRCODE = 'P0002';
  END IF;
  IF v_run.branch_id IS DISTINCT FROM p_branch_id
     OR v_run.operator_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Evidence workflow does not belong to this operator.' USING ERRCODE = '42501';
  END IF;
  IF (v_expected_workflow IS NOT NULL AND v_run.workflow IS DISTINCT FROM v_expected_workflow)
     OR (p_evidence_type = 'fridge_check' AND v_run.workflow NOT IN ('open', 'close')) THEN
    RAISE EXCEPTION 'Evidence does not match this workflow.' USING ERRCODE = '22023';
  END IF;
  IF v_run.status = 'abandoned' THEN
    RAISE EXCEPTION 'Evidence workflow was abandoned.' USING ERRCODE = '22023';
  END IF;

  RETURN v_run.workflow;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_operator_evidence_source_v18(uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- Seal one immutable generic review job per evidence record. Preserve any
-- historical duplicate rows under explicit legacy refs and audit the migration
-- repair; no alert or audit history is deleted.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY branch_id, kind, entity_ref
      ORDER BY created_at, id
    ) AS ordinal
  FROM public.owner_alerts
  WHERE kind = 'operator_evidence_review'
    AND entity_ref IS NOT NULL
), repaired AS (
  UPDATE public.owner_alerts a
  SET entity_ref = a.entity_ref || ':legacy-duplicate:' || a.id::text,
      resolved_at = coalesce(a.resolved_at, now()),
      seen_at = coalesce(a.seen_at, now()),
      resolution_note = coalesce(
        a.resolution_note,
        'Duplicate evidence-review job consolidated during V18 migration.'
      )
  FROM ranked r
  WHERE a.id = r.id AND r.ordinal > 1
  RETURNING a.id, a.branch_id
)
INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
SELECT
  'owner_alert_lifecycle_changed', 'owner_alert', id, branch_id, NULL,
  jsonb_build_object(
    'transition', 'migration_consolidated',
    'kind', 'operator_evidence_review',
    'rule', 'one_job_per_evidence'
  )
FROM repaired;

CREATE UNIQUE INDEX IF NOT EXISTS owner_alerts_evidence_review_uniq
  ON public.owner_alerts(branch_id, kind, entity_ref)
  WHERE kind = 'operator_evidence_review';

CREATE OR REPLACE FUNCTION public.finalize_operator_evidence_upload_v18(
  p_evidence_id uuid,
  p_branch_id uuid,
  p_actor_id uuid,
  p_bucket text,
  p_object_path text,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_evidence_type text,
  p_source_type text,
  p_source_id uuid,
  p_source_ref text,
  p_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.operator_evidence%ROWTYPE;
  v_review_required boolean;
  v_status text;
  v_created boolean := false;
  v_alert public.owner_alerts%ROWTYPE;
  v_alert_created boolean := false;
  v_source_ref text := nullif(btrim(coalesce(p_source_ref, '')), '');
  v_audit_count integer;
  v_audit public.audit_logs%ROWTYPE;
  v_alert_audit_count integer;
BEGIN
  IF p_evidence_id IS NULL OR p_branch_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Evidence identity is required.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_actor_id
      AND p.is_active IS TRUE
      AND p.role IN ('manager', 'owner')
      AND (p.role = 'owner' OR p.branch_id = p_branch_id)
  ) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_bucket IS DISTINCT FROM 'operator-evidence'
     OR p_object_path IS NULL
     OR char_length(p_object_path) > 512
     OR p_object_path NOT LIKE p_branch_id::text || '/%' THEN
    RAISE EXCEPTION 'Evidence object path is invalid.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_file_name, '')), '') IS NULL OR char_length(p_file_name) > 160 THEN
    RAISE EXCEPTION 'Evidence file name is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_content_type IS NULL OR p_content_type NOT IN (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
  ) THEN
    RAISE EXCEPTION 'Evidence content type is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 10485760 THEN
    RAISE EXCEPTION 'Evidence file size is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_evidence_type IS NULL OR p_evidence_type NOT IN (
    'delivery_note', 'supplier_document', 'certificate', 'fridge_check', 'waste_photo', 'other'
  ) THEN
    RAISE EXCEPTION 'Evidence type is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS DISTINCT FROM 'operator_workflow_run'
     OR p_source_id IS NULL
     OR p_evidence_id IS DISTINCT FROM p_source_id THEN
    RAISE EXCEPTION 'Evidence source type is invalid.' USING ERRCODE = '22023';
  END IF;
  IF v_source_ref IS NOT NULL AND char_length(v_source_ref) > 160 THEN
    RAISE EXCEPTION 'Evidence source label is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Evidence content fingerprint is invalid.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.assert_operator_evidence_source_v18(
    p_branch_id, p_actor_id, p_source_type, p_source_id, p_evidence_type
  );

  v_review_required := p_evidence_type IN ('certificate', 'supplier_document', 'other');
  v_status := CASE WHEN v_review_required THEN 'needs_owner_review' ELSE 'uploaded' END;

  -- Serialises exact replay and legacy audit/job healing for this evidence id.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_evidence_id::text, 0));
  SELECT * INTO v_existing
  FROM public.operator_evidence
  WHERE id = p_evidence_id
  FOR UPDATE;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.operator_evidence(
      id, branch_id, bucket, object_path, file_name, content_type, size_bytes,
      evidence_type, source_type, source_id, source_ref, status,
      review_required, metadata, uploaded_by
    )
    VALUES (
      p_evidence_id, p_branch_id, 'operator-evidence', p_object_path,
      btrim(p_file_name), p_content_type, p_size_bytes, p_evidence_type,
      p_source_type, p_source_id, v_source_ref, v_status,
      v_review_required, jsonb_build_object('sha256', p_sha256), p_actor_id
    );
    v_created := true;
  ELSIF v_existing.branch_id IS DISTINCT FROM p_branch_id
     OR v_existing.bucket IS DISTINCT FROM 'operator-evidence'
     OR v_existing.object_path IS DISTINCT FROM p_object_path
     OR v_existing.file_name IS DISTINCT FROM btrim(p_file_name)
     OR v_existing.content_type IS DISTINCT FROM p_content_type
     OR v_existing.size_bytes IS DISTINCT FROM p_size_bytes
     OR v_existing.evidence_type IS DISTINCT FROM p_evidence_type
     OR v_existing.source_type IS DISTINCT FROM p_source_type
     OR v_existing.source_id IS DISTINCT FROM p_source_id
     OR v_existing.source_ref IS DISTINCT FROM v_source_ref
     OR v_existing.uploaded_by IS DISTINCT FROM p_actor_id
     OR v_existing.metadata->>'sha256' IS DISTINCT FROM p_sha256
     OR v_existing.review_required IS DISTINCT FROM v_review_required
     OR (v_existing.status <> 'linked' AND v_existing.status IS DISTINCT FROM v_status)
     OR v_existing.status NOT IN ('uploaded', 'needs_owner_review', 'linked') THEN
    RAISE EXCEPTION 'Evidence id was already used for a different upload.' USING ERRCODE = '23505';
  END IF;

  -- Heal a historical row whose former action crashed after the row insert but
  -- before its audit write. More than one or a conflicting audit is divergence,
  -- not an idempotent replay, and therefore fails closed.
  SELECT count(*) INTO v_audit_count
  FROM public.audit_logs l
  WHERE l.event_type = 'evidence_uploaded'
    AND l.target_type = 'operator_evidence'
    AND l.target_id = p_evidence_id
    AND l.branch_id = p_branch_id;

  IF v_audit_count > 1 THEN
    RAISE EXCEPTION 'Evidence has conflicting upload audit history.' USING ERRCODE = '23505';
  ELSIF v_audit_count = 1 THEN
    SELECT * INTO v_audit
    FROM public.audit_logs l
    WHERE l.event_type = 'evidence_uploaded'
      AND l.target_type = 'operator_evidence'
      AND l.target_id = p_evidence_id
      AND l.branch_id = p_branch_id;
    IF v_audit.metadata->>'evidence_type' IS DISTINCT FROM p_evidence_type
       OR v_audit.metadata->>'source_type' IS DISTINCT FROM p_source_type
       OR v_audit.metadata->>'source_id' IS DISTINCT FROM p_source_id::text
       OR v_audit.metadata->>'file_name' IS DISTINCT FROM btrim(p_file_name)
       OR (v_audit.actor_id IS NOT NULL AND v_audit.actor_id IS DISTINCT FROM p_actor_id) THEN
      RAISE EXCEPTION 'Evidence upload audit does not match.' USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
    VALUES (
      'evidence_uploaded', 'operator_evidence', p_evidence_id, p_branch_id, p_actor_id,
      jsonb_build_object(
        'evidence_type', p_evidence_type,
        'source_type', p_source_type,
        'source_id', p_source_id,
        'file_name', btrim(p_file_name)
      )
    );
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_logs l
  WHERE l.event_type = 'evidence_uploaded'
    AND l.target_type = 'operator_evidence'
    AND l.target_id = p_evidence_id
    AND l.branch_id = p_branch_id;
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'Evidence upload audit cardinality failed.' USING ERRCODE = '23505';
  END IF;

  -- Review-required uploads always leave a generic fallback. Certificate
  -- completion supersedes it in its own transaction; if completion crashes,
  -- the open generic job accurately keeps the uploaded paper owner-visible.
  IF v_review_required THEN
    SELECT * INTO v_alert
    FROM public.owner_alerts a
    WHERE a.branch_id = p_branch_id
      AND a.kind = 'operator_evidence_review'
      AND a.entity_ref = p_evidence_id::text
    ORDER BY a.created_at, a.id
    LIMIT 1
    FOR UPDATE;

    IF v_alert.id IS NULL THEN
      INSERT INTO public.owner_alerts(
        branch_id, severity, kind, summary, entity_ref, created_by
      )
      VALUES (
        p_branch_id, 'warning', 'operator_evidence_review',
        'A photo was saved for owner review.', p_evidence_id::text, p_actor_id
      )
      RETURNING * INTO v_alert;
      v_alert_created := true;
    END IF;

    IF v_alert.severity IS DISTINCT FROM 'warning'
       OR v_alert.summary IS DISTINCT FROM 'A photo was saved for owner review.'
       OR v_alert.created_by IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'Evidence review job does not match.' USING ERRCODE = '23505';
    END IF;

    SELECT count(*) INTO v_alert_audit_count
    FROM public.audit_logs l
    WHERE l.event_type = 'evidence_uploaded'
      AND l.target_type = 'owner_alert'
      AND l.target_id = v_alert.id
      AND l.branch_id = p_branch_id;
    IF v_alert_audit_count > 1 THEN
      RAISE EXCEPTION 'Evidence review job has conflicting audit history.' USING ERRCODE = '23505';
    ELSIF v_alert_audit_count = 0 THEN
      INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
      VALUES (
        'evidence_uploaded', 'owner_alert', v_alert.id, p_branch_id, p_actor_id,
        jsonb_build_object(
          'kind', 'operator_evidence_review',
          'evidence_id', p_evidence_id,
          'evidence_type', p_evidence_type,
          'source_type', p_source_type
        )
      );
    END IF;

    SELECT count(*) INTO v_alert_audit_count
    FROM public.audit_logs l
    WHERE l.event_type = 'evidence_uploaded'
      AND l.target_type = 'owner_alert'
      AND l.target_id = v_alert.id
      AND l.branch_id = p_branch_id;
    IF v_alert_audit_count <> 1 THEN
      RAISE EXCEPTION 'Evidence review audit cardinality failed.' USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', p_evidence_id,
    'created', v_created,
    'replayed', NOT v_created,
    'reviewAlertId', v_alert.id,
    'reviewAlertCreated', v_alert_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_operator_evidence_upload_v18(
  uuid, uuid, uuid, text, text, text, text, bigint, text, text, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_operator_evidence_upload_v18(
  uuid, uuid, uuid, text, text, text, text, bigint, text, text, uuid, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_operator_evidence_failure_v18(
  p_evidence_id uuid,
  p_branch_id uuid,
  p_actor_id uuid,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_evidence_type text,
  p_source_type text,
  p_source_id uuid,
  p_source_ref text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.operator_evidence%ROWTYPE;
  v_source_ref text := nullif(btrim(coalesce(p_source_ref, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_created boolean := false;
  v_audit_count integer;
  v_audit public.audit_logs%ROWTYPE;
BEGIN
  IF p_evidence_id IS NULL OR p_branch_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Evidence identity is required.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_actor_id
      AND p.is_active IS TRUE
      AND p.role IN ('manager', 'owner')
      AND (p.role = 'owner' OR p.branch_id = p_branch_id)
  ) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_evidence_type IS NULL OR p_evidence_type NOT IN (
    'delivery_note', 'supplier_document', 'certificate', 'fridge_check', 'waste_photo', 'other'
  ) OR p_source_type IS DISTINCT FROM 'operator_workflow_run'
    OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'Evidence failure metadata is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_file_name IS NOT NULL AND char_length(p_file_name) > 160
     OR p_content_type IS NOT NULL AND char_length(p_content_type) > 120
     OR p_size_bytes IS NOT NULL AND (p_size_bytes < 0 OR p_size_bytes > 1099511627776)
     OR v_source_ref IS NOT NULL AND char_length(v_source_ref) > 160
     OR v_reason IS NULL OR char_length(v_reason) > 240 THEN
    RAISE EXCEPTION 'Evidence failure metadata is invalid.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.assert_operator_evidence_source_v18(
    p_branch_id, p_actor_id, p_source_type, p_source_id, p_evidence_type
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(p_evidence_id::text, 0));
  SELECT * INTO v_existing
  FROM public.operator_evidence
  WHERE id = p_evidence_id
  FOR UPDATE;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.operator_evidence(
      id, branch_id, bucket, object_path, file_name, content_type, size_bytes,
      evidence_type, source_type, source_id, source_ref, status,
      review_required, failure_reason, uploaded_by
    )
    VALUES (
      p_evidence_id, p_branch_id, 'operator-evidence', NULL,
      nullif(btrim(coalesce(p_file_name, '')), ''),
      nullif(btrim(coalesce(p_content_type, '')), ''), p_size_bytes,
      p_evidence_type, p_source_type, p_source_id, v_source_ref,
      'failed', true, v_reason, p_actor_id
    );
    v_created := true;
  ELSIF v_existing.branch_id IS DISTINCT FROM p_branch_id
     OR v_existing.bucket IS DISTINCT FROM 'operator-evidence'
     OR v_existing.object_path IS NOT NULL
     OR v_existing.file_name IS DISTINCT FROM nullif(btrim(coalesce(p_file_name, '')), '')
     OR v_existing.content_type IS DISTINCT FROM nullif(btrim(coalesce(p_content_type, '')), '')
     OR v_existing.size_bytes IS DISTINCT FROM p_size_bytes
     OR v_existing.evidence_type IS DISTINCT FROM p_evidence_type
     OR v_existing.source_type IS DISTINCT FROM p_source_type
     OR v_existing.source_id IS DISTINCT FROM p_source_id
     OR v_existing.source_ref IS DISTINCT FROM v_source_ref
     OR v_existing.status IS DISTINCT FROM 'failed'
     OR v_existing.review_required IS DISTINCT FROM true
     OR v_existing.failure_reason IS DISTINCT FROM v_reason
     OR v_existing.uploaded_by IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Evidence id was already used for a different failure.' USING ERRCODE = '23505';
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_logs l
  WHERE l.event_type = 'evidence_upload_failed'
    AND l.target_type = 'operator_evidence'
    AND l.target_id = p_evidence_id
    AND l.branch_id = p_branch_id;

  IF v_audit_count > 1 THEN
    RAISE EXCEPTION 'Evidence failure has conflicting audit history.' USING ERRCODE = '23505';
  ELSIF v_audit_count = 1 THEN
    SELECT * INTO v_audit
    FROM public.audit_logs l
    WHERE l.event_type = 'evidence_upload_failed'
      AND l.target_type = 'operator_evidence'
      AND l.target_id = p_evidence_id
      AND l.branch_id = p_branch_id;
    IF v_audit.metadata->>'evidence_type' IS DISTINCT FROM p_evidence_type
       OR v_audit.metadata->>'source_type' IS DISTINCT FROM p_source_type
       OR v_audit.metadata->>'reason' IS DISTINCT FROM v_reason
       OR (v_audit.actor_id IS NOT NULL AND v_audit.actor_id IS DISTINCT FROM p_actor_id) THEN
      RAISE EXCEPTION 'Evidence failure audit does not match.' USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
    VALUES (
      'evidence_upload_failed', 'operator_evidence', p_evidence_id, p_branch_id, p_actor_id,
      jsonb_build_object(
        'evidence_type', p_evidence_type,
        'source_type', p_source_type,
        'reason', v_reason
      )
    );
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_logs l
  WHERE l.event_type = 'evidence_upload_failed'
    AND l.target_type = 'operator_evidence'
    AND l.target_id = p_evidence_id
    AND l.branch_id = p_branch_id;
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'Evidence failure audit cardinality failed.' USING ERRCODE = '23505';
  END IF;

  RETURN jsonb_build_object('id', p_evidence_id, 'created', v_created, 'replayed', NOT v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.record_operator_evidence_failure_v18(
  uuid, uuid, uuid, text, text, bigint, text, text, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_operator_evidence_failure_v18(
  uuid, uuid, uuid, text, text, bigint, text, text, uuid, text, text
) TO service_role;

-- Deletion crosses PostgreSQL and object storage, so model it as an explicit,
-- retryable saga. `delete_pending` never claims that proof still exists. Only
-- unlinked evidence may enter the saga; linked/domain compliance proof is
-- immutable through this operator/admin surface.
ALTER TABLE public.operator_evidence
  DROP CONSTRAINT IF EXISTS operator_evidence_status_check;
ALTER TABLE public.operator_evidence
  ADD CONSTRAINT operator_evidence_status_check CHECK (
    status IN ('uploaded', 'linked', 'needs_owner_review', 'delete_pending', 'deleted', 'failed')
  );

ALTER TABLE public.operator_evidence
  ADD COLUMN IF NOT EXISTS delete_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS delete_requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_previous_status text CHECK (
    delete_previous_status IS NULL
    OR delete_previous_status IN ('uploaded', 'needs_owner_review', 'failed')
  );

CREATE OR REPLACE FUNCTION public.request_operator_evidence_delete_v18(
  p_evidence_id uuid,
  p_branch_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evidence public.operator_evidence%ROWTYPE;
  v_actor public.profiles%ROWTYPE;
  v_audit_count integer;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles p
  WHERE p.id = p_actor_id
    AND p.is_active IS TRUE
    AND p.role IN ('manager', 'owner')
    AND (p.role = 'owner' OR p.branch_id = p_branch_id);
  IF v_actor.id IS NULL THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_evidence_id::text, 0));
  SELECT * INTO v_evidence
  FROM public.operator_evidence e
  WHERE e.id = p_evidence_id
  FOR UPDATE;
  IF v_evidence.id IS NULL OR v_evidence.branch_id IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION 'Photo not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_evidence.status = 'deleted' THEN
    RETURN jsonb_build_object('id', v_evidence.id, 'alreadyDeleted', true);
  END IF;
  IF v_evidence.status = 'delete_pending' THEN
    IF v_actor.role <> 'owner' AND v_evidence.delete_requested_by IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'Only the person who requested deletion can retry it.' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
      'id', v_evidence.id,
      'bucket', v_evidence.bucket,
      'objectPath', v_evidence.object_path,
      'pending', true,
      'alreadyDeleted', false
    );
  END IF;
  IF v_evidence.status = 'linked'
     OR v_evidence.evidence_type IN ('certificate', 'supplier_document')
     OR v_evidence.source_type IN ('compliance_document', 'supplier_document', 'compliance_log') THEN
    RAISE EXCEPTION 'Linked or compliance evidence cannot be deleted here.' USING ERRCODE = '42501';
  END IF;
  IF v_evidence.status NOT IN ('uploaded', 'needs_owner_review', 'failed') THEN
    RAISE EXCEPTION 'Photo cannot be deleted in its current state.' USING ERRCODE = '22023';
  END IF;
  IF v_actor.role <> 'owner' AND v_evidence.uploaded_by IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'You can only delete your own unlinked photo.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.operator_evidence
  SET delete_previous_status = status,
      status = 'delete_pending',
      delete_requested_at = clock_timestamp(),
      delete_requested_by = p_actor_id
  WHERE id = v_evidence.id;

  SELECT count(*) INTO v_audit_count
  FROM public.audit_logs l
  WHERE l.event_type = 'evidence_deleted'
    AND l.target_type = 'operator_evidence'
    AND l.target_id = v_evidence.id
    AND l.branch_id = p_branch_id
    AND l.metadata->>'transition' = 'requested';
  IF v_audit_count <> 0 THEN
    RAISE EXCEPTION 'Evidence delete request audit already exists.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'evidence_deleted', 'operator_evidence', v_evidence.id, p_branch_id, p_actor_id,
    jsonb_build_object(
      'transition', 'requested',
      'previous_status', v_evidence.status,
      'object_present', v_evidence.object_path IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'id', v_evidence.id,
    'bucket', v_evidence.bucket,
    'objectPath', v_evidence.object_path,
    'pending', true,
    'alreadyDeleted', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_operator_evidence_delete_v18(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_operator_evidence_delete_v18(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_operator_evidence_delete_v18(
  p_evidence_id uuid,
  p_branch_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evidence public.operator_evidence%ROWTYPE;
  v_actor public.profiles%ROWTYPE;
  v_requested_count integer;
  v_final_count integer;
BEGIN
  SELECT * INTO v_actor
  FROM public.profiles p
  WHERE p.id = p_actor_id
    AND p.is_active IS TRUE
    AND p.role IN ('manager', 'owner')
    AND (p.role = 'owner' OR p.branch_id = p_branch_id);
  IF v_actor.id IS NULL THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_evidence_id::text, 0));
  SELECT * INTO v_evidence
  FROM public.operator_evidence e
  WHERE e.id = p_evidence_id
  FOR UPDATE;
  IF v_evidence.id IS NULL OR v_evidence.branch_id IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION 'Photo not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_evidence.status = 'deleted' THEN
    RETURN jsonb_build_object('id', v_evidence.id, 'replayed', true);
  END IF;
  IF v_evidence.status IS DISTINCT FROM 'delete_pending'
     OR v_evidence.delete_requested_by IS NULL
     OR (v_actor.role <> 'owner' AND v_evidence.delete_requested_by IS DISTINCT FROM p_actor_id) THEN
    RAISE EXCEPTION 'Photo deletion was not requested by this operator.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_requested_count
  FROM public.audit_logs l
  WHERE l.event_type = 'evidence_deleted'
    AND l.target_type = 'operator_evidence'
    AND l.target_id = v_evidence.id
    AND l.branch_id = p_branch_id
    AND l.metadata->>'transition' = 'requested';
  SELECT count(*) INTO v_final_count
  FROM public.audit_logs l
  WHERE l.event_type = 'evidence_deleted'
    AND l.target_type = 'operator_evidence'
    AND l.target_id = v_evidence.id
    AND l.branch_id = p_branch_id
    AND l.metadata->>'transition' = 'finalized';
  IF v_requested_count <> 1 OR v_final_count <> 0 THEN
    RAISE EXCEPTION 'Evidence deletion audit history is inconsistent.' USING ERRCODE = '23505';
  END IF;

  UPDATE public.operator_evidence
  SET status = 'deleted',
      deleted_at = clock_timestamp(),
      deleted_by = p_actor_id
  WHERE id = v_evidence.id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'evidence_deleted', 'operator_evidence', v_evidence.id, p_branch_id, p_actor_id,
    jsonb_build_object(
      'transition', 'finalized',
      'previous_status', v_evidence.delete_previous_status,
      'requested_by', v_evidence.delete_requested_by
    )
  );

  WITH resolved AS (
    UPDATE public.owner_alerts a
    SET resolved_at = clock_timestamp(),
        seen_at = coalesce(a.seen_at, clock_timestamp()),
        resolution_note = coalesce(a.resolution_note, 'The unlinked evidence was deleted.')
    WHERE a.branch_id = p_branch_id
      AND a.kind = 'operator_evidence_review'
      AND a.entity_ref = v_evidence.id::text
      AND a.resolved_at IS NULL
    RETURNING a.id
  )
  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  SELECT
    'owner_alert_lifecycle_changed', 'owner_alert', id, p_branch_id, p_actor_id,
    jsonb_build_object(
      'transition', 'auto_resolved',
      'kind', 'operator_evidence_review',
      'rule', 'evidence_deleted',
      'evidence_id', v_evidence.id
    )
  FROM resolved;

  RETURN jsonb_build_object('id', v_evidence.id, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_operator_evidence_delete_v18(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_operator_evidence_delete_v18(uuid, uuid, uuid)
  TO service_role;

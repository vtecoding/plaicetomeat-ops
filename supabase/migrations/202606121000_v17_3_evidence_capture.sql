-- V17.3 Evidence Capture Foundation
--
-- Operator photos become durable, private storage objects with a branch-scoped
-- evidence record. Domain workflows then link the evidence record to the real
-- business row they create (batch, waste event, compliance log, certificate
-- review). Clients never write these records or storage objects directly.

-- 1) Private storage bucket ----------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'operator-evidence',
  'operator-evidence',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No storage.objects policies are added. Upload/read/delete happens through
-- server actions using service-role transport after branch/role checks.

-- 2) Durable evidence records -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.operator_evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  bucket          text NOT NULL DEFAULT 'operator-evidence',
  object_path     text,
  file_name       text,
  content_type    text,
  size_bytes      bigint,
  evidence_type   text NOT NULL CHECK (
    evidence_type IN (
      'delivery_note',
      'supplier_document',
      'certificate',
      'fridge_check',
      'waste_photo',
      'other'
    )
  ),
  source_type     text NOT NULL DEFAULT 'operator_workflow_run' CHECK (
    source_type IN (
      'operator_workflow_run',
      'inventory_batch',
      'waste_event',
      'compliance_log',
      'supplier_document',
      'compliance_document'
    )
  ),
  source_id       uuid,
  source_ref      text,
  status          text NOT NULL DEFAULT 'uploaded' CHECK (
    status IN ('uploaded', 'linked', 'needs_owner_review', 'deleted', 'failed')
  ),
  review_required boolean NOT NULL DEFAULT false,
  failure_reason  text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  linked_at       timestamptz,
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operator_evidence IS
  'V17.3: durable private evidence uploaded from operator/admin guided flows. Business rows link to this; photos are never browser-only.';

CREATE INDEX IF NOT EXISTS operator_evidence_branch_created_idx
  ON public.operator_evidence (branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS operator_evidence_source_idx
  ON public.operator_evidence (source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS operator_evidence_review_idx
  ON public.operator_evidence (branch_id, created_at DESC)
  WHERE status IN ('needs_owner_review', 'failed') OR review_required = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'operator_evidence_source_type_check'
      AND conrelid = 'public.operator_evidence'::regclass
  ) THEN
    ALTER TABLE public.operator_evidence
      ADD CONSTRAINT operator_evidence_source_type_check
      CHECK (
        source_type IN (
          'operator_workflow_run',
          'inventory_batch',
          'waste_event',
          'compliance_log',
          'supplier_document',
          'compliance_document'
        )
      );
  END IF;
END $$;

ALTER TABLE public.operator_evidence ENABLE ROW LEVEL SECURITY;

-- 3) Extend trusted audit vocabulary -----------------------------------------

CREATE OR REPLACE FUNCTION public.emit_audit_log(
  p_event_type text,
  p_target_type text,
  p_target_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_system_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_system boolean := (auth.uid() IS NULL);
  v_actor uuid;
  v_metadata jsonb;
  v_redacted jsonb := '[]'::jsonb;
  v_key text;
  v_id uuid;
  v_allowed CONSTANT text[] := ARRAY[
    'order_created', 'order_status_changed', 'price_changed', 'cost_changed',
    'pricing_committed', 'product_changed', 'product_availability_changed',
    'branch_settings_updated', 'inventory_remaining_adjusted', 'stock_added',
    'stock_corrected', 'stock_count_recorded', 'stock_count_line_applied',
    'batch_received', 'carcass_intake_confirmed', 'waste_recorded',
    'pickup_window_created', 'pickup_window_updated', 'pickup_window_disabled',
    'shop_closure_created', 'shop_closure_removed', 'ops_session_started',
    'ops_session_completed', 'ops_step_recorded', 'release_deployed',
    'sms_attempt', 'sms_template_updated', 'supplier_created',
    'certificate_uploaded', 'certificate_verified', 'compliance_reading_recorded',
    'compliance_log_completed', 'security_event',
    'inventory_depleted_for_order', 'inventory_depletion_shortfall',
    'inventory_reversed_for_order', 'inventory_reconciliation_issue',
    'inventory_confidence_degraded', 'inventory_failure_trend_detected',
    'evidence_uploaded', 'evidence_linked', 'evidence_deleted', 'evidence_upload_failed'
  ];
  v_secret_pattern CONSTANT text :=
    '(secret|token|password|passwd|access_id|public_access|cookie|authoriz|bearer|jwt|session|api[_-]?key|private[_-]?key|credential)';
BEGIN
  IF p_event_type IS NULL OR NOT (p_event_type = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'Unknown audit event type: %', coalesce(p_event_type, '(null)')
      USING ERRCODE = '22023';
  END IF;

  IF p_target_type IS NULL OR btrim(p_target_type) = '' THEN
    RAISE EXCEPTION 'audit target_type is required' USING ERRCODE = '22023';
  END IF;

  IF v_is_system THEN
    IF p_system_reason IS NULL OR btrim(p_system_reason) = '' THEN
      RAISE EXCEPTION 'system audit emission requires an explicit reason'
        USING ERRCODE = '22023';
    END IF;
    v_actor := NULL;
  ELSE
    v_actor := v_uid;
    IF p_system_reason IS NOT NULL THEN
      RAISE EXCEPTION 'only system callers may set a system reason'
        USING ERRCODE = '42501';
    END IF;
    IF p_branch_id IS NOT NULL AND NOT public.is_branch_staff(p_branch_id) THEN
      RAISE EXCEPTION 'not authorised to write audit evidence for this branch'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_metadata := coalesce(p_metadata, '{}'::jsonb);
  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'audit metadata must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF length(v_metadata::text) > 8192 THEN
    RAISE EXCEPTION 'audit metadata exceeds the maximum allowed size'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_metadata) LOOP
    IF v_key ~* v_secret_pattern THEN
      v_metadata := v_metadata - v_key;
      v_redacted := v_redacted || to_jsonb(v_key);
    END IF;
  END LOOP;
  IF jsonb_array_length(v_redacted) > 0 THEN
    v_metadata := jsonb_set(v_metadata, ARRAY['_redacted_keys'], v_redacted);
  END IF;
  IF p_system_reason IS NOT NULL THEN
    v_metadata := jsonb_set(v_metadata, ARRAY['system_reason'], to_jsonb(btrim(p_system_reason)));
  END IF;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (p_event_type, p_target_type, p_target_id, p_branch_id, v_actor, v_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text)
  TO authenticated, service_role;

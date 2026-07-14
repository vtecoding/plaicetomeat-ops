-- V18 A1 — extend the trusted audit vocabulary with the two money-truth events
-- written by collect_order_with_tender and record_till_event (202607141000):
--   * order_tender_recorded — the sale tender of record at collection
--   * till_event_recorded   — a drawer movement outside sales/refunds
--
-- Body-only redefinition of emit_audit_log (same name/signature, rule 1.4);
-- everything except the two additions to v_allowed is identical to the V17.3
-- version (202606121000). Final ACL mirrors 202607011300: authenticated flows
-- reach audit only through SECURITY DEFINER wrappers, never directly.

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
    'evidence_uploaded', 'evidence_linked', 'evidence_deleted', 'evidence_upload_failed',
    -- V18 A1 money truth:
    'order_tender_recorded', 'till_event_recorded'
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

-- CREATE OR REPLACE resets the ACL — re-assert the post-202607011300 state.
REVOKE ALL ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text)
  TO service_role;

-- V14.1-H - Inventory truth hardening and confidence layer.
--
-- This is deliberately quiet for operators. It strengthens the internal ledger:
--   * inventory_movements is append-only;
--   * stock corrections and count reconciliation write signed/balanced rows;
--   * post-collection reversals append compensating rows;
--   * internal reconciliation/confidence/failure views expose trend signals.

-- 1. Production ledger immutability -------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_inventory_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Seed/bootstrap escape hatch for trusted local maintenance only. Normal app
  -- roles cannot set this through PostgREST, and seed.sql no longer needs it.
  IF current_setting('app.inventory_seed_bypass', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'TRUNCATE' THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'inventory_movements are append-only; write a compensating movement instead'
    USING ERRCODE = '25006';
END;
$$;

DROP TRIGGER IF EXISTS inventory_movements_append_only_row ON public.inventory_movements;
CREATE TRIGGER inventory_movements_append_only_row
BEFORE UPDATE OR DELETE ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_movement_mutation();

DROP TRIGGER IF EXISTS inventory_movements_append_only_truncate ON public.inventory_movements;
CREATE TRIGGER inventory_movements_append_only_truncate
BEFORE TRUNCATE ON public.inventory_movements
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_inventory_movement_mutation();

DROP POLICY IF EXISTS "staff can create inventory movements" ON public.inventory_movements;
REVOKE UPDATE, DELETE, TRUNCATE ON public.inventory_movements FROM anon, authenticated, PUBLIC;

-- Reversal metadata. Nullable so historical rows and current SALE rows remain valid.
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS reversal_group_id uuid,
  ADD COLUMN IF NOT EXISTS reversal_of_movement_id uuid REFERENCES public.inventory_movements(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_movements_idempotency
  ON public.inventory_movements (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Exactly one reversal operation per collected order and reason.
CREATE TABLE IF NOT EXISTS public.inventory_reversal_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  source_event text NOT NULL CHECK (
    source_event IN ('REFUND_REVERSAL', 'COLLECTION_REVERSAL', 'CANCELLED_COLLECTION_REVERSAL', 'OPERATOR_CORRECTION')
  ),
  reason text NOT NULL,
  total_reversed_kg numeric(10,3) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, source_event)
);

ALTER TABLE public.inventory_reversal_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers read inventory reversal groups" ON public.inventory_reversal_groups;
CREATE POLICY "managers read inventory reversal groups" ON public.inventory_reversal_groups
FOR SELECT USING (public.is_branch_manager(branch_id));

ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_reversal_group_fk;
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_reversal_group_fk
  FOREIGN KEY (reversal_group_id) REFERENCES public.inventory_reversal_groups(id) ON DELETE SET NULL;

-- 2. Audit vocabulary ----------------------------------------------------------

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
    'inventory_confidence_degraded', 'inventory_failure_trend_detected'
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

-- 3. Signed movement normalization --------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_create_inventory_batch(
  p_branch_id uuid,
  p_product_id uuid,
  p_supplier_id uuid,
  p_received_date date,
  p_expiry_date date,
  p_received_weight_kg numeric,
  p_remaining_weight_kg numeric,
  p_invoice_cost numeric DEFAULT 0,
  p_halal_cert_ref text DEFAULT NULL,
  p_country_of_origin text DEFAULT NULL,
  p_slaughter_date date DEFAULT NULL,
  p_storage_location text DEFAULT NULL,
  p_batch_number text DEFAULT NULL,
  p_intake_idempotency_key text DEFAULT NULL,
  p_expected_weight_kg numeric DEFAULT NULL,
  p_actual_review_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_batch_id uuid;
  v_cost_per_kg numeric;
  v_remaining_weight_kg numeric := coalesce(p_remaining_weight_kg, p_received_weight_kg);
  v_invoice_cost numeric := coalesce(p_invoice_cost, 0);
  v_intake_key text := nullif(btrim(coalesce(p_intake_idempotency_key, '')), '');
  v_existing_batch public.inventory_batches%ROWTYPE;
  v_expected_weight_kg numeric := coalesce(p_expected_weight_kg, p_received_weight_kg);
  v_actual_review_note text := nullif(btrim(coalesce(p_actual_review_note, '')), '');
  v_halal_cert_ref text := nullif(btrim(coalesce(p_halal_cert_ref, '')), '');
  v_country_of_origin text := nullif(btrim(coalesce(p_country_of_origin, '')), '');
  v_storage_location text := nullif(btrim(coalesce(p_storage_location, '')), '');
  v_batch_number text := nullif(btrim(coalesce(p_batch_number, '')), '');
  v_adjustment_kg numeric;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND branch_id = p_branch_id) THEN
    RAISE EXCEPTION 'Product is required.' USING ERRCODE = '22023';
  END IF;
  IF p_supplier_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND branch_id = p_branch_id AND active = true) THEN
    RAISE EXCEPTION 'Supplier is required.' USING ERRCODE = '22023';
  END IF;
  IF p_received_weight_kg IS NULL OR p_received_weight_kg <= 0 THEN
    RAISE EXCEPTION 'Actual weight must be greater than zero.' USING ERRCODE = '22023';
  END IF;
  IF v_remaining_weight_kg < 0 OR v_remaining_weight_kg > p_received_weight_kg THEN
    RAISE EXCEPTION 'Remaining weight cannot exceed received weight.' USING ERRCODE = '22023';
  END IF;
  IF p_expiry_date < p_received_date THEN
    RAISE EXCEPTION 'Expiry date cannot be before received date.' USING ERRCODE = '22023';
  END IF;
  IF v_invoice_cost < 0 THEN
    RAISE EXCEPTION 'Invoice cost must be zero or greater.' USING ERRCODE = '22023';
  END IF;
  IF v_expected_weight_kg < 0 THEN
    RAISE EXCEPTION 'Estimated weight cannot be negative.' USING ERRCODE = '22023';
  END IF;

  v_cost_per_kg := CASE WHEN v_invoice_cost = 0 THEN 0 ELSE round(v_invoice_cost / p_received_weight_kg, 2) END;

  IF v_intake_key IS NOT NULL THEN
    SELECT * INTO v_existing_batch
    FROM public.inventory_batches
    WHERE branch_id = p_branch_id
      AND intake_idempotency_key = v_intake_key;

    IF v_existing_batch.id IS NOT NULL THEN
      IF v_existing_batch.product_id IS DISTINCT FROM p_product_id
        OR v_existing_batch.supplier_id IS DISTINCT FROM p_supplier_id
        OR v_existing_batch.received_date IS DISTINCT FROM p_received_date
        OR v_existing_batch.expiry_date IS DISTINCT FROM p_expiry_date
        OR v_existing_batch.received_weight_kg IS DISTINCT FROM p_received_weight_kg
        OR v_existing_batch.remaining_weight_kg IS DISTINCT FROM v_remaining_weight_kg
        OR v_existing_batch.invoice_cost IS DISTINCT FROM round(v_invoice_cost, 2)
        OR v_existing_batch.halal_cert_ref IS DISTINCT FROM v_halal_cert_ref
        OR v_existing_batch.country_of_origin IS DISTINCT FROM v_country_of_origin
        OR v_existing_batch.slaughter_date IS DISTINCT FROM p_slaughter_date
        OR v_existing_batch.storage_location IS DISTINCT FROM v_storage_location
        OR v_existing_batch.batch_number IS DISTINCT FROM v_batch_number THEN
        RAISE EXCEPTION 'Intake idempotency key already used for a different stock item.' USING ERRCODE = '22023';
      END IF;

      RETURN v_existing_batch.id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.inventory_batches (
      branch_id, product_id, supplier_id, received_date, expiry_date,
      received_weight_kg, remaining_weight_kg, invoice_cost, cost_per_kg,
      halal_cert_ref, country_of_origin, slaughter_date, storage_location, batch_number,
      intake_idempotency_key, expected_weight_kg, actual_weight_kg, actual_confirmed_at,
      actual_confirmed_by, actual_review_note, status, created_by
    )
    VALUES (
      p_branch_id, p_product_id, p_supplier_id, p_received_date, p_expiry_date,
      p_received_weight_kg, v_remaining_weight_kg, round(v_invoice_cost, 2), v_cost_per_kg,
      v_halal_cert_ref,
      v_country_of_origin,
      p_slaughter_date,
      v_storage_location,
      v_batch_number,
      v_intake_key, v_expected_weight_kg, p_received_weight_kg, now(),
      v_actor, v_actual_review_note,
      CASE WHEN v_remaining_weight_kg = 0 THEN 'depleted' ELSE 'active' END,
      v_actor
    )
    RETURNING id INTO v_batch_id;
  EXCEPTION
    WHEN unique_violation THEN
      IF v_intake_key IS NULL THEN
        RAISE;
      END IF;
      SELECT * INTO v_existing_batch
      FROM public.inventory_batches
      WHERE branch_id = p_branch_id AND intake_idempotency_key = v_intake_key;
      IF v_existing_batch.id IS NULL THEN
        RAISE;
      END IF;
      RETURN v_existing_batch.id;
  END;

  INSERT INTO public.inventory_movements(
    batch_id, branch_id, movement_type, quantity_kg, delta_kg,
    balance_before_kg, balance_after_kg, source_event, reason, created_by,
    idempotency_key
  )
  VALUES (
    v_batch_id, p_branch_id, 'RECEIVED', p_received_weight_kg, p_received_weight_kg,
    0, p_received_weight_kg, 'STOCK_RECEIVED',
    'Stock added after actual weight check', v_actor,
    coalesce(v_intake_key, v_batch_id::text) || ':STOCK_RECEIVED'
  );

  v_adjustment_kg := v_remaining_weight_kg - p_received_weight_kg;
  IF v_adjustment_kg <> 0 THEN
    INSERT INTO public.inventory_movements(
      batch_id, branch_id, movement_type, quantity_kg, delta_kg,
      balance_before_kg, balance_after_kg, source_event, reason, created_by,
      idempotency_key
    )
    VALUES (
      v_batch_id, p_branch_id, 'ADJUSTMENT', abs(v_adjustment_kg), v_adjustment_kg,
      p_received_weight_kg, v_remaining_weight_kg, 'INTAKE_RECONCILE',
      'Opening reconciliation at intake', v_actor,
      coalesce(v_intake_key, v_batch_id::text) || ':INTAKE_RECONCILE'
    );
  END IF;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'stock_added', 'inventory_batch', v_batch_id, p_branch_id, v_actor,
    jsonb_build_object(
      'expected_weight_kg', v_expected_weight_kg,
      'actual_weight_kg', p_received_weight_kg,
      'difference_kg', p_received_weight_kg - v_expected_weight_kg,
      'remaining_weight_kg', v_remaining_weight_kg,
      'expiry_date', p_expiry_date,
      'intake_idempotency_key', v_intake_key
    )
  );

  RETURN v_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_inventory_batch(uuid, uuid, uuid, date, date, numeric, numeric, numeric, text, text, date, text, text, text, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_record_inventory_waste(
  p_batch_id uuid,
  p_quantity_kg numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_batch public.inventory_batches%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_waste_id uuid;
  v_new_remaining numeric;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_batch FROM public.inventory_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_manager(v_batch.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_quantity_kg IS NULL OR p_quantity_kg <= 0 THEN
    RAISE EXCEPTION 'Waste quantity must be greater than zero.' USING ERRCODE = '22023';
  END IF;
  IF p_quantity_kg > v_batch.remaining_weight_kg THEN
    RAISE EXCEPTION 'Waste quantity cannot exceed remaining weight.' USING ERRCODE = '22023';
  END IF;
  IF v_reason NOT IN ('expired', 'damaged', 'trim_loss', 'customer_issue', 'contaminated', 'customer_return', 'other', 'review') THEN
    RAISE EXCEPTION 'Waste reason is required.' USING ERRCODE = '22023';
  END IF;

  v_new_remaining := v_batch.remaining_weight_kg - p_quantity_kg;

  UPDATE public.inventory_batches
  SET remaining_weight_kg = v_new_remaining,
      status = CASE WHEN v_new_remaining = 0 THEN 'disposed' ELSE status END
  WHERE id = p_batch_id;

  INSERT INTO public.inventory_waste_events(batch_id, product_id, waste_kg, reason, created_by)
  VALUES (p_batch_id, v_batch.product_id, p_quantity_kg, v_reason, v_actor)
  RETURNING id INTO v_waste_id;

  INSERT INTO public.inventory_movements(
    batch_id, branch_id, movement_type, quantity_kg, delta_kg,
    balance_before_kg, balance_after_kg, source_event, reference_id, reason, created_by,
    idempotency_key
  )
  VALUES (
    p_batch_id, v_batch.branch_id, 'WASTE', p_quantity_kg, -p_quantity_kg,
    v_batch.remaining_weight_kg, v_new_remaining, 'WASTE_RECORDED', v_waste_id,
    v_reason, v_actor, v_waste_id::text || ':WASTE_RECORDED'
  );

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'waste_recorded', 'inventory_batch', p_batch_id, v_batch.branch_id, v_actor,
    jsonb_build_object(
      'waste_event_id', v_waste_id,
      'quantity_kg', p_quantity_kg,
      'reason', v_reason,
      'remaining_kg', v_new_remaining,
      'estimated_loss', round(p_quantity_kg * coalesce(v_batch.cost_per_kg, 0), 2)
    )
  );

  RETURN v_waste_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_record_inventory_waste(uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_adjust_inventory_remaining(
  p_batch_id uuid,
  p_new_remaining_kg numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_batch public.inventory_batches%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_delta numeric;
  v_movement_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_batch FROM public.inventory_batches WHERE id = p_batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Stock item not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_manager(v_batch.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF p_new_remaining_kg IS NULL OR p_new_remaining_kg < 0 OR p_new_remaining_kg > v_batch.received_weight_kg THEN
    RAISE EXCEPTION 'Stock left cannot exceed the actual weight received.' USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) < 4 THEN
    RAISE EXCEPTION 'Stock correction reason is required.' USING ERRCODE = '22023';
  END IF;

  v_delta := p_new_remaining_kg - v_batch.remaining_weight_kg;
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'Stock correction did not change the weight.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.inventory_batches
  SET remaining_weight_kg = p_new_remaining_kg,
      manual_adjustment_reason = v_reason,
      status = CASE WHEN p_new_remaining_kg = 0 THEN 'depleted' ELSE 'active' END
  WHERE id = p_batch_id;

  INSERT INTO public.inventory_movements(
    batch_id, branch_id, movement_type, quantity_kg, delta_kg,
    balance_before_kg, balance_after_kg, source_event, reason, created_by,
    idempotency_key
  )
  VALUES (
    p_batch_id, v_batch.branch_id, 'ADJUSTMENT', abs(v_delta), v_delta,
    v_batch.remaining_weight_kg, p_new_remaining_kg, 'MANUAL_ADJUST',
    v_reason, v_actor, gen_random_uuid()::text || ':MANUAL_ADJUST'
  )
  RETURNING id INTO v_movement_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'stock_corrected', 'inventory_batch', p_batch_id, v_batch.branch_id, v_actor,
    jsonb_build_object('from_kg', v_batch.remaining_weight_kg, 'to_kg', p_new_remaining_kg, 'difference_kg', v_delta, 'reason', v_reason)
  );

  RETURN v_movement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_inventory_remaining(uuid, numeric, text) TO authenticated;

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
  v_batch public.inventory_batches%ROWTYPE;
  v_movement_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_delta numeric;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_line FROM public.stock_count_lines WHERE id = p_line_id FOR UPDATE;
  IF v_line.id IS NULL OR v_line.session_id <> p_session_id THEN
    RAISE EXCEPTION 'Stock count line not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_session FROM public.ops_checklist_sessions WHERE id = v_line.session_id;
  IF v_session.id IS NULL OR v_session.branch_id <> v_line.branch_id THEN
    RAISE EXCEPTION 'Stock count line not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_manager(v_session.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'This stock count is already finished.' USING ERRCODE = '22023';
  END IF;
  IF v_line.applied_at IS NOT NULL THEN
    RETURN v_line.id;
  END IF;

  SELECT * INTO v_batch FROM public.inventory_batches WHERE id = v_line.batch_id FOR UPDATE;
  IF v_batch.id IS NULL OR v_batch.branch_id <> v_session.branch_id THEN
    RAISE EXCEPTION 'Stock item not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch.remaining_weight_kg <> v_line.system_weight_kg THEN
    RAISE EXCEPTION 'STALE_STOCK_COUNT: stock changed since this count was recorded; re-count before applying.'
      USING ERRCODE = 'P0001';
  END IF;

  v_reason := coalesce(v_reason, 'Stock count ' || to_char(v_session.business_date, 'YYYY-MM-DD'));

  IF v_line.counted_weight_kg = v_line.system_weight_kg THEN
    UPDATE public.stock_count_lines SET applied_at = now() WHERE id = p_line_id;
    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
    VALUES ('stock_count_line_applied', 'inventory_batch', v_line.batch_id, v_session.branch_id, v_actor,
      jsonb_build_object('system_kg', v_line.system_weight_kg, 'counted_kg', v_line.counted_weight_kg, 'difference_kg', 0));
    RETURN v_line.id;
  END IF;

  v_delta := v_line.counted_weight_kg - v_line.system_weight_kg;

  UPDATE public.inventory_batches
  SET remaining_weight_kg = v_line.counted_weight_kg,
      manual_adjustment_reason = v_reason,
      status = CASE WHEN v_line.counted_weight_kg = 0 THEN 'depleted' ELSE 'active' END
  WHERE id = v_line.batch_id;

  INSERT INTO public.inventory_movements(
    batch_id, branch_id, movement_type, quantity_kg, delta_kg,
    balance_before_kg, balance_after_kg, source_event, reference_id, reason, created_by,
    idempotency_key
  )
  VALUES (
    v_line.batch_id, v_session.branch_id, 'ADJUSTMENT', abs(v_delta), v_delta,
    v_line.system_weight_kg, v_line.counted_weight_kg, 'COUNT_RECONCILE',
    v_line.id, v_reason, v_actor, v_line.id::text || ':COUNT_RECONCILE'
  )
  RETURNING id INTO v_movement_id;

  UPDATE public.stock_count_lines
  SET applied_at = now(), correction_movement_id = v_movement_id
  WHERE id = p_line_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES ('stock_count_line_applied', 'inventory_batch', v_line.batch_id, v_session.branch_id, v_actor,
    jsonb_build_object(
      'system_kg', v_line.system_weight_kg,
      'counted_kg', v_line.counted_weight_kg,
      'difference_kg', v_delta,
      'movement_id', v_movement_id));

  RETURN v_line.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ops_apply_stock_count_line(uuid, uuid, text) TO authenticated;

-- 4. Explicit correction and reversal path -------------------------------------

CREATE OR REPLACE FUNCTION public.admin_reverse_order_inventory(
  p_order_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_reason text := lower(btrim(coalesce(p_reason, '')));
  v_source_event text;
  v_existing uuid;
  v_group_id uuid;
  v_original record;
  v_batch public.inventory_batches%ROWTYPE;
  v_before numeric(8,3);
  v_after numeric(8,3);
  v_delta numeric(8,3);
  v_total numeric(10,3) := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_manager(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  v_source_event := CASE v_reason
    WHEN 'refund' THEN 'REFUND_REVERSAL'
    WHEN 'collection_reversal' THEN 'COLLECTION_REVERSAL'
    WHEN 'cancelled_collection' THEN 'CANCELLED_COLLECTION_REVERSAL'
    WHEN 'operator_correction' THEN 'OPERATOR_CORRECTION'
    ELSE NULL
  END;
  IF v_source_event IS NULL THEN
    RAISE EXCEPTION 'Reversal reason must be refund, collection_reversal, cancelled_collection, or operator_correction.'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing
  FROM public.inventory_reversal_groups
  WHERE order_id = p_order_id AND source_event = v_source_event
  FOR UPDATE;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE order_id = p_order_id AND source_event = 'SALE_COLLECT'
  ) THEN
    RAISE EXCEPTION 'No collected inventory movement exists for this order.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.inventory_reversal_groups(order_id, branch_id, source_event, reason, created_by)
  VALUES (p_order_id, v_order.branch_id, v_source_event, v_reason, v_actor)
  RETURNING id INTO v_group_id;

  FOR v_original IN
    SELECT *
    FROM public.inventory_movements
    WHERE order_id = p_order_id
      AND source_event = 'SALE_COLLECT'
      AND delta_kg < 0
    ORDER BY created_at, id
  LOOP
    SELECT * INTO v_batch FROM public.inventory_batches WHERE id = v_original.batch_id FOR UPDATE;
    IF v_batch.id IS NULL OR v_batch.branch_id <> v_order.branch_id THEN
      RAISE EXCEPTION 'Original inventory batch is no longer available.' USING ERRCODE = 'P0002';
    END IF;
    IF v_batch.status IN ('recalled', 'disposed') THEN
      RAISE EXCEPTION 'Cannot auto-reverse into recalled or disposed stock; use operator correction.'
        USING ERRCODE = '22023';
    END IF;

    v_delta := abs(v_original.delta_kg);
    v_before := v_batch.remaining_weight_kg;
    v_after := v_before + v_delta;

    UPDATE public.inventory_batches
    SET remaining_weight_kg = v_after,
        status = CASE WHEN v_after > 0 THEN 'active' ELSE status END,
        updated_at = now()
    WHERE id = v_batch.id;

    INSERT INTO public.inventory_movements(
      batch_id, branch_id, movement_type, quantity_kg, delta_kg,
      balance_before_kg, balance_after_kg, source_event, order_id, order_item_id,
      reference_id, reason, created_by, idempotency_key, reversal_group_id,
      reversal_of_movement_id
    )
    VALUES (
      v_batch.id, v_order.branch_id, 'ADJUSTMENT', v_delta, v_delta,
      v_before, v_after, v_source_event, p_order_id, v_original.order_item_id,
      v_original.id, v_reason, v_actor,
      v_group_id::text || ':' || v_original.id::text || ':' || v_source_event,
      v_group_id, v_original.id
    );

    v_total := v_total + v_delta;
  END LOOP;

  UPDATE public.inventory_reversal_groups
  SET total_reversed_kg = v_total
  WHERE id = v_group_id;

  PERFORM public.emit_audit_log(
    'inventory_reversed_for_order', 'order', p_order_id, v_order.branch_id,
    jsonb_build_object(
      'order_ref', v_order.order_ref,
      'reason', v_reason,
      'source_event', v_source_event,
      'total_reversed_kg', v_total,
      'reversal_group_id', v_group_id
    )
  );

  RETURN v_group_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT id INTO v_existing
    FROM public.inventory_reversal_groups
    WHERE order_id = p_order_id AND source_event = v_source_event;
    RETURN v_existing;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reverse_order_inventory(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reverse_order_inventory(uuid, text) TO authenticated;

-- 5. Internal reconciliation, confidence and failure visibility -----------------

CREATE OR REPLACE VIEW public.inventory_reconciliation_monitor
WITH (security_invoker = true)
AS
WITH latest_movement AS (
  SELECT DISTINCT ON (m.batch_id)
    m.batch_id,
    m.balance_after_kg AS ledger_remaining_kg,
    m.created_at AS latest_movement_at,
    m.id AS latest_movement_id
  FROM public.inventory_movements m
  WHERE m.balance_after_kg IS NOT NULL
  ORDER BY m.batch_id, m.created_at DESC, m.id DESC
),
shortfalls AS (
  SELECT
    d.branch_id,
    (detail.value->>'product_id')::uuid AS product_id,
    count(*)::int AS shortfall_count_30d,
    sum((detail.value->>'short_kg')::numeric)::numeric(10,3) AS shortfall_kg_30d
  FROM public.order_inventory_depletions d
  CROSS JOIN LATERAL jsonb_array_elements(d.shortfall_detail) AS detail(value)
  WHERE d.created_at >= now() - interval '30 days'
    AND d.shortfall_kg > 0
    AND detail.value ? 'product_id'
  GROUP BY d.branch_id, (detail.value->>'product_id')::uuid
),
corrections AS (
  SELECT
    m.branch_id,
    b.product_id,
    count(*) FILTER (WHERE m.source_event IN ('COUNT_RECONCILE', 'MANUAL_ADJUST', 'INTAKE_RECONCILE'))::int AS correction_count_30d,
    max(m.created_at) FILTER (WHERE m.source_event = 'COUNT_RECONCILE') AS last_count_reconcile_at
  FROM public.inventory_movements m
  JOIN public.inventory_batches b ON b.id = m.batch_id
  WHERE m.created_at >= now() - interval '30 days'
  GROUP BY m.branch_id, b.product_id
),
counts AS (
  SELECT
    l.branch_id,
    b.product_id,
    max(l.applied_at) AS last_count_at
  FROM public.stock_count_lines l
  JOIN public.inventory_batches b ON b.id = l.batch_id
  WHERE l.applied_at IS NOT NULL
  GROUP BY l.branch_id, b.product_id
)
SELECT
  b.branch_id,
  b.product_id,
  p.name AS product_name,
  b.id AS batch_id,
  b.remaining_weight_kg AS cache_remaining_kg,
  lm.ledger_remaining_kg,
  coalesce(abs(b.remaining_weight_kg - lm.ledger_remaining_kg) > 0.001, false) AS cache_mismatch,
  coalesce(s.shortfall_count_30d, 0) AS shortfall_count_30d,
  coalesce(s.shortfall_kg_30d, 0) AS shortfall_kg_30d,
  coalesce(c.correction_count_30d, 0) AS correction_count_30d,
  coalesce(cnt.last_count_at, c.last_count_reconcile_at) AS last_count_at,
  CASE
    WHEN coalesce(abs(b.remaining_weight_kg - lm.ledger_remaining_kg) > 0.001, false) THEN 'ledger_cache_mismatch'
    WHEN coalesce(s.shortfall_count_30d, 0) >= 2 THEN 'repeated_shortfall'
    WHEN coalesce(c.correction_count_30d, 0) >= 3 THEN 'recurring_correction'
    WHEN coalesce(cnt.last_count_at, c.last_count_reconcile_at) IS NULL
      OR coalesce(cnt.last_count_at, c.last_count_reconcile_at) < now() - interval '14 days' THEN 'count_due'
    ELSE 'ok'
  END AS review_reason,
  CASE
    WHEN coalesce(abs(b.remaining_weight_kg - lm.ledger_remaining_kg) > 0.001, false)
      OR coalesce(s.shortfall_count_30d, 0) >= 2 THEN 'count_today'
    WHEN coalesce(c.correction_count_30d, 0) >= 2
      OR coalesce(cnt.last_count_at, c.last_count_reconcile_at) IS NULL
      OR coalesce(cnt.last_count_at, c.last_count_reconcile_at) < now() - interval '7 days' THEN 'count_soon'
    ELSE 'trusted'
  END AS operator_signal,
  CASE
    WHEN coalesce(abs(b.remaining_weight_kg - lm.ledger_remaining_kg) > 0.001, false)
      OR coalesce(s.shortfall_count_30d, 0) >= 2 THEN 'Please count ' || p.name || ' today.'
    WHEN coalesce(c.correction_count_30d, 0) >= 2
      OR coalesce(cnt.last_count_at, c.last_count_reconcile_at) IS NULL
      OR coalesce(cnt.last_count_at, c.last_count_reconcile_at) < now() - interval '7 days' THEN 'Please count ' || p.name || ' soon.'
    ELSE 'Stock available.'
  END AS operator_message
FROM public.inventory_batches b
JOIN public.products p ON p.id = b.product_id
LEFT JOIN latest_movement lm ON lm.batch_id = b.id
LEFT JOIN shortfalls s ON s.branch_id = b.branch_id AND s.product_id = b.product_id
LEFT JOIN corrections c ON c.branch_id = b.branch_id AND c.product_id = b.product_id
LEFT JOIN counts cnt ON cnt.branch_id = b.branch_id AND cnt.product_id = b.product_id;

CREATE OR REPLACE VIEW public.inventory_confidence_monitor
WITH (security_invoker = true)
AS
SELECT
  branch_id,
  product_id,
  product_name,
  greatest(
    0,
    100
      - CASE WHEN bool_or(cache_mismatch) THEN 40 ELSE 0 END
      - CASE WHEN max(shortfall_count_30d) >= 2 THEN 30 ELSE max(shortfall_count_30d) * 10 END
      - CASE WHEN max(correction_count_30d) >= 3 THEN 20 ELSE max(correction_count_30d) * 5 END
      - CASE WHEN max(last_count_at) IS NULL THEN 20
             WHEN max(last_count_at) < now() - interval '14 days' THEN 15
             WHEN max(last_count_at) < now() - interval '7 days' THEN 8
             ELSE 0 END
  )::int AS internal_score,
  CASE
    WHEN bool_or(cache_mismatch) OR max(shortfall_count_30d) >= 2 THEN 'count_today'
    WHEN max(correction_count_30d) >= 2 OR max(last_count_at) IS NULL OR max(last_count_at) < now() - interval '7 days' THEN 'count_soon'
    ELSE 'trusted'
  END AS operator_signal,
  array_remove(ARRAY[
    CASE WHEN bool_or(cache_mismatch) THEN 'cache_mismatch' END,
    CASE WHEN max(shortfall_count_30d) >= 2 THEN 'repeated_shortfall' END,
    CASE WHEN max(correction_count_30d) >= 2 THEN 'recurring_correction' END,
    CASE WHEN max(last_count_at) IS NULL OR max(last_count_at) < now() - interval '7 days' THEN 'stale_count' END
  ], NULL) AS internal_reasons
FROM public.inventory_reconciliation_monitor
GROUP BY branch_id, product_id, product_name;

CREATE OR REPLACE VIEW public.inventory_failure_trends
WITH (security_invoker = true)
AS
WITH events AS (
  SELECT branch_id, 'repeated_oversell_flags'::text AS failure_type, count(*)::int AS event_count
  FROM public.order_inventory_depletions
  WHERE created_at >= now() - interval '30 days' AND shortfall_kg > 0
  GROUP BY branch_id
  UNION ALL
  SELECT branch_id, 'repeated_non_weight_tracked_sales'::text AS failure_type, count(*)::int AS event_count
  FROM public.order_inventory_depletions
  WHERE created_at >= now() - interval '30 days' AND non_weight_tracked_lines > 0
  GROUP BY branch_id
  UNION ALL
  SELECT o.branch_id, 'repeated_unmapped_products'::text AS failure_type, count(*)::int AS event_count
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.created_at >= now() - interval '30 days' AND oi.product_id IS NULL
  GROUP BY o.branch_id
  UNION ALL
  SELECT branch_id, 'repeated_depletion_failures'::text AS failure_type, count(*)::int AS event_count
  FROM public.audit_logs
  WHERE created_at >= now() - interval '30 days'
    AND event_type IN ('inventory_reconciliation_issue', 'inventory_failure_trend_detected')
  GROUP BY branch_id
)
SELECT
  branch_id,
  failure_type,
  event_count,
  CASE WHEN event_count >= 3 THEN 'escalate_internal' ELSE 'watch' END AS internal_status
FROM events
WHERE event_count >= 2;

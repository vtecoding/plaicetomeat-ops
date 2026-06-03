-- V6.6 inventory reality: keep expected and actual weights separate while
-- preserving inventory_batches as the single source of stock truth.

ALTER TABLE public.inventory_batches
  ADD COLUMN IF NOT EXISTS expected_weight_kg numeric(8,3),
  ADD COLUMN IF NOT EXISTS actual_weight_kg numeric(8,3),
  ADD COLUMN IF NOT EXISTS actual_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actual_review_note text;

UPDATE public.inventory_batches
SET expected_weight_kg = received_weight_kg
WHERE expected_weight_kg IS NULL;

UPDATE public.inventory_batches
SET actual_weight_kg = received_weight_kg,
    actual_confirmed_at = coalesce(actual_confirmed_at, created_at)
WHERE actual_weight_kg IS NULL;

ALTER TABLE public.inventory_batches
  DROP CONSTRAINT IF EXISTS inventory_batches_expected_weight_check,
  DROP CONSTRAINT IF EXISTS inventory_batches_actual_weight_check;

ALTER TABLE public.inventory_batches
  ADD CONSTRAINT inventory_batches_expected_weight_check
    CHECK (expected_weight_kg IS NULL OR expected_weight_kg >= 0),
  ADD CONSTRAINT inventory_batches_actual_weight_check
    CHECK (actual_weight_kg IS NULL OR actual_weight_kg >= 0);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_actual_review
ON public.inventory_batches(branch_id, actual_confirmed_at)
WHERE status = 'active';

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
  v_existing_batch public.inventory_batches%ROWTYPE;
  v_cost_per_kg numeric;
  v_intake_key text := nullif(btrim(coalesce(p_intake_idempotency_key, '')), '');
  v_remaining_weight_kg numeric := coalesce(p_remaining_weight_kg, p_received_weight_kg);
  v_invoice_cost numeric := coalesce(p_invoice_cost, 0);
  v_expected_weight_kg numeric := coalesce(p_expected_weight_kg, p_received_weight_kg);
  v_halal_cert_ref text := nullif(btrim(coalesce(p_halal_cert_ref, '')), '');
  v_country_of_origin text := nullif(btrim(coalesce(p_country_of_origin, '')), '');
  v_storage_location text := nullif(btrim(coalesce(p_storage_location, '')), '');
  v_batch_number text := nullif(btrim(coalesce(p_batch_number, '')), '');
  v_actual_review_note text := nullif(btrim(coalesce(p_actual_review_note, '')), '');
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

  IF v_expected_weight_kg < 0 THEN
    RAISE EXCEPTION 'Estimated weight cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF v_remaining_weight_kg < 0 OR v_remaining_weight_kg > p_received_weight_kg THEN
    RAISE EXCEPTION 'Stock left cannot exceed the actual weight received.' USING ERRCODE = '22023';
  END IF;

  IF p_expiry_date < p_received_date THEN
    RAISE EXCEPTION 'Expiry date cannot be before received date.' USING ERRCODE = '22023';
  END IF;

  IF v_invoice_cost < 0 THEN
    RAISE EXCEPTION 'Invoice cost must be zero or greater.' USING ERRCODE = '22023';
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
      v_intake_key,
      v_expected_weight_kg,
      p_received_weight_kg,
      now(),
      v_actor,
      v_actual_review_note,
      'active',
      v_actor
    )
    RETURNING id INTO v_batch_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_existing_batch
      FROM public.inventory_batches
      WHERE branch_id = p_branch_id
        AND intake_idempotency_key = v_intake_key;

      IF v_existing_batch.id IS NULL THEN
        RAISE;
      END IF;

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
  END;

  INSERT INTO public.inventory_movements(batch_id, branch_id, movement_type, quantity_kg, reason, created_by)
  VALUES (v_batch_id, p_branch_id, 'RECEIVED', p_received_weight_kg, 'Stock added after actual weight check', v_actor);

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'stock_added', 'inventory_batch', v_batch_id, p_branch_id, v_actor,
    jsonb_build_object(
      'expected_weight_kg', v_expected_weight_kg,
      'actual_weight_kg', p_received_weight_kg,
      'difference_kg', p_received_weight_kg - v_expected_weight_kg,
      'remaining_weight_kg', v_remaining_weight_kg,
      'expiry_date', p_expiry_date,
      'intake_idempotency_key', v_intake_key,
      'review_note', v_actual_review_note
    )
  );

  RETURN v_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_inventory_batch(uuid, uuid, uuid, date, date, numeric, numeric, numeric, text, text, date, text, text, text, numeric, text) TO authenticated;

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

  INSERT INTO public.inventory_movements(batch_id, branch_id, movement_type, quantity_kg, reason, created_by)
  VALUES (p_batch_id, v_batch.branch_id, 'ADJUSTMENT', abs(v_delta), v_reason, v_actor)
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

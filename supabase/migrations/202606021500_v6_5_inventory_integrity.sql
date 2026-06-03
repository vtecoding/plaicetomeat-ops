-- V6.5 inventory integrity: make intake submissions retry-safe and document the
-- cost policy that the owner dashboard now follows.

ALTER TABLE public.inventory_batches
  ADD COLUMN IF NOT EXISTS intake_idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_batches_branch_intake_idempotency
ON public.inventory_batches(branch_id, intake_idempotency_key)
WHERE intake_idempotency_key IS NOT NULL;

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
  p_intake_idempotency_key text DEFAULT NULL
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
  v_halal_cert_ref text := nullif(btrim(coalesce(p_halal_cert_ref, '')), '');
  v_country_of_origin text := nullif(btrim(coalesce(p_country_of_origin, '')), '');
  v_storage_location text := nullif(btrim(coalesce(p_storage_location, '')), '');
  v_batch_number text := nullif(btrim(coalesce(p_batch_number, '')), '');
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
    RAISE EXCEPTION 'Received weight must be greater than zero.' USING ERRCODE = '22023';
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
        RAISE EXCEPTION 'Intake idempotency key already used for a different batch.' USING ERRCODE = '22023';
      END IF;

      RETURN v_existing_batch.id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.inventory_batches (
      branch_id, product_id, supplier_id, received_date, expiry_date,
      received_weight_kg, remaining_weight_kg, invoice_cost, cost_per_kg,
      halal_cert_ref, country_of_origin, slaughter_date, storage_location, batch_number,
      intake_idempotency_key, status, created_by
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
        RAISE EXCEPTION 'Intake idempotency key already used for a different batch.' USING ERRCODE = '22023';
      END IF;

      RETURN v_existing_batch.id;
  END;

  INSERT INTO public.inventory_movements(batch_id, branch_id, movement_type, quantity_kg, reason, created_by)
  VALUES (v_batch_id, p_branch_id, 'RECEIVED', p_received_weight_kg, 'received', v_actor);

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'batch_received', 'inventory_batch', v_batch_id, p_branch_id, v_actor,
    jsonb_build_object(
      'received_weight_kg', p_received_weight_kg,
      'remaining_weight_kg', v_remaining_weight_kg,
      'expiry_date', p_expiry_date,
      'intake_idempotency_key', v_intake_key
    )
  );

  RETURN v_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_inventory_batch(uuid, uuid, uuid, date, date, numeric, numeric, numeric, text, text, date, text, text, text) TO authenticated;

-- V2.1: supplier compliance and inventory batch/waste RPCs.
-- SECURITY DEFINER functions keep writes manager/owner-only, branch-scoped,
-- validated, and auditable without weakening existing RLS.

CREATE OR REPLACE FUNCTION public.admin_upsert_supplier_cert(
  p_supplier_id uuid,
  p_branch_id uuid,
  p_name text,
  p_certifying_body text DEFAULT NULL,
  p_cert_number text DEFAULT NULL,
  p_cert_expiry date DEFAULT NULL,
  p_active boolean DEFAULT true,
  p_document_url text DEFAULT NULL,
  p_verified boolean DEFAULT false,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_supplier public.suppliers%ROWTYPE;
  v_supplier_id uuid;
  v_event text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF length(v_name) = 0 THEN
    RAISE EXCEPTION 'Supplier name is required.' USING ERRCODE = '22023';
  END IF;

  IF p_supplier_id IS NULL THEN
    INSERT INTO public.suppliers (
      branch_id, name, halal_certifying_body, cert_number, cert_expiry, active, notes
    )
    VALUES (
      p_branch_id, v_name, nullif(btrim(coalesce(p_certifying_body, '')), ''),
      nullif(btrim(coalesce(p_cert_number, '')), ''), p_cert_expiry, coalesce(p_active, true),
      nullif(btrim(coalesce(p_notes, '')), '')
    )
    RETURNING id INTO v_supplier_id;
    v_event := 'supplier_created';
  ELSE
    SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_supplier_id;
    IF v_supplier.id IS NULL THEN
      RAISE EXCEPTION 'Supplier not found.' USING ERRCODE = 'P0002';
    END IF;
    IF v_supplier.branch_id IS DISTINCT FROM p_branch_id THEN
      RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.suppliers
    SET name = v_name,
        halal_certifying_body = nullif(btrim(coalesce(p_certifying_body, '')), ''),
        cert_number = nullif(btrim(coalesce(p_cert_number, '')), ''),
        cert_expiry = p_cert_expiry,
        active = coalesce(p_active, true),
        notes = nullif(btrim(coalesce(p_notes, '')), '')
    WHERE id = p_supplier_id;

    v_supplier_id := p_supplier_id;
    v_event := CASE WHEN coalesce(p_active, true) THEN 'supplier_updated' ELSE 'supplier_deactivated' END;
  END IF;

  IF p_document_url IS NOT NULL OR p_cert_expiry IS NOT NULL OR coalesce(p_verified, false) THEN
    INSERT INTO public.supplier_documents (
      supplier_id, document_type, expiry_date, document_url, verified_by, verified_at, notes
    )
    VALUES (
      v_supplier_id, 'halal_cert', p_cert_expiry, coalesce(nullif(btrim(coalesce(p_document_url, '')), ''), 'metadata-only'),
      CASE WHEN coalesce(p_verified, false) THEN v_actor ELSE NULL END,
      CASE WHEN coalesce(p_verified, false) THEN now() ELSE NULL END,
      nullif(btrim(coalesce(p_notes, '')), '')
    );

    INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
    VALUES (
      CASE WHEN coalesce(p_verified, false) THEN 'certificate_verified' ELSE 'certificate_uploaded' END,
      'supplier', v_supplier_id, p_branch_id, v_actor,
      jsonb_build_object('cert_expiry', p_cert_expiry, 'metadata_only', p_document_url IS NULL)
    );
  END IF;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    v_event, 'supplier', v_supplier_id, p_branch_id, v_actor,
    jsonb_build_object('name', v_name, 'active', coalesce(p_active, true))
  );

  RETURN v_supplier_id;
END;
$$;

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
  p_batch_number text DEFAULT NULL
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

  IF p_remaining_weight_kg < 0 OR p_remaining_weight_kg > p_received_weight_kg THEN
    RAISE EXCEPTION 'Remaining weight cannot exceed received weight.' USING ERRCODE = '22023';
  END IF;

  IF p_expiry_date < p_received_date THEN
    RAISE EXCEPTION 'Expiry date cannot be before received date.' USING ERRCODE = '22023';
  END IF;

  IF coalesce(p_invoice_cost, 0) < 0 THEN
    RAISE EXCEPTION 'Invoice cost must be zero or greater.' USING ERRCODE = '22023';
  END IF;

  v_cost_per_kg := CASE WHEN coalesce(p_invoice_cost, 0) = 0 THEN 0 ELSE round(p_invoice_cost / p_received_weight_kg, 2) END;

  INSERT INTO public.inventory_batches (
    branch_id, product_id, supplier_id, received_date, expiry_date,
    received_weight_kg, remaining_weight_kg, invoice_cost, cost_per_kg,
    halal_cert_ref, country_of_origin, slaughter_date, storage_location, batch_number, status
  )
  VALUES (
    p_branch_id, p_product_id, p_supplier_id, p_received_date, p_expiry_date,
    p_received_weight_kg, p_remaining_weight_kg, coalesce(p_invoice_cost, 0), v_cost_per_kg,
    nullif(btrim(coalesce(p_halal_cert_ref, '')), ''),
    nullif(btrim(coalesce(p_country_of_origin, '')), ''),
    p_slaughter_date,
    nullif(btrim(coalesce(p_storage_location, '')), ''),
    nullif(btrim(coalesce(p_batch_number, '')), ''),
    'active'
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.inventory_movements(batch_id, branch_id, movement_type, quantity_kg, reason, created_by)
  VALUES (v_batch_id, p_branch_id, 'RECEIVED', p_received_weight_kg, 'received', v_actor);

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'batch_received', 'inventory_batch', v_batch_id, p_branch_id, v_actor,
    jsonb_build_object('received_weight_kg', p_received_weight_kg, 'expiry_date', p_expiry_date)
  );

  RETURN v_batch_id;
END;
$$;

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
  v_movement_id uuid;
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

  IF v_reason NOT IN ('expired', 'damaged', 'contaminated', 'customer_return', 'other', 'review') THEN
    RAISE EXCEPTION 'Waste reason is required.' USING ERRCODE = '22023';
  END IF;

  v_new_remaining := v_batch.remaining_weight_kg - p_quantity_kg;

  UPDATE public.inventory_batches
  SET remaining_weight_kg = v_new_remaining,
      status = CASE WHEN v_new_remaining = 0 THEN 'disposed' ELSE status END
  WHERE id = p_batch_id;

  INSERT INTO public.inventory_movements(batch_id, branch_id, movement_type, quantity_kg, reason, created_by)
  VALUES (p_batch_id, v_batch.branch_id, 'WASTE', p_quantity_kg, v_reason, v_actor)
  RETURNING id INTO v_movement_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'waste_recorded', 'inventory_batch', p_batch_id, v_batch.branch_id, v_actor,
    jsonb_build_object(
      'quantity_kg', p_quantity_kg,
      'reason', v_reason,
      'estimated_loss', round(p_quantity_kg * coalesce(v_batch.cost_per_kg, 0), 2)
    )
  );

  RETURN v_movement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_supplier_cert(uuid, uuid, text, text, text, date, boolean, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_inventory_batch(uuid, uuid, uuid, date, date, numeric, numeric, numeric, text, text, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_inventory_waste(uuid, numeric, text) TO authenticated;

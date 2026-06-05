--
-- PostgreSQL database dump
--

\restrict bxDzc3S60XDmCaN4hJ8hbceYp4z9sw7mgtetW494jk223OewNTc740bCJ0iES0t

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: add_order_note(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_order_note(p_order_id uuid, p_note text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_note text := btrim(coalesce(p_note, ''));
  v_actor uuid := auth.uid();
  v_note_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF length(v_note) = 0 THEN
    RAISE EXCEPTION 'Note cannot be empty.' USING ERRCODE = '22023';
  END IF;

  IF length(v_note) > 1000 THEN
    RAISE EXCEPTION 'Note is too long (max 1000 characters).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.order_notes (branch_id, order_id, note, created_by)
  VALUES (v_order.branch_id, p_order_id, v_note, v_actor)
  RETURNING id INTO v_note_id;

  RETURN v_note_id;
END;
$$;


--
-- Name: admin_adjust_inventory_remaining(uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_adjust_inventory_remaining(p_batch_id uuid, p_new_remaining_kg numeric, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: admin_commit_product_price_cost(uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_commit_product_price_cost(p_product_id uuid, p_price numeric, p_cost numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_product.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'Price must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  IF p_cost IS NULL OR p_cost < 0 THEN
    RAISE EXCEPTION 'Cost must be zero or more.' USING ERRCODE = '22023';
  END IF;

  IF round(p_price, 2) <> p_price THEN
    RAISE EXCEPTION 'Price must have at most 2 decimal places.' USING ERRCODE = '22023';
  END IF;

  IF round(p_cost, 2) <> p_cost THEN
    RAISE EXCEPTION 'Cost must have at most 2 decimal places.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products
  SET
    price_per_unit = round(p_price, 2),
    cost_per_kg = round(p_cost, 2)
  WHERE id = p_product_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'pricing_committed', 'product', p_product_id, v_product.branch_id, v_actor,
    jsonb_build_object(
      'price_from', v_product.price_per_unit,
      'price_to', round(p_price, 2),
      'cost_from', v_product.cost_per_kg,
      'cost_to', round(p_cost, 2)
    )
  );

  RETURN p_product_id;
END;
$$;


--
-- Name: admin_confirm_carcass_intake(uuid, text, text, uuid, numeric, numeric, integer, date, date, numeric, numeric, numeric, numeric, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_confirm_carcass_intake(p_branch_id uuid, p_animal_type text, p_intake_type text, p_supplier_id uuid, p_received_weight_kg numeric, p_total_cost_gbp numeric, p_days_hung integer, p_received_at date, p_default_expiry_date date, p_processed_weight_kg numeric, p_saleable_weight_kg numeric, p_processing_loss_kg numeric, p_blended_cost_per_kg numeric, p_idempotency_key text, p_notes text, p_cuts jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_intake_id uuid;
  v_cut jsonb;
  v_is_waste boolean;
  v_weight numeric;
  v_cost numeric;
  v_price numeric;
  v_product_id uuid;
  v_batch_id uuid;
  v_stock_count int := 0;
  v_review_count int := 0;
  v_loss_kg numeric := 0;
  v_short text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF p_intake_type IS NULL OR p_intake_type NOT IN ('whole', 'side', 'quarter', 'primal') THEN
    RAISE EXCEPTION 'Intake type is invalid.' USING ERRCODE = '22023';
  END IF;

  IF p_received_weight_kg IS NULL OR p_received_weight_kg <= 0 THEN
    RAISE EXCEPTION 'Received weight must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  IF p_total_cost_gbp IS NULL OR p_total_cost_gbp < 0 THEN
    RAISE EXCEPTION 'Total cost must be zero or greater.' USING ERRCODE = '22023';
  END IF;

  IF p_saleable_weight_kg IS NULL OR p_saleable_weight_kg <= 0 THEN
    RAISE EXCEPTION 'This intake has no saleable cuts.' USING ERRCODE = '22023';
  END IF;

  IF p_default_expiry_date IS NULL OR p_default_expiry_date < p_received_at THEN
    RAISE EXCEPTION 'Expiry date cannot be before the received date.' USING ERRCODE = '22023';
  END IF;

  IF p_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'Supplier not found for this branch.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_cuts) <> 'array' OR jsonb_array_length(p_cuts) = 0 THEN
    RAISE EXCEPTION 'No cuts to confirm.' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.carcass_intakes WHERE branch_id = p_branch_id AND idempotency_key = p_idempotency_key
  ) THEN
    RAISE EXCEPTION 'This intake was already confirmed.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.carcass_intakes (
    branch_id, animal_type, intake_type, supplier_id, received_weight_kg, total_cost_gbp,
    days_hung, received_at, processed_weight_kg, saleable_weight_kg, processing_loss_kg,
    blended_cost_per_kg, status, idempotency_key, notes, confirmed_by, confirmed_at, created_by
  )
  VALUES (
    p_branch_id, p_animal_type, p_intake_type, p_supplier_id, p_received_weight_kg, round(p_total_cost_gbp, 2),
    coalesce(p_days_hung, 0), p_received_at, p_processed_weight_kg, p_saleable_weight_kg, p_processing_loss_kg,
    round(coalesce(p_blended_cost_per_kg, 0), 2), 'confirmed', nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), v_actor, now(), v_actor
  )
  RETURNING id INTO v_intake_id;

  v_short := left(v_intake_id::text, 8);

  FOR v_cut IN SELECT * FROM jsonb_array_elements(p_cuts)
  LOOP
    v_is_waste := coalesce((v_cut->>'is_waste')::boolean, false);
    v_weight := round(coalesce((v_cut->>'expected_weight_kg')::numeric, 0), 3);
    v_cost := nullif(v_cut->>'cost_per_kg', '')::numeric;
    v_price := nullif(v_cut->>'suggested_price_per_kg', '')::numeric;
    v_product_id := nullif(v_cut->>'product_id', '')::uuid;
    v_batch_id := NULL;

    IF v_weight < 0 THEN
      RAISE EXCEPTION 'A cut weight cannot be negative.' USING ERRCODE = '22023';
    END IF;

    IF (NOT v_is_waste) AND v_product_id IS NOT NULL AND v_weight > 0 THEN
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id AND branch_id = p_branch_id) THEN
        RAISE EXCEPTION 'A linked product no longer exists. Recalculate before confirming.' USING ERRCODE = 'P0002';
      END IF;

      INSERT INTO public.inventory_batches (
        branch_id, product_id, supplier_id, received_date, expiry_date,
        received_weight_kg, remaining_weight_kg, invoice_cost, cost_per_kg,
        batch_number, status, notes
      )
      VALUES (
        p_branch_id, v_product_id, p_supplier_id, p_received_at, p_default_expiry_date,
        v_weight, v_weight, round(v_weight * coalesce(p_blended_cost_per_kg, 0), 2),
        round(coalesce(p_blended_cost_per_kg, 0), 2),
        v_short || '-' || (v_cut->>'cut_id'), 'active',
        'Carcass intake ' || v_short || ' (' || p_animal_type || ' ' || p_intake_type || ')'
      )
      RETURNING id INTO v_batch_id;

      INSERT INTO public.inventory_movements (batch_id, branch_id, movement_type, quantity_kg, reference_id, reason, created_by)
      VALUES (v_batch_id, p_branch_id, 'RECEIVED', v_weight, v_intake_id, 'carcass_intake', v_actor);

      IF coalesce((v_cut->>'update_cost')::boolean, false) AND v_cost IS NOT NULL AND v_cost >= 0 THEN
        UPDATE public.products SET cost_per_kg = round(v_cost, 2) WHERE id = v_product_id;
      END IF;

      IF coalesce((v_cut->>'update_price')::boolean, false) AND v_price IS NOT NULL AND v_price > 0 THEN
        UPDATE public.products SET price_per_unit = round(v_price, 2) WHERE id = v_product_id;
      END IF;

      v_stock_count := v_stock_count + 1;
    ELSIF (NOT v_is_waste) AND v_product_id IS NULL AND v_weight > 0 THEN
      v_review_count := v_review_count + 1;
    END IF;

    IF v_is_waste THEN
      v_loss_kg := v_loss_kg + v_weight;
    END IF;

    INSERT INTO public.carcass_intake_cuts (
      intake_id, branch_id, cut_id, cut_name, is_waste, expected_weight_kg,
      cost_per_kg, suggested_price_per_kg, margin_pct, product_id, batch_id
    )
    VALUES (
      v_intake_id, p_branch_id, v_cut->>'cut_id', coalesce(v_cut->>'cut_name', v_cut->>'cut_id'),
      v_is_waste, v_weight, v_cost, v_price, nullif(v_cut->>'margin_pct', '')::numeric,
      v_product_id, v_batch_id
    );
  END LOOP;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'carcass_intake_confirmed', 'carcass_intake', v_intake_id, p_branch_id, v_actor,
    jsonb_build_object(
      'animal_type', p_animal_type,
      'intake_type', p_intake_type,
      'received_weight_kg', p_received_weight_kg,
      'total_cost_gbp', round(p_total_cost_gbp, 2),
      'blended_cost_per_kg', round(coalesce(p_blended_cost_per_kg, 0), 2),
      'stock_batches_created', v_stock_count,
      'cuts_needing_mapping', v_review_count,
      'processing_loss_kg', round(coalesce(v_loss_kg, 0), 3)
    )
  );

  RETURN v_intake_id;
END;
$$;


--
-- Name: admin_create_inventory_batch(uuid, uuid, uuid, date, date, numeric, numeric, numeric, text, text, date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_create_inventory_batch(p_branch_id uuid, p_product_id uuid, p_supplier_id uuid, p_received_date date, p_expiry_date date, p_received_weight_kg numeric, p_remaining_weight_kg numeric, p_invoice_cost numeric DEFAULT 0, p_halal_cert_ref text DEFAULT NULL::text, p_country_of_origin text DEFAULT NULL::text, p_slaughter_date date DEFAULT NULL::date, p_storage_location text DEFAULT NULL::text, p_batch_number text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: admin_create_inventory_batch(uuid, uuid, uuid, date, date, numeric, numeric, numeric, text, text, date, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_create_inventory_batch(p_branch_id uuid, p_product_id uuid, p_supplier_id uuid, p_received_date date, p_expiry_date date, p_received_weight_kg numeric, p_remaining_weight_kg numeric, p_invoice_cost numeric DEFAULT 0, p_halal_cert_ref text DEFAULT NULL::text, p_country_of_origin text DEFAULT NULL::text, p_slaughter_date date DEFAULT NULL::date, p_storage_location text DEFAULT NULL::text, p_batch_number text DEFAULT NULL::text, p_intake_idempotency_key text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: admin_create_inventory_batch(uuid, uuid, uuid, date, date, numeric, numeric, numeric, text, text, date, text, text, text, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_create_inventory_batch(p_branch_id uuid, p_product_id uuid, p_supplier_id uuid, p_received_date date, p_expiry_date date, p_received_weight_kg numeric, p_remaining_weight_kg numeric, p_invoice_cost numeric DEFAULT 0, p_halal_cert_ref text DEFAULT NULL::text, p_country_of_origin text DEFAULT NULL::text, p_slaughter_date date DEFAULT NULL::date, p_storage_location text DEFAULT NULL::text, p_batch_number text DEFAULT NULL::text, p_intake_idempotency_key text DEFAULT NULL::text, p_expected_weight_kg numeric DEFAULT NULL::numeric, p_actual_review_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: admin_create_pickup_window(uuid, text, time without time zone, time without time zone, time without time zone, integer, integer[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_create_pickup_window(p_branch_id uuid, p_label text, p_start_time time without time zone, p_end_time time without time zone, p_cutoff_time time without time zone DEFAULT NULL::time without time zone, p_max_orders integer DEFAULT NULL::integer, p_days_of_week integer[] DEFAULT '{1,2,3,4,5}'::integer[], p_window_type text DEFAULT 'standard'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_label text := btrim(coalesce(p_label, ''));
  v_days int[] := coalesce(p_days_of_week, '{1,2,3,4,5}');
  v_id uuid;
  v_day int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF length(v_label) = 0 THEN
    RAISE EXCEPTION 'Window label is required.' USING ERRCODE = '22023';
  END IF;

  IF p_start_time IS NULL OR p_end_time IS NULL OR p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Start time must be before end time.' USING ERRCODE = '22023';
  END IF;

  IF p_max_orders IS NOT NULL AND p_max_orders < 0 THEN
    RAISE EXCEPTION 'Capacity must be zero or greater.' USING ERRCODE = '22023';
  END IF;

  IF array_length(v_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one day of the week.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_day IN ARRAY v_days LOOP
    IF v_day < 1 OR v_day > 7 THEN
      RAISE EXCEPTION 'Days of week must be between 1 and 7.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_window_type NOT IN ('standard', 'commuter', 'weekend') THEN
    RAISE EXCEPTION 'Window type is invalid.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.pickup_windows (
    branch_id, label, start_time, end_time, cutoff_time, max_orders, days_of_week, window_type, is_active
  )
  VALUES (
    p_branch_id, v_label, p_start_time, p_end_time, p_cutoff_time, p_max_orders, v_days, p_window_type, true
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'pickup_window_created', 'pickup_window', v_id, p_branch_id, v_actor,
    jsonb_build_object('label', v_label, 'start', p_start_time::text, 'end', p_end_time::text)
  );

  RETURN v_id;
END;
$$;


--
-- Name: admin_create_product(uuid, text, text, numeric, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_create_product(p_branch_id uuid, p_name text, p_description text DEFAULT NULL::text, p_price numeric DEFAULT NULL::numeric, p_category_id uuid DEFAULT NULL::uuid, p_unit_type text DEFAULT 'each'::text, p_stock_status text DEFAULT 'in_stock'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_slug text;
  v_suffix int := 1;
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF length(v_name) = 0 THEN
    RAISE EXCEPTION 'Product name is required.' USING ERRCODE = '22023';
  END IF;

  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'Price must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  IF round(p_price, 2) <> p_price THEN
    RAISE EXCEPTION 'Price must have at most 2 decimal places.' USING ERRCODE = '22023';
  END IF;

  IF p_unit_type NOT IN ('kg', 'each', 'box') THEN
    RAISE EXCEPTION 'Unit type must be kg, each, or box.' USING ERRCODE = '22023';
  END IF;

  IF p_stock_status NOT IN ('in_stock', 'low_stock', 'out_of_stock') THEN
    RAISE EXCEPTION 'Stock status is invalid.' USING ERRCODE = '22023';
  END IF;

  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_categories c
    WHERE c.id = p_category_id AND c.branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'Category does not exist for this branch.' USING ERRCODE = '22023';
  END IF;

  v_base := public.slugify(v_name);
  IF v_base = '' THEN
    v_base := 'product';
  END IF;
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.products WHERE branch_id = p_branch_id AND slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix;
  END LOOP;

  INSERT INTO public.products (
    branch_id, category_id, name, slug, description, unit_type,
    price_per_unit, is_available, stock_status, sort_order
  )
  VALUES (
    p_branch_id, p_category_id, v_name, v_slug,
    nullif(btrim(coalesce(p_description, '')), ''), p_unit_type,
    round(p_price, 2), true, p_stock_status, 0
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'product_changed', 'product', v_id, p_branch_id, v_actor,
    jsonb_build_object('action', 'created', 'name', v_name, 'price', round(p_price, 2), 'slug', v_slug)
  );

  RETURN v_id;
END;
$$;


--
-- Name: admin_create_shop_closure(uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_create_shop_closure(p_branch_id uuid, p_close_date date, p_reason text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF p_close_date IS NULL THEN
    RAISE EXCEPTION 'Closure date is required.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.shop_closures (branch_id, close_date, reason, created_by)
  VALUES (p_branch_id, p_close_date, nullif(btrim(coalesce(p_reason, '')), ''), v_actor)
  ON CONFLICT (branch_id, close_date)
  DO UPDATE SET reason = excluded.reason
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'shop_closure_created', 'shop_closure', v_id, p_branch_id, v_actor,
    jsonb_build_object('close_date', p_close_date::text)
  );

  RETURN v_id;
END;
$$;


--
-- Name: admin_record_inventory_waste(uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_record_inventory_waste(p_batch_id uuid, p_quantity_kg numeric, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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

  INSERT INTO public.inventory_movements(batch_id, branch_id, movement_type, quantity_kg, reason, created_by, reference_id)
  VALUES (p_batch_id, v_batch.branch_id, 'WASTE', p_quantity_kg, v_reason, v_actor, v_waste_id);

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


--
-- Name: admin_remove_shop_closure(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_remove_shop_closure(p_closure_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_closure public.shop_closures%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_closure FROM public.shop_closures WHERE id = p_closure_id;
  IF v_closure.id IS NULL THEN
    RAISE EXCEPTION 'Closure not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_closure.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.shop_closures WHERE id = p_closure_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'shop_closure_removed', 'shop_closure', p_closure_id, v_closure.branch_id, v_actor,
    jsonb_build_object('close_date', v_closure.close_date::text)
  );

  RETURN p_closure_id;
END;
$$;


--
-- Name: admin_set_pickup_window_active(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_pickup_window_active(p_window_id uuid, p_is_active boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_window public.pickup_windows%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_window FROM public.pickup_windows WHERE id = p_window_id;
  IF v_window.id IS NULL THEN
    RAISE EXCEPTION 'Pickup window not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_window.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pickup_windows SET is_active = p_is_active WHERE id = p_window_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    CASE WHEN p_is_active THEN 'pickup_window_updated' ELSE 'pickup_window_disabled' END,
    'pickup_window', p_window_id, v_window.branch_id, v_actor,
    jsonb_build_object('is_active', p_is_active)
  );

  RETURN p_window_id;
END;
$$;


--
-- Name: admin_set_product_availability(uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_product_availability(p_product_id uuid, p_is_available boolean, p_stock_status text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
  v_stock text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_product.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  v_stock := coalesce(p_stock_status, CASE WHEN p_is_available THEN 'in_stock' ELSE 'out_of_stock' END);
  IF v_stock NOT IN ('in_stock', 'low_stock', 'out_of_stock') THEN
    RAISE EXCEPTION 'Stock status is invalid.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products
  SET is_available = p_is_available, stock_status = v_stock
  WHERE id = p_product_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'product_availability_changed', 'product', p_product_id, v_product.branch_id, v_actor,
    jsonb_build_object('is_available', p_is_available, 'stock_status', v_stock)
  );

  RETURN p_product_id;
END;
$$;


--
-- Name: admin_set_product_cost(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_product_cost(p_product_id uuid, p_cost numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_product.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF p_cost IS NULL OR p_cost < 0 THEN
    RAISE EXCEPTION 'Cost must be zero or more.' USING ERRCODE = '22023';
  END IF;

  IF round(p_cost, 2) <> p_cost THEN
    RAISE EXCEPTION 'Cost must have at most 2 decimal places.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products SET cost_per_kg = round(p_cost, 2) WHERE id = p_product_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'cost_changed', 'product', p_product_id, v_product.branch_id, v_actor,
    jsonb_build_object('from', v_product.cost_per_kg, 'to', round(p_cost, 2))
  );

  RETURN p_product_id;
END;
$$;


--
-- Name: admin_update_branch_settings(uuid, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_branch_settings(p_branch_id uuid, p_address text, p_sms_ready_template text, p_cancellation_window_minutes integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_address text := btrim(coalesce(p_address, ''));
  v_template text := btrim(coalesce(p_sms_ready_template, ''));
  v_bad_placeholder text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_branch_manager(p_branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF length(v_address) = 0 THEN
    RAISE EXCEPTION 'Branch address is required.' USING ERRCODE = '22023';
  END IF;

  IF length(v_template) = 0 THEN
    RAISE EXCEPTION 'SMS template is required.' USING ERRCODE = '22023';
  END IF;

  SELECT m.parts[1] INTO v_bad_placeholder
  FROM regexp_matches(v_template, '\{([^{}]+)\}', 'g') AS m(parts)
  WHERE m.parts[1] NOT IN ('order_ref', 'address')
  LIMIT 1;

  IF v_bad_placeholder IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported SMS placeholder: {%}.', v_bad_placeholder USING ERRCODE = '22023';
  END IF;

  IF p_cancellation_window_minutes IS NULL OR p_cancellation_window_minutes < 0 THEN
    RAISE EXCEPTION 'Cancellation window must be zero minutes or greater.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.branches SET address = v_address WHERE id = p_branch_id;

  INSERT INTO public.branch_settings(branch_id, sms_ready_template, cancellation_window_minutes)
  VALUES (p_branch_id, v_template, p_cancellation_window_minutes)
  ON CONFLICT (branch_id)
  DO UPDATE SET
    sms_ready_template = excluded.sms_ready_template,
    cancellation_window_minutes = excluded.cancellation_window_minutes;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'branch_settings_updated', 'branch_settings', p_branch_id, p_branch_id, v_actor,
    jsonb_build_object('address_changed', true, 'sms_template_updated', true)
  );

  RETURN p_branch_id;
END;
$$;


--
-- Name: admin_update_pickup_window(uuid, text, time without time zone, time without time zone, time without time zone, integer, integer[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_pickup_window(p_window_id uuid, p_label text, p_start_time time without time zone, p_end_time time without time zone, p_cutoff_time time without time zone DEFAULT NULL::time without time zone, p_max_orders integer DEFAULT NULL::integer, p_days_of_week integer[] DEFAULT NULL::integer[], p_window_type text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_window public.pickup_windows%ROWTYPE;
  v_label text := btrim(coalesce(p_label, ''));
  v_days int[];
  v_type text;
  v_day int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_window FROM public.pickup_windows WHERE id = p_window_id;
  IF v_window.id IS NULL THEN
    RAISE EXCEPTION 'Pickup window not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_window.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF length(v_label) = 0 THEN
    RAISE EXCEPTION 'Window label is required.' USING ERRCODE = '22023';
  END IF;

  IF p_start_time IS NULL OR p_end_time IS NULL OR p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Start time must be before end time.' USING ERRCODE = '22023';
  END IF;

  IF p_max_orders IS NOT NULL AND p_max_orders < 0 THEN
    RAISE EXCEPTION 'Capacity must be zero or greater.' USING ERRCODE = '22023';
  END IF;

  v_days := coalesce(p_days_of_week, v_window.days_of_week);
  IF array_length(v_days, 1) IS NULL THEN
    RAISE EXCEPTION 'Select at least one day of the week.' USING ERRCODE = '22023';
  END IF;
  FOREACH v_day IN ARRAY v_days LOOP
    IF v_day < 1 OR v_day > 7 THEN
      RAISE EXCEPTION 'Days of week must be between 1 and 7.' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_type := coalesce(p_window_type, v_window.window_type);
  IF v_type NOT IN ('standard', 'commuter', 'weekend') THEN
    RAISE EXCEPTION 'Window type is invalid.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.pickup_windows
  SET label = v_label, start_time = p_start_time, end_time = p_end_time,
      cutoff_time = p_cutoff_time, max_orders = p_max_orders, days_of_week = v_days, window_type = v_type
  WHERE id = p_window_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'pickup_window_updated', 'pickup_window', p_window_id, v_window.branch_id, v_actor,
    jsonb_build_object('label', v_label)
  );

  RETURN p_window_id;
END;
$$;


--
-- Name: admin_update_product(uuid, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_product(p_product_id uuid, p_name text, p_description text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_unit_type text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
  v_name text := btrim(coalesce(p_name, ''));
  v_unit text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_product.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF length(v_name) = 0 THEN
    RAISE EXCEPTION 'Product name is required.' USING ERRCODE = '22023';
  END IF;

  v_unit := coalesce(p_unit_type, v_product.unit_type);
  IF v_unit NOT IN ('kg', 'each', 'box') THEN
    RAISE EXCEPTION 'Unit type must be kg, each, or box.' USING ERRCODE = '22023';
  END IF;

  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_categories c
    WHERE c.id = p_category_id AND c.branch_id = v_product.branch_id
  ) THEN
    RAISE EXCEPTION 'Category does not exist for this branch.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products
  SET
    name = v_name,
    description = nullif(btrim(coalesce(p_description, '')), ''),
    category_id = p_category_id,
    unit_type = v_unit
  WHERE id = p_product_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'product_changed', 'product', p_product_id, v_product.branch_id, v_actor,
    jsonb_build_object('action', 'updated', 'name', v_name, 'unit_type', v_unit)
  );

  RETURN p_product_id;
END;
$$;


--
-- Name: admin_update_product_price(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_product_price(p_product_id uuid, p_price numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_manager(v_product.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'Price must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  IF round(p_price, 2) <> p_price THEN
    RAISE EXCEPTION 'Price must have at most 2 decimal places.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products SET price_per_unit = round(p_price, 2) WHERE id = p_product_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'price_changed', 'product', p_product_id, v_product.branch_id, v_actor,
    jsonb_build_object('from', v_product.price_per_unit, 'to', round(p_price, 2))
  );

  RETURN p_product_id;
END;
$$;


--
-- Name: admin_upsert_supplier_cert(uuid, uuid, text, text, text, date, boolean, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_upsert_supplier_cert(p_supplier_id uuid, p_branch_id uuid, p_name text, p_certifying_body text DEFAULT NULL::text, p_cert_number text DEFAULT NULL::text, p_cert_expiry date DEFAULT NULL::date, p_active boolean DEFAULT true, p_document_url text DEFAULT NULL::text, p_verified boolean DEFAULT false, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: cancel_order_by_ref(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_order_by_ref(p_order_ref text, p_reason text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_window_minutes int;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE order_ref = p_order_ref;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.status <> 'incoming' THEN
    RAISE EXCEPTION 'This order can no longer be cancelled online.' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(cancellation_window_minutes, 60) INTO v_window_minutes
  FROM public.branch_settings WHERE branch_id = v_order.branch_id;
  v_window_minutes := coalesce(v_window_minutes, 60);

  IF now() > v_order.created_at + make_interval(mins => v_window_minutes) THEN
    RAISE EXCEPTION 'The online cancellation window has expired.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
  SET status = 'cancelled',
      cancelled_by = 'customer',
      cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
  WHERE id = v_order.id;

  INSERT INTO public.order_status_events (branch_id, order_id, status, note)
  VALUES (v_order.branch_id, v_order.id, 'cancelled', 'Cancelled by customer online.');

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, metadata)
  VALUES (
    'order_status_changed', 'order', v_order.id, v_order.branch_id,
    jsonb_build_object('from', v_order.status, 'to', 'cancelled', 'by', 'customer', 'order_ref', v_order.order_ref)
  );

  RETURN v_order.order_ref;
END;
$$;


--
-- Name: certify_release(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.certify_release(p_release_id uuid, p_hosted_smoke_result text, p_release_report_result text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_release public.release_deployments%ROWTYPE;
  v_verification public.release_verifications%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_certification_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF public.current_profile_role() NOT IN ('manager', 'owner') THEN
    RAISE EXCEPTION 'Not authorised.' USING ERRCODE = '42501';
  END IF;

  IF p_hosted_smoke_result NOT IN ('pending', 'passed', 'failed') OR p_release_report_result NOT IN ('pending', 'passed', 'failed') THEN
    RAISE EXCEPTION 'Invalid certification result.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_release FROM public.release_deployments WHERE id = p_release_id;
  SELECT * INTO v_verification FROM public.release_verifications WHERE release_id = p_release_id;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_actor;

  IF v_release.id IS NULL THEN
    RAISE EXCEPTION 'Release not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_verification.status <> 'passed' THEN
    RAISE EXCEPTION 'Post release verification must pass before certification.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.release_certifications(
    release_id, release_version, commit_sha, migration, hosted_smoke_result,
    release_report_result, verified_by, verified_at
  )
  VALUES (
    v_release.id, v_release.version, v_release.commit_sha, v_release.migration_applied,
    p_hosted_smoke_result, p_release_report_result,
    coalesce(v_profile.full_name, v_profile.email), now()
  )
  RETURNING id INTO v_certification_id;

  RETURN v_certification_id;
END;
$$;


--
-- Name: create_checkout_order(uuid, text, text, text, date, uuid, text, text, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_checkout_order(p_branch_id uuid, p_customer_name text, p_customer_phone text, p_customer_email text, p_pickup_date date, p_pickup_window_id uuid, p_notes text, p_idempotency_key text, p_items jsonb, p_is_test boolean DEFAULT false) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_existing_ref text;
  v_order_id uuid;
  v_order_ref text;
  v_subtotal numeric(10,2);
  v_min_order_value numeric(10,2);
  v_same_day_cutoff time;
  v_window public.pickup_windows%ROWTYPE;
  v_branch_timezone text;
  v_now_local timestamp;
  v_today_local date;
  v_order_count int;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Basket cannot be empty.';
  END IF;

  SELECT order_ref INTO v_existing_ref
  FROM public.orders
  WHERE idempotency_key = p_idempotency_key;

  IF v_existing_ref IS NOT NULL THEN
    RETURN v_existing_ref;
  END IF;

  SELECT timezone INTO v_branch_timezone
  FROM public.branches
  WHERE id = p_branch_id AND is_active = true;

  IF v_branch_timezone IS NULL THEN
    RAISE EXCEPTION 'Branch is not available.';
  END IF;

  SELECT * INTO v_window
  FROM public.pickup_windows
  WHERE id = p_pickup_window_id
    AND branch_id = p_branch_id
    AND is_active = true;

  IF v_window.id IS NULL THEN
    RAISE EXCEPTION 'Pickup window is not available.';
  END IF;

  SELECT
    coalesce(min_order_value, 0),
    coalesce(same_day_cutoff_time, '16:00'::time)
  INTO v_min_order_value, v_same_day_cutoff
  FROM public.branch_settings
  WHERE branch_id = p_branch_id;

  v_min_order_value := coalesce(v_min_order_value, 0);
  v_same_day_cutoff := coalesce(v_same_day_cutoff, '16:00'::time);
  v_now_local := now() AT TIME ZONE v_branch_timezone;
  v_today_local := v_now_local::date;

  IF p_pickup_date < v_today_local THEN
    RAISE EXCEPTION 'Pickup date cannot be in the past.';
  END IF;

  IF p_pickup_date = v_today_local AND v_now_local::time >= v_same_day_cutoff THEN
    RAISE EXCEPTION 'Same-day orders close at 4pm.';
  END IF;

  IF NOT (extract(isodow from p_pickup_date)::int = ANY(v_window.days_of_week)) THEN
    RAISE EXCEPTION 'Pickup window is not available on this date.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.shop_closures
    WHERE branch_id = p_branch_id AND close_date = p_pickup_date
  ) THEN
    RAISE EXCEPTION 'The shop is closed on this pickup date.';
  END IF;

  IF v_window.max_orders IS NOT NULL THEN
    SELECT count(*) INTO v_order_count
    FROM public.orders
    WHERE branch_id = p_branch_id
      AND pickup_date = p_pickup_date
      AND pickup_window_id = p_pickup_window_id
      AND status <> 'cancelled';

    IF v_order_count >= v_window.max_orders THEN
      RAISE EXCEPTION 'This pickup window is full.';
    END IF;
  END IF;

  WITH requested AS (
    SELECT
      (item->>'productId')::uuid AS product_id,
      (item->>'quantity')::numeric AS quantity
    FROM jsonb_array_elements(p_items) AS item
  )
  SELECT sum(round(requested.quantity * products.price_per_unit, 2))::numeric(10,2)
  INTO v_subtotal
  FROM requested
  JOIN public.products products
    ON products.id = requested.product_id
   AND products.branch_id = p_branch_id
  WHERE products.is_available = true
    AND products.stock_status <> 'out_of_stock'
    AND requested.quantity >= products.min_order_quantity
    AND requested.quantity <= coalesce(products.max_order_quantity, 20);

  IF v_subtotal IS NULL THEN
    RAISE EXCEPTION 'One or more basket items are no longer available.';
  END IF;

  IF EXISTS (
    WITH requested AS (
      SELECT
        (item->>'productId')::uuid AS product_id,
        (item->>'quantity')::numeric AS quantity
      FROM jsonb_array_elements(p_items) AS item
    )
    SELECT 1
    FROM requested
    LEFT JOIN public.products products
      ON products.id = requested.product_id
     AND products.branch_id = p_branch_id
    WHERE products.id IS NULL
       OR products.is_available = false
       OR products.stock_status = 'out_of_stock'
       OR requested.quantity < products.min_order_quantity
       OR requested.quantity > coalesce(products.max_order_quantity, 20)
  ) THEN
    RAISE EXCEPTION 'One or more basket items are no longer available.';
  END IF;

  IF v_subtotal < v_min_order_value THEN
    RAISE EXCEPTION 'Minimum order is GBP %.', v_min_order_value;
  END IF;

  v_order_ref := public.next_order_ref(p_branch_id, p_pickup_date);

  INSERT INTO public.orders (
    branch_id,
    order_ref,
    customer_name,
    customer_phone,
    customer_email,
    pickup_window_id,
    pickup_date,
    subtotal,
    notes,
    idempotency_key,
    is_test
  )
  VALUES (
    p_branch_id,
    v_order_ref,
    btrim(p_customer_name),
    p_customer_phone,
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    p_pickup_window_id,
    p_pickup_date,
    v_subtotal,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_idempotency_key,
    coalesce(p_is_test, false)
  )
  RETURNING id INTO v_order_id;

  WITH requested AS (
    SELECT
      (item->>'productId')::uuid AS product_id,
      (item->>'quantity')::numeric AS quantity
    FROM jsonb_array_elements(p_items) AS item
  )
  INSERT INTO public.order_items (
    branch_id,
    order_id,
    product_id,
    product_name_snapshot,
    quantity,
    unit_type,
    unit_price_snapshot,
    line_total
  )
  SELECT
    p_branch_id,
    v_order_id,
    products.id,
    products.name,
    requested.quantity,
    products.unit_type,
    products.price_per_unit,
    round(requested.quantity * products.price_per_unit, 2)
  FROM requested
  JOIN public.products products
    ON products.id = requested.product_id
   AND products.branch_id = p_branch_id;

  INSERT INTO public.order_status_events(branch_id, order_id, status, note)
  VALUES (p_branch_id, v_order_id, 'incoming', 'Order received from checkout.');

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, metadata)
  VALUES (
    'order_created',
    'order',
    v_order_id,
    p_branch_id,
    jsonb_build_object('order_ref', v_order_ref, 'subtotal', v_subtotal, 'is_test', coalesce(p_is_test, false))
  );

  RETURN v_order_ref;
EXCEPTION
  WHEN unique_violation THEN
    SELECT order_ref INTO v_existing_ref
    FROM public.orders
    WHERE idempotency_key = p_idempotency_key;

    IF v_existing_ref IS NOT NULL THEN
      RETURN v_existing_ref;
    END IF;

    RAISE;
END;
$$;


--
-- Name: create_release_deployment(text, text, text, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_release_deployment(p_version text, p_commit_sha text, p_migration_applied text, p_gate_results jsonb, p_deployer text, p_release_notes text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_release_id uuid;
  v_verification_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF public.current_profile_role() NOT IN ('manager', 'owner') THEN
    RAISE EXCEPTION 'Not authorised.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.release_deployments(
    version, commit_sha, migration_applied, gate_results, deployer, release_notes
  )
  VALUES (
    btrim(p_version), btrim(p_commit_sha), nullif(btrim(coalesce(p_migration_applied, '')), ''),
    coalesce(p_gate_results, '{}'), nullif(btrim(coalesce(p_deployer, '')), ''),
    nullif(btrim(coalesce(p_release_notes, '')), '')
  )
  RETURNING id INTO v_release_id;

  INSERT INTO public.release_verifications(release_id)
  VALUES (v_release_id)
  RETURNING id INTO v_verification_id;

  PERFORM public.ensure_release_verification_items(v_verification_id);

  INSERT INTO public.audit_logs(event_type, target_type, target_id, actor_id, metadata)
  VALUES (
    'release_deployed', 'release_deployment', v_release_id, v_actor,
    jsonb_build_object('version', p_version, 'commit_sha', p_commit_sha)
  );

  RETURN v_release_id;
END;
$$;


--
-- Name: current_profile_branch_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_profile_branch_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT branch_id FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;


--
-- Name: current_profile_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_profile_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$;


--
-- Name: ensure_release_verification_items(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_release_verification_items(p_verification_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.release_verification_items(verification_id, label, sort_order)
  VALUES
    (p_verification_id, 'Admin login', 10),
    (p_verification_id, 'Shop ordering', 20),
    (p_verification_id, 'Counter updates', 30),
    (p_verification_id, 'Inventory creation', 40),
    (p_verification_id, 'Waste recording', 50),
    (p_verification_id, 'Supplier certificate', 60),
    (p_verification_id, 'Audit log creation', 70)
  ON CONFLICT (verification_id, label) DO NOTHING;
END;
$$;


--
-- Name: get_applied_migration_versions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_applied_migration_versions() RETURNS TABLE(version text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'supabase_migrations'
    AS $$
  SELECT sm.version::text
  FROM supabase_migrations.schema_migrations sm
  ORDER BY sm.version::text;
$$;


--
-- Name: get_migration_health(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_migration_health() RETURNS TABLE(expected_version text, migration_name text, applied boolean)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'supabase_migrations'
    AS $$
  SELECT
    e.version AS expected_version,
    e.name AS migration_name,
    EXISTS (
      SELECT 1
      FROM supabase_migrations.schema_migrations sm
      WHERE sm.version::text = e.version
    ) AS applied
  FROM public.expected_migrations e
  WHERE e.required = true
  ORDER BY e.version;
$$;


--
-- Name: get_public_order(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_order(target_order_ref text) RETURNS TABLE(order_ref text, customer_name text, status text, pickup_date date, pickup_window_label text, pickup_window_start time without time zone, pickup_window_end time without time zone, subtotal numeric, ready_sms_sent_at timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    o.order_ref,
    o.customer_name,
    o.status,
    o.pickup_date,
    pw.label,
    pw.start_time,
    pw.end_time,
    o.subtotal,
    o.ready_sms_sent_at,
    o.created_at
  FROM public.orders o
  LEFT JOIN public.pickup_windows pw ON pw.id = o.pickup_window_id
  WHERE o.order_ref = target_order_ref
  LIMIT 1;
$$;


--
-- Name: is_branch_manager(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_branch_manager(target_branch_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.role IN ('manager', 'owner')
      AND (p.role = 'owner' OR p.branch_id = target_branch_id)
  );
$$;


--
-- Name: is_branch_staff(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_branch_staff(target_branch_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.role IN ('staff', 'manager', 'owner')
      AND (p.role = 'owner' OR p.branch_id = target_branch_id)
  );
$$;


--
-- Name: mirror_audit_log_to_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mirror_audit_log_to_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_summary text;
BEGIN
  IF NEW.actor_id IS NOT NULL THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = NEW.actor_id;
  END IF;

  v_summary := replace(coalesce(NEW.event_type, 'event'), '_', ' ');

  INSERT INTO public.audit_events (
    actor_user_id, actor_email, actor_role, event_type, entity_type, entity_id, summary, metadata
  )
  VALUES (
    NEW.actor_id,
    v_profile.email,
    v_profile.role,
    NEW.event_type,
    NEW.target_type,
    NEW.target_id,
    v_summary,
    coalesce(NEW.metadata, '{}')
  );

  RETURN NEW;
END;
$$;


--
-- Name: next_order_ref(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_order_ref(target_branch_id uuid, target_date date) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  next_sequence int;
  target_year int := extract(year from target_date)::int;
BEGIN
  INSERT INTO public.order_annual_sequences(branch_id, order_year, last_sequence)
  VALUES (target_branch_id, target_year, 1)
  ON CONFLICT (branch_id, order_year)
  DO UPDATE SET last_sequence = public.order_annual_sequences.last_sequence + 1
  RETURNING last_sequence INTO next_sequence;

  RETURN 'PTM-' || target_year::text || '-' || lpad(next_sequence::text, 5, '0');
END;
$$;


--
-- Name: ops_apply_stock_count_line(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_apply_stock_count_line(p_session_id uuid, p_line_id uuid, p_reason text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: ops_complete_session(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_complete_session(p_session_id uuid, p_source text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: ops_record_step(uuid, text, text, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_record_step(p_session_id uuid, p_step_key text, p_state text, p_payload jsonb DEFAULT '{}'::jsonb, p_source text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: ops_record_stock_count_line(uuid, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_record_stock_count_line(p_session_id uuid, p_batch_id uuid, p_counted_weight_kg numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: ops_start_or_resume_session(uuid, text, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_start_or_resume_session(p_branch_id uuid, p_kind text, p_business_date date DEFAULT NULL::date, p_source text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: prevent_audit_events_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_audit_events_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;


--
-- Name: prevent_audit_log_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_audit_log_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$;


--
-- Name: prevent_release_certification_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_release_certification_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'release certifications are immutable';
END;
$$;


--
-- Name: record_sms_attempt(uuid, text, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_sms_attempt(p_order_id uuid, p_event_type text, p_status text, p_template_key text DEFAULT NULL::text, p_recipient_redacted text DEFAULT NULL::text, p_message_preview text DEFAULT NULL::text, p_provider_response text DEFAULT NULL::text, p_failure_reason text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_log_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF p_status NOT IN ('disabled', 'not_required', 'queued', 'dry_run', 'sent', 'failed') THEN
    RAISE EXCEPTION 'Unknown SMS status: %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.sms_log (
    branch_id, order_id, event_type, status, template_key, recipient_redacted,
    message_preview, provider_response, failure_reason, actor_id, is_test
  )
  VALUES (
    v_order.branch_id, p_order_id, p_event_type, p_status, p_template_key, p_recipient_redacted,
    p_message_preview, p_provider_response, p_failure_reason, v_actor, v_order.is_test
  )
  RETURNING id INTO v_log_id;

  UPDATE public.orders
  SET
    sms_status = p_status,
    sms_failure_reason = CASE WHEN p_status = 'failed' THEN p_failure_reason ELSE NULL END,
    ready_sms_sent_at = CASE
      WHEN p_status = 'sent' AND p_event_type = 'ready' THEN now()
      ELSE ready_sms_sent_at
    END
  WHERE id = p_order_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'sms_attempt', 'order', p_order_id, v_order.branch_id, v_actor,
    jsonb_build_object('sms_status', p_status, 'sms_event', p_event_type, 'is_test', v_order.is_test)
  );

  RETURN v_log_id;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: slugify(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.slugify(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-');
$$;


--
-- Name: transition_order_status(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transition_order_status(p_order_id uuid, p_next_status text, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event_id uuid;
  v_actor uuid := auth.uid();
  v_allowed boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF p_next_status NOT IN ('incoming', 'prepping', 'ready', 'collected', 'cancelled') THEN
    RAISE EXCEPTION 'Unknown order status: %', p_next_status USING ERRCODE = '22023';
  END IF;

  -- RLS on orders restricts this SELECT to the caller's branch, so an order in
  -- another branch simply appears as "not found" -> no cross-branch mutation.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  v_allowed := CASE
    WHEN v_order.status = 'incoming' AND p_next_status IN ('prepping', 'cancelled') THEN true
    WHEN v_order.status = 'prepping' AND p_next_status IN ('ready', 'cancelled') THEN true
    WHEN v_order.status = 'ready' AND p_next_status IN ('collected', 'cancelled') THEN true
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid transition from % to %.', v_order.status, p_next_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
  SET
    status = p_next_status,
    cancelled_by = CASE WHEN p_next_status = 'cancelled' THEN 'staff' ELSE cancelled_by END,
    cancellation_reason = CASE
      WHEN p_next_status = 'cancelled' THEN nullif(btrim(coalesce(p_note, '')), '')
      ELSE cancellation_reason
    END
  WHERE id = p_order_id;

  INSERT INTO public.order_status_events (branch_id, order_id, status, actor_id, note)
  VALUES (v_order.branch_id, p_order_id, p_next_status, v_actor, nullif(btrim(coalesce(p_note, '')), ''))
  RETURNING id INTO v_event_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'order_status_changed',
    'order',
    p_order_id,
    v_order.branch_id,
    v_actor,
    jsonb_build_object('from', v_order.status, 'to', p_next_status, 'order_ref', v_order.order_ref)
  );

  RETURN v_event_id;
END;
$$;


--
-- Name: update_release_verification_item(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_release_verification_item(p_item_id uuid, p_status text, p_notes text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_verification_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  IF public.current_profile_role() NOT IN ('manager', 'owner') THEN
    RAISE EXCEPTION 'Not authorised.' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('pending', 'passed', 'failed') THEN
    RAISE EXCEPTION 'Invalid verification status.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.release_verification_items
  SET status = p_status,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      checked_at = CASE WHEN p_status = 'pending' THEN NULL ELSE now() END,
      checked_by = CASE WHEN p_status = 'pending' THEN NULL ELSE v_actor END
  WHERE id = p_item_id
  RETURNING verification_id INTO v_verification_id;

  UPDATE public.release_verifications rv
  SET status = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.release_verification_items i
          WHERE i.verification_id = rv.id AND i.status = 'failed'
        ) THEN 'failed'
        WHEN EXISTS (
          SELECT 1 FROM public.release_verification_items i
          WHERE i.verification_id = rv.id AND i.status <> 'passed'
        ) THEN 'pending'
        ELSE 'passed'
      END,
      verifier = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.release_verification_items i
          WHERE i.verification_id = rv.id AND i.status <> 'passed'
        ) THEN v_actor ELSE verifier
      END,
      verified_at = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.release_verification_items i
          WHERE i.verification_id = rv.id AND i.status <> 'passed'
        ) THEN now() ELSE verified_at
      END
  WHERE rv.id = v_verification_id;

  RETURN p_item_id;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_user_id uuid,
    actor_email text,
    actor_role text,
    event_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    summary text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address inet,
    user_agent text
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    actor_id uuid,
    event_type text NOT NULL,
    target_type text NOT NULL,
    target_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: branch_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    sms_ready_template text DEFAULT 'Your PlaiceToMeat order {order_ref} is ready at {address}. Please collect during your pickup window. Reply HERE when you arrive.'::text NOT NULL,
    cancellation_window_minutes integer DEFAULT 60 NOT NULL,
    max_orders_per_day integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    min_order_value numeric(10,2) DEFAULT 0 NOT NULL,
    same_day_cutoff_time time without time zone DEFAULT '16:00:00'::time without time zone NOT NULL,
    staff_session_timeout_minutes integer DEFAULT 240 NOT NULL
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    address text NOT NULL,
    phone text,
    timezone text DEFAULT 'Europe/London'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: carcass_intake_cuts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carcass_intake_cuts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    intake_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    cut_id text NOT NULL,
    cut_name text NOT NULL,
    is_waste boolean DEFAULT false NOT NULL,
    expected_weight_kg numeric(8,3) NOT NULL,
    cost_per_kg numeric(10,2),
    suggested_price_per_kg numeric(10,2),
    margin_pct numeric(5,2),
    product_id uuid,
    batch_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT carcass_intake_cuts_expected_weight_kg_check CHECK ((expected_weight_kg >= (0)::numeric))
);


--
-- Name: carcass_intakes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carcass_intakes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    animal_type text NOT NULL,
    intake_type text NOT NULL,
    supplier_id uuid,
    received_weight_kg numeric(8,3) NOT NULL,
    total_cost_gbp numeric(10,2) NOT NULL,
    days_hung integer DEFAULT 0 NOT NULL,
    received_at date NOT NULL,
    processed_weight_kg numeric(8,3),
    saleable_weight_kg numeric(8,3),
    processing_loss_kg numeric(8,3),
    blended_cost_per_kg numeric(10,2),
    status text DEFAULT 'confirmed'::text NOT NULL,
    idempotency_key text,
    notes text,
    confirmed_by uuid,
    confirmed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT carcass_intakes_days_hung_check CHECK ((days_hung >= 0)),
    CONSTRAINT carcass_intakes_intake_type_check CHECK ((intake_type = ANY (ARRAY['whole'::text, 'side'::text, 'quarter'::text, 'primal'::text]))),
    CONSTRAINT carcass_intakes_received_weight_kg_check CHECK ((received_weight_kg > (0)::numeric)),
    CONSTRAINT carcass_intakes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'cancelled'::text]))),
    CONSTRAINT carcass_intakes_total_cost_gbp_check CHECK ((total_cost_gbp >= (0)::numeric))
);


--
-- Name: compliance_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    log_date date NOT NULL,
    opened_by uuid NOT NULL,
    closed_by uuid,
    cleaning_completed boolean DEFAULT false,
    sanitisation_completed boolean DEFAULT false,
    waste_checked boolean DEFAULT false,
    notes text,
    status text DEFAULT 'open'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT compliance_logs_status_check CHECK ((status = ANY (ARRAY['open'::text, 'completed'::text])))
);


--
-- Name: compliance_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    compliance_log_id uuid NOT NULL,
    reading_type text NOT NULL,
    chiller_temp_c numeric(4,1) NOT NULL,
    freezer_temp_c numeric(4,1) NOT NULL,
    display_temp_c numeric(4,1),
    recorded_by uuid NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT compliance_readings_reading_type_check CHECK ((reading_type = ANY (ARRAY['opening'::text, 'midday'::text, 'closing'::text, 'ad_hoc'::text])))
);


--
-- Name: expected_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expected_migrations (
    version text NOT NULL,
    name text NOT NULL,
    required boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    supplier_id uuid,
    branch_id uuid NOT NULL,
    received_date date NOT NULL,
    expiry_date date NOT NULL,
    received_weight_kg numeric(8,3) NOT NULL,
    remaining_weight_kg numeric(8,3) NOT NULL,
    invoice_cost numeric(8,2),
    cost_per_kg numeric(8,2),
    halal_cert_ref text,
    country_of_origin text,
    slaughter_date date,
    storage_location text,
    batch_number text,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    supplier_batch_number text,
    manual_adjustment_reason text,
    intake_idempotency_key text,
    expected_weight_kg numeric(8,3),
    actual_weight_kg numeric(8,3),
    actual_confirmed_at timestamp with time zone,
    actual_confirmed_by uuid,
    actual_review_note text,
    CONSTRAINT inventory_batches_actual_weight_check CHECK (((actual_weight_kg IS NULL) OR (actual_weight_kg >= (0)::numeric))),
    CONSTRAINT inventory_batches_expected_weight_check CHECK (((expected_weight_kg IS NULL) OR (expected_weight_kg >= (0)::numeric))),
    CONSTRAINT inventory_batches_received_weight_kg_check CHECK ((received_weight_kg >= (0)::numeric)),
    CONSTRAINT inventory_batches_remaining_weight_kg_check CHECK ((remaining_weight_kg >= (0)::numeric)),
    CONSTRAINT inventory_batches_status_check CHECK ((status = ANY (ARRAY['active'::text, 'depleted'::text, 'disposed'::text, 'recalled'::text])))
);


--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    movement_type text NOT NULL,
    quantity_kg numeric(8,3) NOT NULL,
    reference_id uuid,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inventory_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['RECEIVED'::text, 'SALE'::text, 'WASTE'::text, 'TRANSFER'::text, 'ADJUSTMENT'::text]))),
    CONSTRAINT inventory_movements_quantity_kg_check CHECK ((quantity_kg > (0)::numeric))
);


--
-- Name: inventory_waste_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_waste_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    product_id uuid NOT NULL,
    waste_kg numeric(8,3) NOT NULL,
    reason text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT inventory_waste_events_waste_kg_check CHECK ((waste_kg > (0)::numeric))
);


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    ip_address inet,
    success boolean DEFAULT false NOT NULL,
    locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ops_checklist_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_checklist_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    step_key text NOT NULL,
    state text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    actor_id uuid,
    source text,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_checklist_events_state_check CHECK ((state = ANY (ARRAY['done'::text, 'skipped'::text, 'na'::text])))
);


--
-- Name: ops_checklist_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_checklist_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    kind text NOT NULL,
    business_date date NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    started_by uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_by uuid,
    completed_at timestamp with time zone,
    source text,
    CONSTRAINT ops_checklist_sessions_kind_check CHECK ((kind = ANY (ARRAY['opening'::text, 'closing'::text, 'stock_count'::text]))),
    CONSTRAINT ops_checklist_sessions_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'abandoned'::text])))
);


--
-- Name: order_annual_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_annual_sequences (
    branch_id uuid NOT NULL,
    order_year integer NOT NULL,
    last_sequence integer DEFAULT 0 NOT NULL
);


--
-- Name: order_daily_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_daily_sequences (
    branch_id uuid NOT NULL,
    order_date date NOT NULL,
    last_sequence integer DEFAULT 0 NOT NULL
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    product_name_snapshot text NOT NULL,
    quantity numeric(10,3) NOT NULL,
    unit_type text NOT NULL,
    unit_price_snapshot numeric(10,2) NOT NULL,
    line_total numeric(10,2) NOT NULL,
    staff_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: order_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    order_id uuid NOT NULL,
    note text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT order_notes_note_check CHECK ((char_length(note) <= 1000))
);

ALTER TABLE ONLY public.order_notes REPLICA IDENTITY FULL;


--
-- Name: order_status_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_status_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    order_id uuid NOT NULL,
    status text NOT NULL,
    actor_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT order_status_events_status_check CHECK ((status = ANY (ARRAY['incoming'::text, 'prepping'::text, 'ready'::text, 'collected'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.order_status_events REPLICA IDENTITY FULL;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    order_ref text NOT NULL,
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    customer_email text,
    status text DEFAULT 'incoming'::text,
    pickup_window_id uuid,
    pickup_date date NOT NULL,
    subtotal numeric(10,2) NOT NULL,
    payment_method text,
    notes text,
    cancellation_reason text,
    cancelled_by text,
    ready_sms_sent_at timestamp with time zone,
    idempotency_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_test boolean DEFAULT false NOT NULL,
    sms_status text,
    sms_failure_reason text,
    CONSTRAINT orders_cancelled_by_check CHECK ((cancelled_by = ANY (ARRAY['customer'::text, 'staff'::text, 'system'::text]))),
    CONSTRAINT orders_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'card'::text, 'online'::text]))),
    CONSTRAINT orders_sms_status_check CHECK ((sms_status = ANY (ARRAY['disabled'::text, 'not_required'::text, 'queued'::text, 'dry_run'::text, 'sent'::text, 'failed'::text]))),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['incoming'::text, 'prepping'::text, 'ready'::text, 'collected'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.orders REPLICA IDENTITY FULL;


--
-- Name: pickup_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pickup_windows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    label text NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    cutoff_time time without time zone,
    max_orders integer,
    days_of_week integer[] DEFAULT '{1,2,3,4,5,6}'::integer[] NOT NULL,
    window_type text DEFAULT 'standard'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT pickup_windows_window_type_check CHECK ((window_type = ANY (ARRAY['standard'::text, 'commuter'::text, 'weekend'::text])))
);


--
-- Name: product_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    category_id uuid,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    unit_type text,
    price_per_unit numeric(10,2) NOT NULL,
    min_order_quantity numeric(10,3) DEFAULT 0.5,
    max_order_quantity numeric(10,3),
    image_url text,
    is_available boolean DEFAULT true,
    stock_status text DEFAULT 'in_stock'::text,
    requires_weight_confirmation boolean DEFAULT false,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cost_per_kg numeric(10,2),
    CONSTRAINT products_stock_status_check CHECK ((stock_status = ANY (ARRAY['in_stock'::text, 'low_stock'::text, 'out_of_stock'::text]))),
    CONSTRAINT products_unit_type_check CHECK ((unit_type = ANY (ARRAY['kg'::text, 'each'::text, 'box'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    branch_id uuid,
    email text NOT NULL,
    full_name text,
    role text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['staff'::text, 'manager'::text, 'owner'::text])))
);


--
-- Name: release_certifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_certifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    release_id uuid NOT NULL,
    release_version text NOT NULL,
    commit_sha text NOT NULL,
    migration text,
    hosted_smoke_result text NOT NULL,
    release_report_result text NOT NULL,
    verified_by text,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT release_certifications_hosted_smoke_result_check CHECK ((hosted_smoke_result = ANY (ARRAY['pending'::text, 'passed'::text, 'failed'::text]))),
    CONSTRAINT release_certifications_release_report_result_check CHECK ((release_report_result = ANY (ARRAY['pending'::text, 'passed'::text, 'failed'::text])))
);


--
-- Name: release_deployments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_deployments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version text NOT NULL,
    commit_sha text NOT NULL,
    deployed_at timestamp with time zone DEFAULT now() NOT NULL,
    migration_applied text,
    deployer text,
    release_notes text,
    gate_results jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: release_verification_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_verification_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    verification_id uuid NOT NULL,
    label text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    checked_at timestamp with time zone,
    checked_by uuid,
    notes text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT release_verification_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'passed'::text, 'failed'::text])))
);


--
-- Name: release_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    release_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    verifier uuid,
    verifier_name text,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT release_verifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'passed'::text, 'failed'::text])))
);


--
-- Name: shop_closures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shop_closures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    close_date date NOT NULL,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: sms_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    order_id uuid,
    event_type text NOT NULL,
    status text NOT NULL,
    template_key text,
    recipient_redacted text,
    message_preview text,
    provider_response text,
    failure_reason text,
    actor_id uuid,
    is_test boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sms_log_status_check CHECK ((status = ANY (ARRAY['disabled'::text, 'not_required'::text, 'queued'::text, 'dry_run'::text, 'sent'::text, 'failed'::text])))
);

ALTER TABLE ONLY public.sms_log REPLICA IDENTITY FULL;


--
-- Name: sms_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid NOT NULL,
    template_key text NOT NULL,
    body text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: stock_count_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_count_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    system_weight_kg numeric NOT NULL,
    counted_weight_kg numeric NOT NULL,
    correction_movement_id uuid,
    applied_at timestamp with time zone,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stock_levels; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.stock_levels WITH (security_invoker='true') AS
 SELECT product_id,
    branch_id,
    (sum(remaining_weight_kg))::numeric(8,3) AS total_kg,
    (count(*))::integer AS batches_count,
    min(expiry_date) AS earliest_expiry,
    max(updated_at) AS updated_at
   FROM public.inventory_batches
  WHERE (status = 'active'::text)
  GROUP BY product_id, branch_id;


--
-- Name: supplier_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    document_type text NOT NULL,
    issued_date date,
    expiry_date date,
    document_url text NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT supplier_documents_document_type_check CHECK ((document_type = ANY (ARRAY['halal_cert'::text, 'health_cert'::text, 'insurance'::text, 'lab_test'::text, 'invoice'::text, 'other'::text])))
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    name text NOT NULL,
    contact_name text,
    phone text,
    email text,
    address text,
    halal_certifying_body text,
    cert_number text,
    cert_expiry date,
    payment_terms text,
    preferred boolean DEFAULT false,
    reliability_score numeric(3,1),
    active boolean DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: branch_settings branch_settings_branch_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_settings
    ADD CONSTRAINT branch_settings_branch_id_key UNIQUE (branch_id);


--
-- Name: branch_settings branch_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_settings
    ADD CONSTRAINT branch_settings_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: branches branches_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_slug_key UNIQUE (slug);


--
-- Name: carcass_intake_cuts carcass_intake_cuts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carcass_intake_cuts
    ADD CONSTRAINT carcass_intake_cuts_pkey PRIMARY KEY (id);


--
-- Name: carcass_intakes carcass_intakes_branch_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carcass_intakes
    ADD CONSTRAINT carcass_intakes_branch_id_idempotency_key_key UNIQUE (branch_id, idempotency_key);


--
-- Name: carcass_intakes carcass_intakes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carcass_intakes
    ADD CONSTRAINT carcass_intakes_pkey PRIMARY KEY (id);


--
-- Name: compliance_logs compliance_logs_branch_id_log_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_logs
    ADD CONSTRAINT compliance_logs_branch_id_log_date_key UNIQUE (branch_id, log_date);


--
-- Name: compliance_logs compliance_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_logs
    ADD CONSTRAINT compliance_logs_pkey PRIMARY KEY (id);


--
-- Name: compliance_readings compliance_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_readings
    ADD CONSTRAINT compliance_readings_pkey PRIMARY KEY (id);


--
-- Name: expected_migrations expected_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expected_migrations
    ADD CONSTRAINT expected_migrations_pkey PRIMARY KEY (version);


--
-- Name: inventory_batches inventory_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_pkey PRIMARY KEY (id);


--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- Name: inventory_waste_events inventory_waste_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_waste_events
    ADD CONSTRAINT inventory_waste_events_pkey PRIMARY KEY (id);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (id);


--
-- Name: ops_checklist_events ops_checklist_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_checklist_events
    ADD CONSTRAINT ops_checklist_events_pkey PRIMARY KEY (id);


--
-- Name: ops_checklist_sessions ops_checklist_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_checklist_sessions
    ADD CONSTRAINT ops_checklist_sessions_pkey PRIMARY KEY (id);


--
-- Name: order_annual_sequences order_annual_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_annual_sequences
    ADD CONSTRAINT order_annual_sequences_pkey PRIMARY KEY (branch_id, order_year);


--
-- Name: order_daily_sequences order_daily_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_daily_sequences
    ADD CONSTRAINT order_daily_sequences_pkey PRIMARY KEY (branch_id, order_date);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_notes order_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_notes
    ADD CONSTRAINT order_notes_pkey PRIMARY KEY (id);


--
-- Name: order_status_events order_status_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_events
    ADD CONSTRAINT order_status_events_pkey PRIMARY KEY (id);


--
-- Name: orders orders_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: orders orders_order_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_ref_key UNIQUE (order_ref);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: pickup_windows pickup_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_windows
    ADD CONSTRAINT pickup_windows_pkey PRIMARY KEY (id);


--
-- Name: product_categories product_categories_branch_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_branch_id_slug_key UNIQUE (branch_id, slug);


--
-- Name: product_categories product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);


--
-- Name: products products_branch_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_branch_id_slug_key UNIQUE (branch_id, slug);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: release_certifications release_certifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_certifications
    ADD CONSTRAINT release_certifications_pkey PRIMARY KEY (id);


--
-- Name: release_certifications release_certifications_release_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_certifications
    ADD CONSTRAINT release_certifications_release_id_key UNIQUE (release_id);


--
-- Name: release_deployments release_deployments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_deployments
    ADD CONSTRAINT release_deployments_pkey PRIMARY KEY (id);


--
-- Name: release_verification_items release_verification_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_verification_items
    ADD CONSTRAINT release_verification_items_pkey PRIMARY KEY (id);


--
-- Name: release_verification_items release_verification_items_verification_id_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_verification_items
    ADD CONSTRAINT release_verification_items_verification_id_label_key UNIQUE (verification_id, label);


--
-- Name: release_verifications release_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_verifications
    ADD CONSTRAINT release_verifications_pkey PRIMARY KEY (id);


--
-- Name: release_verifications release_verifications_release_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_verifications
    ADD CONSTRAINT release_verifications_release_id_key UNIQUE (release_id);


--
-- Name: shop_closures shop_closures_branch_id_close_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_closures
    ADD CONSTRAINT shop_closures_branch_id_close_date_key UNIQUE (branch_id, close_date);


--
-- Name: shop_closures shop_closures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_closures
    ADD CONSTRAINT shop_closures_pkey PRIMARY KEY (id);


--
-- Name: sms_log sms_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_log
    ADD CONSTRAINT sms_log_pkey PRIMARY KEY (id);


--
-- Name: sms_templates sms_templates_branch_id_template_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_templates
    ADD CONSTRAINT sms_templates_branch_id_template_key_key UNIQUE (branch_id, template_key);


--
-- Name: sms_templates sms_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_templates
    ADD CONSTRAINT sms_templates_pkey PRIMARY KEY (id);


--
-- Name: stock_count_lines stock_count_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_count_lines
    ADD CONSTRAINT stock_count_lines_pkey PRIMARY KEY (id);


--
-- Name: supplier_documents supplier_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_documents
    ADD CONSTRAINT supplier_documents_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: idx_audit_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_created ON public.audit_events USING btree (created_at DESC);


--
-- Name: idx_audit_events_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_entity ON public.audit_events USING btree (entity_type, entity_id);


--
-- Name: idx_audit_events_event_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_event_created ON public.audit_events USING btree (event_type, created_at DESC);


--
-- Name: idx_audit_logs_branch_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_branch_created ON public.audit_logs USING btree (branch_id, created_at DESC);


--
-- Name: idx_audit_logs_event_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_event_created ON public.audit_logs USING btree (event_type, created_at DESC);


--
-- Name: idx_carcass_intake_cuts_intake; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carcass_intake_cuts_intake ON public.carcass_intake_cuts USING btree (intake_id);


--
-- Name: idx_carcass_intake_cuts_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carcass_intake_cuts_product ON public.carcass_intake_cuts USING btree (product_id);


--
-- Name: idx_carcass_intakes_branch_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_carcass_intakes_branch_received ON public.carcass_intakes USING btree (branch_id, received_at DESC);


--
-- Name: idx_compliance_logs_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_logs_branch_date ON public.compliance_logs USING btree (branch_id, log_date);


--
-- Name: idx_compliance_readings_log; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_readings_log ON public.compliance_readings USING btree (compliance_log_id, reading_type);


--
-- Name: idx_inventory_batches_actual_review; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_batches_actual_review ON public.inventory_batches USING btree (branch_id, actual_confirmed_at) WHERE (status = 'active'::text);


--
-- Name: idx_inventory_batches_branch_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_batches_branch_expiry ON public.inventory_batches USING btree (branch_id, expiry_date, status);


--
-- Name: idx_inventory_batches_branch_intake_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_inventory_batches_branch_intake_idempotency ON public.inventory_batches USING btree (branch_id, intake_idempotency_key) WHERE (intake_idempotency_key IS NOT NULL);


--
-- Name: idx_inventory_batches_expiring_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_batches_expiring_active ON public.inventory_batches USING btree (branch_id, expiry_date) WHERE ((status = 'active'::text) AND (remaining_weight_kg > (0)::numeric));


--
-- Name: idx_inventory_movements_batch_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_batch_created ON public.inventory_movements USING btree (batch_id, created_at DESC);


--
-- Name: idx_inventory_waste_events_batch_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_waste_events_batch_created ON public.inventory_waste_events USING btree (batch_id, created_at DESC);


--
-- Name: idx_inventory_waste_events_product_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_waste_events_product_created ON public.inventory_waste_events USING btree (product_id, created_at DESC);


--
-- Name: idx_login_attempts_email_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_email_created ON public.login_attempts USING btree (lower(email), created_at DESC);


--
-- Name: idx_ops_events_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ops_events_idempotency ON public.ops_checklist_events USING btree (session_id, step_key, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_ops_events_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ops_events_session ON public.ops_checklist_events USING btree (session_id, created_at);


--
-- Name: idx_ops_sessions_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ops_sessions_branch_date ON public.ops_checklist_sessions USING btree (branch_id, business_date);


--
-- Name: idx_ops_sessions_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ops_sessions_one_active ON public.ops_checklist_sessions USING btree (branch_id, kind, business_date) WHERE (status = 'in_progress'::text);


--
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- Name: idx_order_notes_order_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_notes_order_created ON public.order_notes USING btree (order_id, created_at);


--
-- Name: idx_order_status_events_order_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_status_events_order_created ON public.order_status_events USING btree (order_id, created_at);


--
-- Name: idx_orders_branch_is_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_branch_is_test ON public.orders USING btree (branch_id, is_test);


--
-- Name: idx_orders_branch_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_branch_status ON public.orders USING btree (branch_id, status, pickup_date);


--
-- Name: idx_orders_phone_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_phone_created ON public.orders USING btree (branch_id, customer_phone, created_at);


--
-- Name: idx_pickup_windows_branch_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pickup_windows_branch_active ON public.pickup_windows USING btree (branch_id, is_active);


--
-- Name: idx_product_categories_branch_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_categories_branch_sort ON public.product_categories USING btree (branch_id, sort_order);


--
-- Name: idx_products_branch_category_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_branch_category_sort ON public.products USING btree (branch_id, category_id, sort_order);


--
-- Name: idx_profiles_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_branch ON public.profiles USING btree (branch_id);


--
-- Name: idx_release_deployments_deployed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_release_deployments_deployed_at ON public.release_deployments USING btree (deployed_at DESC);


--
-- Name: idx_shop_closures_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shop_closures_branch_date ON public.shop_closures USING btree (branch_id, close_date);


--
-- Name: idx_sms_log_branch_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_log_branch_created ON public.sms_log USING btree (branch_id, created_at DESC);


--
-- Name: idx_sms_log_branch_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_log_branch_status_created ON public.sms_log USING btree (branch_id, status, created_at DESC);


--
-- Name: idx_sms_log_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_log_order ON public.sms_log USING btree (order_id);


--
-- Name: idx_sms_templates_branch_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_templates_branch_key ON public.sms_templates USING btree (branch_id, template_key);


--
-- Name: idx_stock_count_lines_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_count_lines_session ON public.stock_count_lines USING btree (session_id);


--
-- Name: idx_stock_count_lines_session_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_stock_count_lines_session_batch ON public.stock_count_lines USING btree (session_id, batch_id);


--
-- Name: idx_supplier_documents_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_documents_expiry ON public.supplier_documents USING btree (expiry_date);


--
-- Name: idx_supplier_documents_verified_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_documents_verified_expiry ON public.supplier_documents USING btree (verified_at, expiry_date);


--
-- Name: idx_suppliers_branch_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_branch_active ON public.suppliers USING btree (branch_id, active);


--
-- Name: audit_events audit_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_append_only BEFORE DELETE OR UPDATE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_events_mutation();


--
-- Name: audit_logs audit_logs_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_append_only BEFORE DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();


--
-- Name: audit_logs audit_logs_mirror_to_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_logs_mirror_to_events AFTER INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.mirror_audit_log_to_event();


--
-- Name: branch_settings branch_settings_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER branch_settings_set_updated_at BEFORE UPDATE ON public.branch_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: branches branches_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER branches_set_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: carcass_intakes carcass_intakes_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER carcass_intakes_set_updated_at BEFORE UPDATE ON public.carcass_intakes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: compliance_logs compliance_logs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER compliance_logs_set_updated_at BEFORE UPDATE ON public.compliance_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: order_items order_items_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_items_set_updated_at BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: orders orders_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pickup_windows pickup_windows_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pickup_windows_set_updated_at BEFORE UPDATE ON public.pickup_windows FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: product_categories product_categories_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER product_categories_set_updated_at BEFORE UPDATE ON public.product_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: products products_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: release_certifications release_certifications_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER release_certifications_append_only BEFORE DELETE OR UPDATE ON public.release_certifications FOR EACH ROW EXECUTE FUNCTION public.prevent_release_certification_mutation();


--
-- Name: release_verification_items release_verification_items_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER release_verification_items_set_updated_at BEFORE UPDATE ON public.release_verification_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: release_verifications release_verifications_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER release_verifications_set_updated_at BEFORE UPDATE ON public.release_verifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: shop_closures shop_closures_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER shop_closures_set_updated_at BEFORE UPDATE ON public.shop_closures FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_events audit_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: branch_settings branch_settings_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_settings
    ADD CONSTRAINT branch_settings_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: carcass_intake_cuts carcass_intake_cuts_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carcass_intake_cuts
    ADD CONSTRAINT carcass_intake_cuts_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.inventory_batches(id) ON DELETE SET NULL;


--
-- Name: carcass_intake_cuts carcass_intake_cuts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carcass_intake_cuts
    ADD CONSTRAINT carcass_intake_cuts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: carcass_intake_cuts carcass_intake_cuts_intake_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carcass_intake_cuts
    ADD CONSTRAINT carcass_intake_cuts_intake_id_fkey FOREIGN KEY (intake_id) REFERENCES public.carcass_intakes(id) ON DELETE CASCADE;


--
-- Name: carcass_intake_cuts carcass_intake_cuts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carcass_intake_cuts
    ADD CONSTRAINT carcass_intake_cuts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: carcass_intakes carcass_intakes_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carcass_intakes
    ADD CONSTRAINT carcass_intakes_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: carcass_intakes carcass_intakes_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carcass_intakes
    ADD CONSTRAINT carcass_intakes_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: carcass_intakes carcass_intakes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carcass_intakes
    ADD CONSTRAINT carcass_intakes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: carcass_intakes carcass_intakes_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carcass_intakes
    ADD CONSTRAINT carcass_intakes_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: compliance_logs compliance_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_logs
    ADD CONSTRAINT compliance_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: compliance_logs compliance_logs_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_logs
    ADD CONSTRAINT compliance_logs_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.profiles(id);


--
-- Name: compliance_logs compliance_logs_opened_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_logs
    ADD CONSTRAINT compliance_logs_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.profiles(id);


--
-- Name: compliance_readings compliance_readings_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_readings
    ADD CONSTRAINT compliance_readings_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: compliance_readings compliance_readings_compliance_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_readings
    ADD CONSTRAINT compliance_readings_compliance_log_id_fkey FOREIGN KEY (compliance_log_id) REFERENCES public.compliance_logs(id) ON DELETE CASCADE;


--
-- Name: compliance_readings compliance_readings_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_readings
    ADD CONSTRAINT compliance_readings_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: inventory_batches inventory_batches_actual_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_actual_confirmed_by_fkey FOREIGN KEY (actual_confirmed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: inventory_batches inventory_batches_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: inventory_batches inventory_batches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: inventory_batches inventory_batches_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: inventory_batches inventory_batches_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: inventory_movements inventory_movements_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.inventory_batches(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: inventory_movements inventory_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: inventory_waste_events inventory_waste_events_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_waste_events
    ADD CONSTRAINT inventory_waste_events_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.inventory_batches(id) ON DELETE CASCADE;


--
-- Name: inventory_waste_events inventory_waste_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_waste_events
    ADD CONSTRAINT inventory_waste_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: inventory_waste_events inventory_waste_events_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_waste_events
    ADD CONSTRAINT inventory_waste_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: ops_checklist_events ops_checklist_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_checklist_events
    ADD CONSTRAINT ops_checklist_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: ops_checklist_events ops_checklist_events_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_checklist_events
    ADD CONSTRAINT ops_checklist_events_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: ops_checklist_events ops_checklist_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_checklist_events
    ADD CONSTRAINT ops_checklist_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ops_checklist_sessions(id) ON DELETE CASCADE;


--
-- Name: ops_checklist_sessions ops_checklist_sessions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_checklist_sessions
    ADD CONSTRAINT ops_checklist_sessions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: ops_checklist_sessions ops_checklist_sessions_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_checklist_sessions
    ADD CONSTRAINT ops_checklist_sessions_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: ops_checklist_sessions ops_checklist_sessions_started_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_checklist_sessions
    ADD CONSTRAINT ops_checklist_sessions_started_by_fkey FOREIGN KEY (started_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: order_annual_sequences order_annual_sequences_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_annual_sequences
    ADD CONSTRAINT order_annual_sequences_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: order_daily_sequences order_daily_sequences_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_daily_sequences
    ADD CONSTRAINT order_daily_sequences_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: order_notes order_notes_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_notes
    ADD CONSTRAINT order_notes_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: order_notes order_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_notes
    ADD CONSTRAINT order_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: order_notes order_notes_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_notes
    ADD CONSTRAINT order_notes_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_status_events order_status_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_events
    ADD CONSTRAINT order_status_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: order_status_events order_status_events_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_events
    ADD CONSTRAINT order_status_events_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: order_status_events order_status_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_events
    ADD CONSTRAINT order_status_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: orders orders_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: orders orders_pickup_window_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pickup_window_id_fkey FOREIGN KEY (pickup_window_id) REFERENCES public.pickup_windows(id);


--
-- Name: pickup_windows pickup_windows_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pickup_windows
    ADD CONSTRAINT pickup_windows_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: product_categories product_categories_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: products products_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.product_categories(id);


--
-- Name: profiles profiles_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: release_certifications release_certifications_release_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_certifications
    ADD CONSTRAINT release_certifications_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.release_deployments(id) ON DELETE CASCADE;


--
-- Name: release_verification_items release_verification_items_checked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_verification_items
    ADD CONSTRAINT release_verification_items_checked_by_fkey FOREIGN KEY (checked_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: release_verification_items release_verification_items_verification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_verification_items
    ADD CONSTRAINT release_verification_items_verification_id_fkey FOREIGN KEY (verification_id) REFERENCES public.release_verifications(id) ON DELETE CASCADE;


--
-- Name: release_verifications release_verifications_release_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_verifications
    ADD CONSTRAINT release_verifications_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.release_deployments(id) ON DELETE CASCADE;


--
-- Name: release_verifications release_verifications_verifier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_verifications
    ADD CONSTRAINT release_verifications_verifier_fkey FOREIGN KEY (verifier) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: shop_closures shop_closures_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_closures
    ADD CONSTRAINT shop_closures_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: shop_closures shop_closures_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shop_closures
    ADD CONSTRAINT shop_closures_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: sms_log sms_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_log
    ADD CONSTRAINT sms_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: sms_log sms_log_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_log
    ADD CONSTRAINT sms_log_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: sms_log sms_log_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_log
    ADD CONSTRAINT sms_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: sms_templates sms_templates_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_templates
    ADD CONSTRAINT sms_templates_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: stock_count_lines stock_count_lines_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_count_lines
    ADD CONSTRAINT stock_count_lines_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: stock_count_lines stock_count_lines_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_count_lines
    ADD CONSTRAINT stock_count_lines_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.inventory_batches(id) ON DELETE CASCADE;


--
-- Name: stock_count_lines stock_count_lines_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_count_lines
    ADD CONSTRAINT stock_count_lines_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: stock_count_lines stock_count_lines_correction_movement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_count_lines
    ADD CONSTRAINT stock_count_lines_correction_movement_id_fkey FOREIGN KEY (correction_movement_id) REFERENCES public.inventory_movements(id) ON DELETE SET NULL;


--
-- Name: stock_count_lines stock_count_lines_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_count_lines
    ADD CONSTRAINT stock_count_lines_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ops_checklist_sessions(id) ON DELETE CASCADE;


--
-- Name: supplier_documents supplier_documents_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_documents
    ADD CONSTRAINT supplier_documents_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;


--
-- Name: supplier_documents supplier_documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_documents
    ADD CONSTRAINT supplier_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: suppliers suppliers_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events authenticated can create audit events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can create audit events" ON public.audit_events FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: audit_logs authenticated can create audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can create audit logs" ON public.audit_logs FOR INSERT WITH CHECK (((branch_id IS NULL) OR public.is_branch_staff(branch_id)));


--
-- Name: branch_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branch_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: branches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

--
-- Name: carcass_intake_cuts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.carcass_intake_cuts ENABLE ROW LEVEL SECURITY;

--
-- Name: carcass_intakes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.carcass_intakes ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_readings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_readings ENABLE ROW LEVEL SECURITY;

--
-- Name: expected_migrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expected_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_waste_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_waste_events ENABLE ROW LEVEL SECURITY;

--
-- Name: login_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_waste_events managers can create branch waste events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can create branch waste events" ON public.inventory_waste_events FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.inventory_batches b
  WHERE ((b.id = inventory_waste_events.batch_id) AND public.is_branch_manager(b.branch_id)))));


--
-- Name: release_certifications managers can create release certifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can create release certifications" ON public.release_certifications FOR INSERT WITH CHECK ((public.current_profile_role() = ANY (ARRAY['manager'::text, 'owner'::text])));


--
-- Name: release_deployments managers can create release deployments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can create release deployments" ON public.release_deployments FOR INSERT WITH CHECK ((public.current_profile_role() = ANY (ARRAY['manager'::text, 'owner'::text])));


--
-- Name: product_categories managers can manage categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can manage categories" ON public.product_categories USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));


--
-- Name: inventory_batches managers can manage inventory batches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can manage inventory batches" ON public.inventory_batches USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));


--
-- Name: branch_settings managers can manage own branch settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can manage own branch settings" ON public.branch_settings USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));


--
-- Name: pickup_windows managers can manage pickup windows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can manage pickup windows" ON public.pickup_windows USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));


--
-- Name: products managers can manage products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can manage products" ON public.products USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));


--
-- Name: shop_closures managers can manage shop closures; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can manage shop closures" ON public.shop_closures USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));


--
-- Name: sms_templates managers can manage sms templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can manage sms templates" ON public.sms_templates USING (public.is_branch_manager(branch_id)) WITH CHECK (public.is_branch_manager(branch_id));


--
-- Name: supplier_documents managers can manage supplier documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can manage supplier documents" ON public.supplier_documents USING ((EXISTS ( SELECT 1
   FROM public.suppliers s
  WHERE ((s.id = supplier_documents.supplier_id) AND ((s.branch_id IS NULL) OR public.is_branch_manager(s.branch_id)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.suppliers s
  WHERE ((s.id = supplier_documents.supplier_id) AND ((s.branch_id IS NULL) OR public.is_branch_manager(s.branch_id))))));


--
-- Name: suppliers managers can manage suppliers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can manage suppliers" ON public.suppliers USING (((branch_id IS NULL) OR public.is_branch_manager(branch_id))) WITH CHECK (((branch_id IS NULL) OR public.is_branch_manager(branch_id)));


--
-- Name: profiles managers can read branch profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can read branch profiles" ON public.profiles FOR SELECT USING (public.is_branch_manager(branch_id));


--
-- Name: expected_migrations managers can read expected migrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can read expected migrations" ON public.expected_migrations FOR SELECT USING ((public.current_profile_role() = ANY (ARRAY['manager'::text, 'owner'::text])));


--
-- Name: release_certifications managers can read release certifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can read release certifications" ON public.release_certifications FOR SELECT USING ((public.current_profile_role() = ANY (ARRAY['manager'::text, 'owner'::text])));


--
-- Name: release_deployments managers can read release deployments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can read release deployments" ON public.release_deployments FOR SELECT USING ((public.current_profile_role() = ANY (ARRAY['manager'::text, 'owner'::text])));


--
-- Name: release_verification_items managers can read release verification items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can read release verification items" ON public.release_verification_items FOR SELECT USING ((public.current_profile_role() = ANY (ARRAY['manager'::text, 'owner'::text])));


--
-- Name: release_verifications managers can read release verifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can read release verifications" ON public.release_verifications FOR SELECT USING ((public.current_profile_role() = ANY (ARRAY['manager'::text, 'owner'::text])));


--
-- Name: release_verification_items managers can update release verification items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can update release verification items" ON public.release_verification_items FOR UPDATE USING ((public.current_profile_role() = ANY (ARRAY['manager'::text, 'owner'::text])));


--
-- Name: release_verifications managers can update release verifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers can update release verifications" ON public.release_verifications FOR UPDATE USING ((public.current_profile_role() = ANY (ARRAY['manager'::text, 'owner'::text])));


--
-- Name: ops_checklist_events managers read ops events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers read ops events" ON public.ops_checklist_events FOR SELECT USING (public.is_branch_manager(branch_id));


--
-- Name: ops_checklist_sessions managers read ops sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers read ops sessions" ON public.ops_checklist_sessions FOR SELECT USING (public.is_branch_manager(branch_id));


--
-- Name: stock_count_lines managers read stock count lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managers read stock count lines" ON public.stock_count_lines FOR SELECT USING (public.is_branch_manager(branch_id));


--
-- Name: ops_checklist_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_checklist_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_checklist_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_checklist_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: order_annual_sequences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_annual_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: order_daily_sequences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_daily_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: order_status_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_status_events ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: branches owners can manage branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owners can manage branches" ON public.branches USING ((public.current_profile_role() = 'owner'::text)) WITH CHECK ((public.current_profile_role() = 'owner'::text));


--
-- Name: profiles owners can manage profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owners can manage profiles" ON public.profiles USING ((public.current_profile_role() = 'owner'::text)) WITH CHECK ((public.current_profile_role() = 'owner'::text));


--
-- Name: order_annual_sequences owners can read order annual sequences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owners can read order annual sequences" ON public.order_annual_sequences FOR SELECT USING ((public.current_profile_role() = 'owner'::text));


--
-- Name: order_daily_sequences owners can read order daily sequences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owners can read order daily sequences" ON public.order_daily_sequences FOR SELECT USING ((public.current_profile_role() = 'owner'::text));


--
-- Name: pickup_windows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pickup_windows ENABLE ROW LEVEL SECURITY;

--
-- Name: product_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: branch_settings public can read active branch settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read active branch settings" ON public.branch_settings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.branches b
  WHERE ((b.id = branch_settings.branch_id) AND (b.is_active = true)))));


--
-- Name: branches public can read active branches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read active branches" ON public.branches FOR SELECT USING ((is_active = true));


--
-- Name: product_categories public can read active categories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read active categories" ON public.product_categories FOR SELECT USING ((is_active = true));


--
-- Name: pickup_windows public can read active pickup windows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read active pickup windows" ON public.pickup_windows FOR SELECT USING ((is_active = true));


--
-- Name: products public can read active products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read active products" ON public.products FOR SELECT USING ((is_available = true));


--
-- Name: shop_closures public can read shop closures; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public can read shop closures" ON public.shop_closures FOR SELECT USING (true);


--
-- Name: release_certifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.release_certifications ENABLE ROW LEVEL SECURITY;

--
-- Name: release_deployments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.release_deployments ENABLE ROW LEVEL SECURITY;

--
-- Name: release_verification_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.release_verification_items ENABLE ROW LEVEL SECURITY;

--
-- Name: release_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.release_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_closures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shop_closures ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sms_log ENABLE ROW LEVEL SECURITY;

--
-- Name: sms_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sms_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_logs staff can create branch compliance logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can create branch compliance logs" ON public.compliance_logs FOR INSERT WITH CHECK (public.is_branch_staff(branch_id));


--
-- Name: compliance_readings staff can create branch compliance readings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can create branch compliance readings" ON public.compliance_readings FOR INSERT WITH CHECK (public.is_branch_staff(branch_id));


--
-- Name: order_notes staff can create branch order notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can create branch order notes" ON public.order_notes FOR INSERT WITH CHECK (public.is_branch_staff(branch_id));


--
-- Name: order_status_events staff can create branch order status events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can create branch order status events" ON public.order_status_events FOR INSERT WITH CHECK (public.is_branch_staff(branch_id));


--
-- Name: inventory_movements staff can create inventory movements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can create inventory movements" ON public.inventory_movements FOR INSERT WITH CHECK (public.is_branch_staff(branch_id));


--
-- Name: audit_logs staff can read branch audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch audit logs" ON public.audit_logs FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: carcass_intake_cuts staff can read branch carcass intake cuts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch carcass intake cuts" ON public.carcass_intake_cuts FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: carcass_intakes staff can read branch carcass intakes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch carcass intakes" ON public.carcass_intakes FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: compliance_logs staff can read branch compliance logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch compliance logs" ON public.compliance_logs FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: compliance_readings staff can read branch compliance readings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch compliance readings" ON public.compliance_readings FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: order_items staff can read branch order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch order items" ON public.order_items FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: order_notes staff can read branch order notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch order notes" ON public.order_notes FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: order_status_events staff can read branch order status events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch order status events" ON public.order_status_events FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: orders staff can read branch orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch orders" ON public.orders FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: products staff can read branch products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch products" ON public.products FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: sms_log staff can read branch sms log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch sms log" ON public.sms_log FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: inventory_waste_events staff can read branch waste events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read branch waste events" ON public.inventory_waste_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.inventory_batches b
  WHERE ((b.id = inventory_waste_events.batch_id) AND public.is_branch_staff(b.branch_id)))));


--
-- Name: inventory_batches staff can read inventory batches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read inventory batches" ON public.inventory_batches FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: inventory_movements staff can read inventory movements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read inventory movements" ON public.inventory_movements FOR SELECT USING (public.is_branch_staff(branch_id));


--
-- Name: audit_events staff can read own branch audit events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read own branch audit events" ON public.audit_events FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.audit_logs l
  WHERE ((l.target_id = audit_events.entity_id) AND (l.event_type = audit_events.event_type) AND public.is_branch_staff(l.branch_id)))) OR (public.current_profile_role() = 'owner'::text)));


--
-- Name: supplier_documents staff can read supplier documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read supplier documents" ON public.supplier_documents FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.suppliers s
  WHERE ((s.id = supplier_documents.supplier_id) AND ((s.branch_id IS NULL) OR public.is_branch_staff(s.branch_id))))));


--
-- Name: suppliers staff can read suppliers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can read suppliers" ON public.suppliers FOR SELECT USING (((branch_id IS NULL) OR public.is_branch_staff(branch_id)));


--
-- Name: compliance_logs staff can update branch compliance logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can update branch compliance logs" ON public.compliance_logs FOR UPDATE USING (public.is_branch_staff(branch_id)) WITH CHECK (public.is_branch_staff(branch_id));


--
-- Name: order_items staff can update branch order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can update branch order items" ON public.order_items FOR UPDATE USING (public.is_branch_staff(branch_id)) WITH CHECK (public.is_branch_staff(branch_id));


--
-- Name: orders staff can update branch orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff can update branch orders" ON public.orders FOR UPDATE USING (public.is_branch_staff(branch_id)) WITH CHECK (public.is_branch_staff(branch_id));


--
-- Name: stock_count_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles users can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users can read own profile" ON public.profiles FOR SELECT USING ((id = auth.uid()));


--
-- PostgreSQL database dump complete
--

\unrestrict bxDzc3S60XDmCaN4hJ8hbceYp4z9sw7mgtetW494jk223OewNTc740bCJ0iES0t


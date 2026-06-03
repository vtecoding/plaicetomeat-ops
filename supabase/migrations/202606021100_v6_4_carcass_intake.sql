-- V6.4 connected carcass intake.
--
-- Turns a real supply event ("we received a 60kg beef side for £360") into a
-- first-class, queryable record that fans out into per-cut inventory stock and
-- (optionally, review-first) product cost/price updates — atomically, in one
-- transaction, with a clean separation between PROCESSING LOSS (bone/fat/trim/
-- moisture) and retail waste (inventory_waste_events).
--
-- Additive only: two new tables + one SECURITY DEFINER RPC. No changes to
-- existing tables, columns, RLS, auth, or middleware.

-- 1. The supply event itself.
CREATE TABLE IF NOT EXISTS public.carcass_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  animal_type text NOT NULL,
  intake_type text NOT NULL CHECK (intake_type IN ('whole', 'side', 'quarter', 'primal')),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  received_weight_kg numeric(8,3) NOT NULL CHECK (received_weight_kg > 0),
  total_cost_gbp numeric(10,2) NOT NULL CHECK (total_cost_gbp >= 0),
  days_hung int NOT NULL DEFAULT 0 CHECK (days_hung >= 0),
  received_at date NOT NULL,
  -- Honest snapshot of what was decided at confirmation time.
  processed_weight_kg numeric(8,3),
  saleable_weight_kg numeric(8,3),
  processing_loss_kg numeric(8,3),
  blended_cost_per_kg numeric(10,2),
  status text NOT NULL CHECK (status IN ('draft', 'confirmed', 'cancelled')) DEFAULT 'confirmed',
  idempotency_key text,
  notes text,
  confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (branch_id, idempotency_key)
);

-- 2. Per-cut breakdown lines, linked to the mapped product and the stock batch
--    each cut created. is_waste = true marks a processing-loss line (NOT stock).
CREATE TABLE IF NOT EXISTS public.carcass_intake_cuts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.carcass_intakes(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  cut_id text NOT NULL,
  cut_name text NOT NULL,
  is_waste boolean NOT NULL DEFAULT false,
  expected_weight_kg numeric(8,3) NOT NULL CHECK (expected_weight_kg >= 0),
  cost_per_kg numeric(10,2),
  suggested_price_per_kg numeric(10,2),
  margin_pct numeric(5,2),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carcass_intakes_branch_received ON public.carcass_intakes(branch_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_carcass_intake_cuts_intake ON public.carcass_intake_cuts(intake_id);
CREATE INDEX IF NOT EXISTS idx_carcass_intake_cuts_product ON public.carcass_intake_cuts(product_id);

CREATE TRIGGER carcass_intakes_set_updated_at BEFORE UPDATE ON public.carcass_intakes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.carcass_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carcass_intake_cuts ENABLE ROW LEVEL SECURITY;

-- Reads only via RLS; all writes are funnelled through the SECURITY DEFINER RPC.
DROP POLICY IF EXISTS "staff can read branch carcass intakes" ON public.carcass_intakes;
CREATE POLICY "staff can read branch carcass intakes" ON public.carcass_intakes
  FOR SELECT USING (public.is_branch_staff(branch_id));

DROP POLICY IF EXISTS "staff can read branch carcass intake cuts" ON public.carcass_intake_cuts;
CREATE POLICY "staff can read branch carcass intake cuts" ON public.carcass_intake_cuts
  FOR SELECT USING (public.is_branch_staff(branch_id));

-- 3. Atomic confirmation. One transaction creates the intake, per-cut stock
--    batches + RECEIVED movements for mapped saleable cuts, optional (explicit)
--    product cost/price updates, the per-cut breakdown rows, and an audit entry.
--    Processing-loss lines record NO inventory and never touch retail waste.
CREATE OR REPLACE FUNCTION public.admin_confirm_carcass_intake(
  p_branch_id uuid,
  p_animal_type text,
  p_intake_type text,
  p_supplier_id uuid,
  p_received_weight_kg numeric,
  p_total_cost_gbp numeric,
  p_days_hung int,
  p_received_at date,
  p_default_expiry_date date,
  p_processed_weight_kg numeric,
  p_saleable_weight_kg numeric,
  p_processing_loss_kg numeric,
  p_blended_cost_per_kg numeric,
  p_idempotency_key text,
  p_notes text,
  p_cuts jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.admin_confirm_carcass_intake(
  uuid, text, text, uuid, numeric, numeric, int, date, date, numeric, numeric, numeric, numeric, text, text, jsonb
) TO authenticated;

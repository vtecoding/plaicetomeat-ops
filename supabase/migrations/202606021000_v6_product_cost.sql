-- V6.1 product cost: lets the cutting guide push an honest cost per kg onto a
-- product, which clears "margin unavailable" in the V6 analytics. Additive and
-- backwards-compatible (nullable column + new RPC); safe to apply any time.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_per_kg numeric(10, 2);

CREATE OR REPLACE FUNCTION public.admin_set_product_cost(
  p_product_id uuid,
  p_cost numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.admin_set_product_cost(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_commit_product_price_cost(
  p_product_id uuid,
  p_price numeric,
  p_cost numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.admin_commit_product_price_cost(uuid, numeric, numeric) TO authenticated;

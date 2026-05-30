-- V2 Phase C: admin product CRUD.
-- SECURITY DEFINER RPCs that enforce manager/owner role + branch scope, validate
-- the domain, write the canonical row, and append an audit_log. Staff are rejected.
-- Public availability is enforced by the existing products RLS + create_checkout_order.

CREATE OR REPLACE FUNCTION public.slugify(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-');
$$;

-- Create a product (manager/owner only).
CREATE OR REPLACE FUNCTION public.admin_create_product(
  p_branch_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_price numeric DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_unit_type text DEFAULT 'each',
  p_stock_status text DEFAULT 'in_stock'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Update a product's editable detail fields (manager/owner only).
CREATE OR REPLACE FUNCTION public.admin_update_product(
  p_product_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_unit_type text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Update only the price (manager/owner only) — emits a dedicated price_changed event.
CREATE OR REPLACE FUNCTION public.admin_update_product_price(
  p_product_id uuid,
  p_price numeric
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

-- Toggle availability / stock status (manager/owner only).
CREATE OR REPLACE FUNCTION public.admin_set_product_availability(
  p_product_id uuid,
  p_is_available boolean,
  p_stock_status text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.admin_create_product(uuid, text, text, numeric, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_product(uuid, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_product_price(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_product_availability(uuid, boolean, text) TO authenticated;

-- V18 A2 — honest inventory policy for each/box trade.
--
-- Sales truth and stock truth are deliberately separate: every catalogue product
-- can be sold, while only `kg_batch` products participate in kg batch maths.
-- `untracked_manual` availability remains controlled by products.is_available and
-- products.stock_status. No each/box quantity ledger is introduced here.

-- 1. Durable product policy ---------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN inventory_policy text;

UPDATE public.products
SET inventory_policy = CASE
  WHEN unit_type IN ('each', 'box') THEN 'untracked_manual'
  ELSE 'kg_batch'
END;

ALTER TABLE public.products
  ALTER COLUMN unit_type SET NOT NULL,
  ALTER COLUMN inventory_policy SET DEFAULT 'kg_batch',
  ALTER COLUMN inventory_policy SET NOT NULL;

ALTER TABLE public.products
  ADD CONSTRAINT products_inventory_policy_value_check
    CHECK (inventory_policy IN ('kg_batch', 'untracked_manual')),
  ADD CONSTRAINT products_inventory_policy_unit_check
    CHECK (
      (unit_type = 'kg' AND inventory_policy IN ('kg_batch', 'untracked_manual'))
      OR (unit_type IN ('each', 'box') AND inventory_policy = 'untracked_manual')
    );

COMMENT ON COLUMN public.products.inventory_policy IS
  'kg_batch participates in batch quantity/value/expiry maths; untracked_manual is sold normally but stock availability is maintained manually.';

-- Product RPCs derive the policy from the unit. There is intentionally no
-- client-supplied inventory-policy parameter.
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
  v_policy text;
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

  v_policy := CASE WHEN p_unit_type = 'kg' THEN 'kg_batch' ELSE 'untracked_manual' END;
  v_base := public.slugify(v_name);
  IF v_base = '' THEN v_base := 'product'; END IF;
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.products WHERE branch_id = p_branch_id AND slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix;
  END LOOP;

  INSERT INTO public.products (
    branch_id, category_id, name, slug, description, unit_type,
    inventory_policy, price_per_unit, is_available, stock_status, sort_order
  )
  VALUES (
    p_branch_id, p_category_id, v_name, v_slug,
    nullif(btrim(coalesce(p_description, '')), ''), p_unit_type,
    v_policy, round(p_price, 2), true, p_stock_status, 0
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'product_changed', 'product', v_id, p_branch_id, v_actor,
    jsonb_build_object(
      'action', 'created', 'name', v_name, 'price', round(p_price, 2),
      'slug', v_slug, 'unit_type', p_unit_type, 'inventory_policy', v_policy
    )
  );
  RETURN v_id;
END;
$$;

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
  v_policy text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-policy:' || p_product_id::text, 0));
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

  v_policy := CASE
    WHEN v_unit IN ('each', 'box') THEN 'untracked_manual'
    WHEN p_unit_type IS NOT NULL AND p_unit_type IS DISTINCT FROM v_product.unit_type THEN 'kg_batch'
    ELSE v_product.inventory_policy
  END;

  IF v_policy = 'kg_batch'
     AND v_product.inventory_policy = 'untracked_manual'
     AND EXISTS (SELECT 1 FROM public.inventory_batches b WHERE b.product_id = p_product_id) THEN
    RAISE EXCEPTION 'Stock counting cannot be turned back on while old batch history exists.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.products
  SET name = v_name,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      category_id = p_category_id,
      unit_type = v_unit,
      inventory_policy = v_policy
  WHERE id = p_product_id;

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'product_changed', 'product', p_product_id, v_product.branch_id, v_actor,
    jsonb_build_object(
      'action', 'updated', 'name', v_name, 'unit_type', v_unit,
      'inventory_policy', v_policy
    )
  );
  RETURN p_product_id;
END;
$$;

-- V12's DDL guard revokes client execution after every function replacement.
-- These are intentional manager-facing RPCs, so restore only the authenticated
-- and server roles after both definitions are final.
REVOKE ALL ON FUNCTION public.admin_create_product(uuid, text, text, numeric, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_product(uuid, text, text, numeric, uuid, text, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_update_product(uuid, text, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_product(uuid, text, text, uuid, text)
  TO authenticated, service_role;

-- A kg product is counted by default, but the owner can make the deliberate
-- bounded choice not to count it. Expose a boolean intent rather than accepting
-- an arbitrary policy string. Re-enabling is safe only before any batch history
-- exists: otherwise old balances/expiry dates would silently become live again.
CREATE OR REPLACE FUNCTION public.admin_set_product_stock_counting_v18(
  p_product_id uuid,
  p_stock_counted boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_product public.products%ROWTYPE;
  v_policy text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF p_stock_counted IS NULL THEN
    RAISE EXCEPTION 'Stock counting choice is required.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-policy:' || p_product_id::text, 0));

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_manager(v_product.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF v_product.unit_type <> 'kg' THEN
    RAISE EXCEPTION 'Stock counting can only be changed for a kg product.' USING ERRCODE = '22023';
  END IF;

  v_policy := CASE WHEN p_stock_counted THEN 'kg_batch' ELSE 'untracked_manual' END;
  IF v_product.inventory_policy = v_policy THEN
    RETURN v_product.id;
  END IF;

  IF p_stock_counted AND EXISTS (
    SELECT 1 FROM public.inventory_batches b WHERE b.product_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Stock counting cannot be turned back on while old batch history exists.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.products
  SET inventory_policy = v_policy
  WHERE id = p_product_id;

  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (
    'product_changed', 'product', p_product_id, v_product.branch_id, v_actor,
    jsonb_build_object(
      'action', 'stock_counting_changed',
      'from_inventory_policy', v_product.inventory_policy,
      'inventory_policy', v_policy,
      'stock_counted', p_stock_counted
    )
  );

  RETURN p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_product_stock_counting_v18(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_product_stock_counting_v18(uuid, boolean)
  TO authenticated, service_role;

-- New callers use the versioned wrapper so product creation and the explicit
-- untracked-kg choice share one PostgreSQL transaction. The established product
-- creation RPC remains unchanged for compatibility.
CREATE OR REPLACE FUNCTION public.admin_create_product_v18(
  p_branch_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_price numeric DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_unit_type text DEFAULT 'each',
  p_stock_status text DEFAULT 'in_stock',
  p_untracked_kg boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_untracked_kg AND p_unit_type <> 'kg' THEN
    RAISE EXCEPTION 'Only a kg product can use the untracked stock choice.' USING ERRCODE = '22023';
  END IF;

  v_id := public.admin_create_product(
    p_branch_id,
    p_name,
    p_description,
    p_price,
    p_category_id,
    p_unit_type,
    p_stock_status
  );

  IF p_untracked_kg THEN
    PERFORM public.admin_set_product_stock_counting_v18(v_id, false);
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_product_v18(uuid, text, text, numeric, uuid, text, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_product_v18(uuid, text, text, numeric, uuid, text, text, boolean)
  TO authenticated, service_role;

-- 2. Stock writes cannot create counted stock for an untracked product --------
CREATE OR REPLACE FUNCTION public.enforce_inventory_batch_product_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_policy text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-policy:' || NEW.product_id::text, 0));
  SELECT inventory_policy INTO v_policy
  FROM public.products
  WHERE id = NEW.product_id;

  IF v_policy IS DISTINCT FROM 'kg_batch' THEN
    RAISE EXCEPTION 'Stock is not counted for this product.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_batches_product_policy ON public.inventory_batches;
CREATE TRIGGER inventory_batches_product_policy
BEFORE INSERT OR UPDATE ON public.inventory_batches
FOR EACH ROW EXECUTE FUNCTION public.enforce_inventory_batch_product_policy();

-- Existing each/box rows can have legacy batches from before the policy was
-- declared. Filter the database-level aggregate as well as application readers,
-- so those rows cannot reappear through a future stock_levels consumer.
CREATE OR REPLACE VIEW public.stock_levels
WITH (security_invoker = true)
AS
SELECT
  b.product_id,
  b.branch_id,
  sum(b.remaining_weight_kg)::numeric(8,3) AS total_kg,
  count(*)::int AS batches_count,
  min(b.expiry_date) AS earliest_expiry,
  max(b.updated_at) AS updated_at
FROM public.inventory_batches b
JOIN public.products p ON p.id = b.product_id
WHERE b.status = 'active'
  AND p.inventory_policy = 'kg_batch'
GROUP BY b.product_id, b.branch_id;

-- 3. Collection still uses the V14 FEFO engine, but only for declared kg-batch
-- products. Each/box and deliberately untracked kg products are normal sale
-- lines with no stock movement or shortfall claim.
CREATE OR REPLACE FUNCTION public.deplete_order_inventory(p_order_id uuid)
RETURNS public.order_inventory_depletions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_actor uuid := auth.uid();
  v_existing public.order_inventory_depletions%ROWTYPE;
  v_result public.order_inventory_depletions%ROWTYPE;
  v_item record;
  v_batch record;
  v_needed numeric(10,3);
  v_take numeric(10,3);
  v_before numeric(8,3);
  v_after numeric(8,3);
  v_total_required numeric(10,3) := 0;
  v_total_depleted numeric(10,3) := 0;
  v_shortfall numeric(10,3) := 0;
  v_shortfall_detail jsonb := '[]'::jsonb;
  v_weight_lines int := 0;
  v_nonweight_lines int := 0;
  v_status text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF v_order.status <> 'collected' THEN
    RAISE EXCEPTION 'Stock only moves once an order is collected.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.order_inventory_depletions
  WHERE order_id = p_order_id AND source_event = 'SALE_COLLECT'
  FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing; END IF;

  FOR v_item IN
    SELECT
      oi.id,
      oi.product_id,
      oi.product_name_snapshot,
      oi.quantity,
      p.unit_type,
      p.inventory_policy
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
    ORDER BY oi.id
  LOOP
    IF v_item.product_id IS NULL
       OR coalesce(v_item.unit_type, '') <> 'kg'
       OR coalesce(v_item.inventory_policy, '') <> 'kg_batch'
       OR coalesce(v_item.quantity, 0) <= 0 THEN
      v_nonweight_lines := v_nonweight_lines + 1;
      CONTINUE;
    END IF;

    v_weight_lines := v_weight_lines + 1;
    v_needed := v_item.quantity;
    v_total_required := v_total_required + v_needed;

    FOR v_batch IN
      SELECT id, remaining_weight_kg
      FROM public.inventory_batches
      WHERE branch_id = v_order.branch_id
        AND product_id = v_item.product_id
        AND status = 'active'
        AND remaining_weight_kg > 0
      ORDER BY expiry_date ASC, received_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_needed <= 0;
      v_before := v_batch.remaining_weight_kg;
      v_take := LEAST(v_needed, v_before);
      CONTINUE WHEN v_take <= 0;
      v_after := v_before - v_take;

      UPDATE public.inventory_batches
      SET remaining_weight_kg = v_after,
          status = CASE WHEN v_after = 0 THEN 'depleted' ELSE status END,
          updated_at = now()
      WHERE id = v_batch.id;

      INSERT INTO public.inventory_movements
        (batch_id, branch_id, movement_type, quantity_kg, delta_kg,
         balance_before_kg, balance_after_kg, source_event, order_id, order_item_id,
         idempotency_key, reference_id, reason, created_by)
      VALUES
        (v_batch.id, v_order.branch_id, 'SALE', v_take, -v_take,
         v_before, v_after, 'SALE_COLLECT', p_order_id, v_item.id,
         p_order_id::text || ':' || v_item.id::text || ':' || v_batch.id::text || ':SALE_COLLECT',
         p_order_id, 'Sold — order ' || v_order.order_ref, v_actor);

      v_needed := v_needed - v_take;
      v_total_depleted := v_total_depleted + v_take;
    END LOOP;

    IF v_needed > 0 THEN
      v_shortfall := v_shortfall + v_needed;
      v_shortfall_detail := v_shortfall_detail || jsonb_build_object(
        'product_id', v_item.product_id,
        'product_name', v_item.product_name_snapshot,
        'short_kg', v_needed
      );
    END IF;
  END LOOP;

  v_status := CASE WHEN v_shortfall > 0 THEN 'completed_with_shortfall' ELSE 'completed' END;
  INSERT INTO public.order_inventory_depletions
    (order_id, branch_id, source_event, status, weight_tracked_lines,
     non_weight_tracked_lines, total_required_kg, total_depleted_kg, shortfall_kg,
     shortfall_detail, created_by)
  VALUES
    (p_order_id, v_order.branch_id, 'SALE_COLLECT', v_status, v_weight_lines,
     v_nonweight_lines, v_total_required, v_total_depleted, v_shortfall,
     v_shortfall_detail, v_actor)
  RETURNING * INTO v_result;

  PERFORM public.emit_audit_log(
    'inventory_depleted_for_order', 'order', p_order_id, v_order.branch_id,
    jsonb_build_object(
      'order_ref', v_order.order_ref,
      'weight_tracked_lines', v_weight_lines,
      'non_weight_tracked_lines', v_nonweight_lines,
      'total_required_kg', v_total_required,
      'total_depleted_kg', v_total_depleted
    )
  );

  IF v_shortfall > 0 THEN
    PERFORM public.emit_audit_log(
      'inventory_depletion_shortfall', 'order', p_order_id, v_order.branch_id,
      jsonb_build_object(
        'order_ref', v_order.order_ref,
        'shortfall_kg', v_shortfall,
        'detail', v_shortfall_detail
      )
    );
  END IF;
  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_result FROM public.order_inventory_depletions
    WHERE order_id = p_order_id AND source_event = 'SALE_COLLECT';
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.deplete_order_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deplete_order_inventory(uuid) TO authenticated, service_role;

-- 4. Monitoring views never turn untracked products into count/cover/expiry
-- work. The existing confidence view composes this filtered reconciliation view.
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
LEFT JOIN counts cnt ON cnt.branch_id = b.branch_id AND cnt.product_id = b.product_id
WHERE p.inventory_policy = 'kg_batch';

-- Non-weight sales are now an intentional, fully supported trade path, not an
-- inventory failure. Keep the other failure signals unchanged.
CREATE OR REPLACE VIEW public.inventory_failure_trends
WITH (security_invoker = true)
AS
WITH events AS (
  SELECT branch_id, 'repeated_oversell_flags'::text AS failure_type, count(*)::int AS event_count
  FROM public.order_inventory_depletions
  WHERE created_at >= now() - interval '30 days' AND shortfall_kg > 0
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

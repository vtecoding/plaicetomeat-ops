-- V18 B3 — atomic refunds and operator-visible correction truth (PTM-OPS-005).
--
-- A refund is one PostgreSQL transaction. The client identifies an operation and
-- selects line quantities/dispositions; PostgreSQL derives the amount and tender
-- method from the collected sale, enforces cumulative line and per-method caps,
-- writes compensating money/stock facts, and persists the exact receipt returned
-- on replay. There is deliberately no refund-method input.

ALTER TABLE public.branch_settings
  ADD COLUMN IF NOT EXISTS refund_alert_threshold_pence integer NOT NULL DEFAULT 2000
  CHECK (refund_alert_threshold_pence >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS owner_alerts_refund_operation_uniq
  ON public.owner_alerts(branch_id, kind, entity_ref)
  WHERE kind = 'refund_above_threshold';

CREATE TABLE public.refund_operations (
  id uuid PRIMARY KEY,
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  total_amount_pence integer NOT NULL CHECK (total_amount_pence > 0),
  business_date date NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refund_operations_order_created_idx
  ON public.refund_operations(order_id, created_at, id);
CREATE INDEX refund_operations_branch_day_idx
  ON public.refund_operations(branch_id, business_date);

CREATE TABLE public.refund_line_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_operation_id uuid NOT NULL REFERENCES public.refund_operations(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  order_item_id uuid NOT NULL REFERENCES public.order_items(id),
  quantity numeric(10,3) NOT NULL CHECK (quantity > 0),
  amount_pence integer NOT NULL CHECK (amount_pence > 0),
  disposition text NOT NULL CHECK (
    disposition IN ('customer_kept', 'returned_restockable', 'returned_discarded')
  ),
  restocked_kg numeric(10,3) NOT NULL DEFAULT 0 CHECK (restocked_kg >= 0),
  discarded_kg numeric(10,3) NOT NULL DEFAULT 0 CHECK (discarded_kg >= 0),
  movement_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(movement_ids) = 'array'),
  waste_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(waste_event_ids) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (refund_operation_id, order_item_id)
);

CREATE INDEX refund_line_outcomes_line_idx
  ON public.refund_line_outcomes(order_item_id, created_at, id);

ALTER TABLE public.refund_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_line_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers read branch refund operations" ON public.refund_operations
FOR SELECT USING (public.is_branch_manager(branch_id));
CREATE POLICY "managers read branch refund line outcomes" ON public.refund_line_outcomes
FOR SELECT USING (public.is_branch_manager(branch_id));

REVOKE ALL ON public.refund_operations FROM anon, PUBLIC;
REVOKE ALL ON public.refund_line_outcomes FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.refund_operations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.refund_line_outcomes FROM authenticated;

CREATE OR REPLACE FUNCTION public.prevent_refund_fact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Refund facts are append-only; record a new refund operation instead'
    USING ERRCODE = '25006';
END;
$$;

CREATE TRIGGER refund_operations_append_only_row
BEFORE UPDATE OR DELETE ON public.refund_operations
FOR EACH ROW EXECUTE FUNCTION public.prevent_refund_fact_mutation();
CREATE TRIGGER refund_operations_append_only_truncate
BEFORE TRUNCATE ON public.refund_operations
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_refund_fact_mutation();
CREATE TRIGGER refund_line_outcomes_append_only_row
BEFORE UPDATE OR DELETE ON public.refund_line_outcomes
FOR EACH ROW EXECUTE FUNCTION public.prevent_refund_fact_mutation();
CREATE TRIGGER refund_line_outcomes_append_only_truncate
BEFORE TRUNCATE ON public.refund_line_outcomes
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_refund_fact_mutation();

-- Link compensating facts to the client-generated refund operation.
ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS refund_operation_id uuid REFERENCES public.refund_operations(id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_refund_operation_method_key
  ON public.payment_events(refund_operation_id, method)
  WHERE refund_operation_id IS NOT NULL;

ALTER TABLE public.inventory_waste_events
  ADD COLUMN IF NOT EXISTS refund_operation_id uuid,
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES public.order_items(id);
ALTER TABLE public.inventory_waste_events
  ADD CONSTRAINT inventory_waste_events_refund_operation_fk
  FOREIGN KEY (refund_operation_id) REFERENCES public.refund_operations(id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS inventory_waste_events_refund_operation_idx
  ON public.inventory_waste_events(refund_operation_id)
  WHERE refund_operation_id IS NOT NULL;

-- V14 allowed one whole-order refund reversal. B3 refunds are operation-scoped
-- and line-exact, while legacy reversal operations retain their old uniqueness.
ALTER TABLE public.inventory_reversal_groups
  DROP CONSTRAINT IF EXISTS inventory_reversal_groups_order_id_source_event_key;
ALTER TABLE public.inventory_reversal_groups
  DROP CONSTRAINT IF EXISTS inventory_reversal_groups_source_event_check;
ALTER TABLE public.inventory_reversal_groups
  ADD CONSTRAINT inventory_reversal_groups_source_event_check CHECK (
    source_event IN (
      'REFUND_REVERSAL', 'COLLECTION_REVERSAL', 'CANCELLED_COLLECTION_REVERSAL',
      'OPERATOR_CORRECTION', 'REFUND_LINE_REVERSAL'
    )
  );
ALTER TABLE public.inventory_reversal_groups
  ADD COLUMN IF NOT EXISTS refund_operation_id uuid,
  ADD CONSTRAINT inventory_reversal_groups_refund_operation_fk
    FOREIGN KEY (refund_operation_id) REFERENCES public.refund_operations(id)
    DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_reversal_groups_legacy_once
  ON public.inventory_reversal_groups(order_id, source_event)
  WHERE refund_operation_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_reversal_groups_refund_operation_once
  ON public.inventory_reversal_groups(refund_operation_id)
  WHERE refund_operation_id IS NOT NULL;

-- Snapshot basis used until B4 installs the authoritative ordered fold. B4
-- replaces only this body so refund_order_v18 immediately consumes folded state.
CREATE OR REPLACE FUNCTION public.get_refund_basis_lines_v18(p_order_id uuid)
RETURNS TABLE (
  source_order_item_id uuid,
  product_id uuid,
  product_name text,
  unit_type text,
  effective_quantity numeric,
  effective_unit_price_pence integer,
  line_total_pence integer,
  depletion_cap_quantity numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    oi.id,
    oi.product_id,
    oi.product_name_snapshot,
    oi.unit_type,
    oi.quantity,
    round(oi.unit_price_snapshot * 100)::integer,
    round(oi.line_total * 100)::integer,
    CASE
      WHEN coalesce(p.inventory_policy, 'untracked_manual') = 'kg_batch'
        THEN coalesce(d.depleted_quantity, 0)
      ELSE oi.quantity
    END
  FROM public.order_items oi
  LEFT JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN LATERAL (
    SELECT sum(abs(m.delta_kg))::numeric AS depleted_quantity
    FROM public.inventory_movements m
    WHERE m.order_item_id = oi.id
      AND m.order_id = oi.order_id
      AND m.source_event = 'SALE_COLLECT'
      AND m.delta_kg < 0
  ) d ON true
  WHERE oi.order_id = p_order_id
  ORDER BY oi.created_at, oi.id;
$$;

REVOKE ALL ON FUNCTION public.get_refund_basis_lines_v18(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_refund_basis_lines_v18(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.parse_refund_lines_v18(p_lines jsonb)
RETURNS TABLE (ordinal bigint, order_item_id uuid, quantity numeric)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    x.ordinality,
    coalesce(x.value->>'order_item_id', x.value->>'orderItemId')::uuid,
    (x.value->>'quantity')::numeric
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS x(value, ordinality);
$$;

CREATE OR REPLACE FUNCTION public.parse_refund_dispositions_v18(p_dispositions jsonb)
RETURNS TABLE (ordinal bigint, order_item_id uuid, disposition text)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    x.ordinality,
    coalesce(x.value->>'order_item_id', x.value->>'orderItemId')::uuid,
    x.value->>'disposition'
  FROM jsonb_array_elements(p_dispositions) WITH ORDINALITY AS x(value, ordinality);
$$;

REVOKE ALL ON FUNCTION public.parse_refund_lines_v18(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parse_refund_dispositions_v18(jsonb) FROM PUBLIC, anon, authenticated;

-- One shared, server-authoritative calculator powers the read-only confirmation
-- preview and the mutation under its order lock. The mutation re-runs it; a
-- stale preview can never authorize an over-refund.
CREATE OR REPLACE FUNCTION public.calculate_refund_v18(p_order_id uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_distinct_count integer;
  v_line record;
  v_basis record;
  v_processed integer := 0;
  v_prior_quantity numeric;
  v_prior_amount integer;
  v_remaining_quantity numeric;
  v_refundable_line_basis_pence integer;
  v_remaining_line_pence integer;
  v_amount integer;
  v_total integer := 0;
  v_net_paid integer;
  v_unallocated integer;
  v_take integer;
  v_method record;
  v_lines jsonb := '[]'::jsonb;
  v_money jsonb := '[]'::jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Choose at least one refund line.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), count(DISTINCT order_item_id)
  INTO v_count, v_distinct_count
  FROM public.parse_refund_lines_v18(p_lines);
  IF v_count <> v_distinct_count THEN
    RAISE EXCEPTION 'Each order line may appear only once in a refund.' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN
    SELECT * FROM public.parse_refund_lines_v18(p_lines) ORDER BY order_item_id
  LOOP
    IF v_line.quantity IS NULL OR v_line.quantity <= 0 OR scale(v_line.quantity) > 3 THEN
      RAISE EXCEPTION 'Refund quantities must be positive with at most three decimal places.'
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_basis
    FROM public.get_refund_basis_lines_v18(p_order_id)
    WHERE source_order_item_id = v_line.order_item_id;
    IF v_basis.source_order_item_id IS NULL THEN
      RAISE EXCEPTION 'Refund line does not belong to this order.' USING ERRCODE = '22023';
    END IF;
    IF v_basis.unit_type IN ('each', 'box') AND v_line.quantity <> trunc(v_line.quantity) THEN
      RAISE EXCEPTION 'Refund quantities for each or box items must be whole counts.'
        USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(sum(r.quantity), 0), coalesce(sum(r.amount_pence), 0)::integer
    INTO v_prior_quantity, v_prior_amount
    FROM public.refund_line_outcomes r
    WHERE r.order_id = p_order_id AND r.order_item_id = v_line.order_item_id;

    v_remaining_quantity := greatest(v_basis.depletion_cap_quantity - v_prior_quantity, 0);
    -- A collection shortfall may have depleted less than the folded quantity.
    -- Quantity and money share that same cap: 1kg actually depleted from a 2kg
    -- £20 line can refund at most £10, never the full £20.
    -- Prorate the exact persisted line total, not rounded unit_price * quantity.
    -- This preserves a non-divisible custom total (for example 3kg / GBP10)
    -- while still applying a physical-depletion shortfall cap.
    v_refundable_line_basis_pence := CASE
      WHEN v_basis.depletion_cap_quantity >= v_basis.effective_quantity
        THEN v_basis.line_total_pence
      WHEN v_basis.effective_quantity > 0
        THEN least(
          v_basis.line_total_pence,
          round(
            v_basis.line_total_pence::numeric
            * v_basis.depletion_cap_quantity
            / v_basis.effective_quantity
          )::integer
        )
      ELSE 0
    END;
    v_remaining_line_pence := greatest(v_refundable_line_basis_pence - v_prior_amount, 0);
    IF v_line.quantity > v_remaining_quantity THEN
      RAISE EXCEPTION 'Refund quantity exceeds the remaining refundable quantity for %.', v_basis.product_name
        USING ERRCODE = '22023';
    END IF;

    -- Independent rounding of split quantities can otherwise add a penny. The
    -- final quantity slice receives exactly the persisted remaining line pence;
    -- earlier slices are capped by it.
    v_amount := CASE
      WHEN v_line.quantity = v_remaining_quantity THEN v_remaining_line_pence
      ELSE least(
        round(
          v_refundable_line_basis_pence::numeric
          * (v_prior_quantity + v_line.quantity)
          / v_basis.depletion_cap_quantity
        )::integer - v_prior_amount,
        v_remaining_line_pence
      )
    END;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Refund line has no positive refundable amount.' USING ERRCODE = '22023';
    END IF;

    v_total := v_total + v_amount;
    v_processed := v_processed + 1;
    v_lines := v_lines || jsonb_build_object(
      'order_item_id', v_line.order_item_id,
      'product_id', v_basis.product_id,
      'product_name', v_basis.product_name,
      'unit_type', v_basis.unit_type,
      'quantity', v_line.quantity,
      'amount_pence', v_amount,
      'remaining_refundable_quantity', v_remaining_quantity - v_line.quantity
    );
  END LOOP;

  IF v_processed <> v_count THEN
    RAISE EXCEPTION 'One or more refund lines are invalid.' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum(CASE WHEN direction = 'sale' THEN amount_pence ELSE -amount_pence END), 0)::integer
  INTO v_net_paid
  FROM public.payment_events
  WHERE order_id = p_order_id;
  IF v_net_paid <= 0 THEN
    RAISE EXCEPTION 'This order has no recorded tender to refund.' USING ERRCODE = '22023';
  END IF;
  IF v_total > v_net_paid THEN
    RAISE EXCEPTION 'Refund exceeds the net payment received for this order.' USING ERRCODE = '22023';
  END IF;

  v_unallocated := v_total;
  FOR v_method IN
    WITH sales AS (
      SELECT method, sum(amount_pence)::integer AS sales_pence, min(created_at) AS first_sale_at
      FROM public.payment_events
      WHERE order_id = p_order_id AND direction = 'sale'
      GROUP BY method
    ), refunds AS (
      SELECT method, sum(amount_pence)::integer AS refunded_pence
      FROM public.payment_events
      WHERE order_id = p_order_id AND direction = 'refund'
      GROUP BY method
    )
    SELECT s.method, greatest(s.sales_pence - coalesce(r.refunded_pence, 0), 0)::integer AS available_pence
    FROM sales s LEFT JOIN refunds r USING (method)
    WHERE s.sales_pence - coalesce(r.refunded_pence, 0) > 0
    ORDER BY s.first_sale_at, s.method
  LOOP
    EXIT WHEN v_unallocated = 0;
    v_take := least(v_unallocated, v_method.available_pence);
    IF v_take > 0 THEN
      v_money := v_money || jsonb_build_object(
        'method', v_method.method,
        'amount_pence', v_take,
        'remaining_refundable_pence', v_method.available_pence - v_take
      );
      v_unallocated := v_unallocated - v_take;
    END IF;
  END LOOP;

  IF v_unallocated <> 0 THEN
    RAISE EXCEPTION 'Refund exceeds the remaining per-method tender balance.' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object('total_amount_pence', v_total, 'lines', v_lines, 'money', v_money);
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_refund_v18(uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preview_refund_order_v18(p_order_id uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_manager(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF v_order.status <> 'collected' THEN
    RAISE EXCEPTION 'Only a collected order can be refunded.' USING ERRCODE = '22023';
  END IF;
  RETURN public.calculate_refund_v18(p_order_id, p_lines);
END;
$$;

REVOKE ALL ON FUNCTION public.preview_refund_order_v18(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_refund_order_v18(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refund_order_v18(
  p_refund_operation_id uuid,
  p_order_id uuid,
  p_lines jsonb,
  p_stock_dispositions jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_existing public.refund_operations%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_preview jsonb;
  v_preview_line jsonb;
  v_money_line jsonb;
  v_disposition text;
  v_business_date date;
  v_group_id uuid;
  v_original record;
  v_batch public.inventory_batches%ROWTYPE;
  v_prior_reversed numeric;
  v_available numeric;
  v_needed numeric;
  v_take numeric;
  v_before numeric;
  v_after numeric;
  v_reversal_id uuid;
  v_waste_id uuid;
  v_waste_movement_id uuid;
  v_restocked numeric;
  v_discarded numeric;
  v_total_reversed numeric := 0;
  v_movement_ids jsonb;
  v_waste_ids jsonb;
  v_receipt_lines jsonb := '[]'::jsonb;
  v_receipt jsonb;
  v_event_id uuid;
  v_disposition_count integer;
  v_disposition_distinct_count integer;
  v_line_count integer;
  v_alert_threshold_pence integer;
  v_alert_id uuid;
  v_alert_inserted integer := 0;
  v_request_fingerprint text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF p_refund_operation_id IS NULL THEN
    RAISE EXCEPTION 'Refund operation id is required.' USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Refund reason is required (maximum 500 characters).' USING ERRCODE = '22023';
  END IF;

  -- Same row lock as collection/amendment: money, stock and version freeze cannot interleave.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_manager(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  IF p_stock_dispositions IS NULL OR jsonb_typeof(p_stock_dispositions) <> 'array' THEN
    RAISE EXCEPTION 'Choose what happened to every refunded item.' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Choose at least one refund line.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.parse_refund_lines_v18(p_lines) l
    WHERE l.quantity IS NULL OR l.quantity <= 0 OR scale(l.quantity) > 3
  ) THEN
    RAISE EXCEPTION 'Refund quantities must be positive with at most three decimal places.'
      USING ERRCODE = '22023';
  END IF;
  v_request_fingerprint := encode(extensions.digest(jsonb_build_object(
    'order_id', p_order_id,
    'reason', v_reason,
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'order_item_id', l.order_item_id,
        'quantity_milli', round(l.quantity * 1000)::bigint
      ) ORDER BY l.order_item_id)
      FROM public.parse_refund_lines_v18(p_lines) l
    ), '[]'::jsonb),
    'dispositions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'order_item_id', d.order_item_id,
        'disposition', d.disposition
      ) ORDER BY d.order_item_id)
      FROM public.parse_refund_dispositions_v18(p_stock_dispositions) d
    ), '[]'::jsonb)
  )::text, 'sha256'), 'hex');

  SELECT * INTO v_existing FROM public.refund_operations WHERE id = p_refund_operation_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.order_id <> p_order_id THEN
      RAISE EXCEPTION 'Refund operation id was already used for another order.' USING ERRCODE = '22023';
    END IF;
    IF v_existing.request_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'Refund operation was already completed with different details.' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.receipt || jsonb_build_object('replayed', true);
  END IF;

  IF v_order.status <> 'collected' THEN
    RAISE EXCEPTION 'Only a collected order can be refunded.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*), count(DISTINCT order_item_id)
  INTO v_disposition_count, v_disposition_distinct_count
  FROM public.parse_refund_dispositions_v18(p_stock_dispositions);
  SELECT count(*) INTO v_line_count FROM public.parse_refund_lines_v18(p_lines);
  IF v_disposition_count <> v_line_count OR v_disposition_count <> v_disposition_distinct_count THEN
    RAISE EXCEPTION 'Choose one stock disposition for every refund line.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.parse_refund_dispositions_v18(p_stock_dispositions)
    WHERE disposition IS NULL
       OR disposition NOT IN ('customer_kept', 'returned_restockable', 'returned_discarded')
  ) OR EXISTS (
    SELECT 1 FROM public.parse_refund_lines_v18(p_lines) l
    LEFT JOIN public.parse_refund_dispositions_v18(p_stock_dispositions) d USING (order_item_id)
    WHERE d.order_item_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Unknown or missing stock disposition.' USING ERRCODE = '22023';
  END IF;

  -- Re-run the shared calculator under the order lock; the preview can never be authority.
  v_preview := public.calculate_refund_v18(p_order_id, p_lines);
  v_business_date := public.branch_business_date(v_order.branch_id, now());

  IF EXISTS (
    SELECT 1 FROM public.parse_refund_dispositions_v18(p_stock_dispositions)
    WHERE disposition IN ('returned_restockable', 'returned_discarded')
  ) THEN
    INSERT INTO public.inventory_reversal_groups(
      order_id, branch_id, source_event, reason, total_reversed_kg, created_by, refund_operation_id
    ) VALUES (
      p_order_id, v_order.branch_id, 'REFUND_LINE_REVERSAL', v_reason, 0, v_actor, p_refund_operation_id
    ) RETURNING id INTO v_group_id;
  END IF;

  FOR v_preview_line IN
    SELECT value FROM jsonb_array_elements(v_preview->'lines') ORDER BY value->>'order_item_id'
  LOOP
    SELECT disposition INTO v_disposition
    FROM public.parse_refund_dispositions_v18(p_stock_dispositions)
    WHERE order_item_id = (v_preview_line->>'order_item_id')::uuid;

    v_needed := (v_preview_line->>'quantity')::numeric;
    v_restocked := 0;
    v_discarded := 0;
    v_movement_ids := '[]'::jsonb;
    v_waste_ids := '[]'::jsonb;

    IF v_disposition IN ('returned_restockable', 'returned_discarded') THEN
      FOR v_original IN
        SELECT m.*
        FROM public.inventory_movements m
        WHERE m.order_id = p_order_id
          AND m.order_item_id = (v_preview_line->>'order_item_id')::uuid
          AND m.source_event = 'SALE_COLLECT'
          AND m.delta_kg < 0
        ORDER BY m.created_at, m.id
      LOOP
        EXIT WHEN v_needed <= 0;
        SELECT coalesce(sum(r.quantity_kg), 0) INTO v_prior_reversed
        FROM public.inventory_movements r
        WHERE r.reversal_of_movement_id = v_original.id AND r.delta_kg > 0;
        v_available := greatest(abs(v_original.delta_kg) - v_prior_reversed, 0);
        CONTINUE WHEN v_available <= 0;
        v_take := least(v_needed, v_available);

        SELECT * INTO v_batch FROM public.inventory_batches WHERE id = v_original.batch_id FOR UPDATE;
        IF v_batch.id IS NULL OR v_batch.branch_id <> v_order.branch_id THEN
          RAISE EXCEPTION 'An original depletion batch is unavailable.' USING ERRCODE = 'P0002';
        END IF;
        IF v_disposition = 'returned_restockable'
           AND v_batch.expiry_date < v_business_date THEN
          RAISE EXCEPTION 'Expired returned stock cannot be put back on sale.'
            USING ERRCODE = '22023';
        END IF;
        IF v_disposition = 'returned_restockable'
           AND v_batch.status IN ('recalled', 'disposed') THEN
          RAISE EXCEPTION 'Returned stock cannot be placed into a recalled or disposed batch.'
            USING ERRCODE = '22023';
        END IF;

        v_before := v_batch.remaining_weight_kg;
        v_after := v_before + v_take;
        UPDATE public.inventory_batches
        SET remaining_weight_kg = v_after,
            status = CASE WHEN v_disposition = 'returned_restockable' THEN 'active' ELSE v_batch.status END,
            updated_at = now()
        WHERE id = v_batch.id;

        INSERT INTO public.inventory_movements(
          batch_id, branch_id, movement_type, quantity_kg, delta_kg,
          balance_before_kg, balance_after_kg, source_event, order_id, order_item_id,
          reference_id, reason, created_by, idempotency_key, reversal_group_id,
          reversal_of_movement_id
        ) VALUES (
          v_batch.id, v_order.branch_id, 'ADJUSTMENT', v_take, v_take,
          v_before, v_after, 'REFUND_LINE_REVERSAL', p_order_id,
          (v_preview_line->>'order_item_id')::uuid, v_original.id, v_reason, v_actor,
          'refund:' || p_refund_operation_id || ':' || v_original.id || ':reverse',
          v_group_id, v_original.id
        ) RETURNING id INTO v_reversal_id;
        v_movement_ids := v_movement_ids || to_jsonb(v_reversal_id);
        v_restocked := v_restocked + v_take;
        v_total_reversed := v_total_reversed + v_take;

        IF v_disposition = 'returned_discarded' THEN
          INSERT INTO public.inventory_waste_events(
            batch_id, product_id, waste_kg, reason, notes, created_by,
            refund_operation_id, order_item_id
          ) VALUES (
            v_batch.id, v_batch.product_id, v_take, 'customer_return', v_reason, v_actor,
            p_refund_operation_id, (v_preview_line->>'order_item_id')::uuid
          ) RETURNING id INTO v_waste_id;

          UPDATE public.inventory_batches
          SET remaining_weight_kg = v_before,
              -- Discard is a ledger-visible reverse+waste with net-zero stock.
              -- Preserve the original state, including expired/recalled/depleted,
              -- so the temporary reversal can never make this batch sellable.
              status = v_batch.status,
              updated_at = now()
          WHERE id = v_batch.id;

          INSERT INTO public.inventory_movements(
            batch_id, branch_id, movement_type, quantity_kg, delta_kg,
            balance_before_kg, balance_after_kg, source_event, order_id, order_item_id,
            reference_id, reason, created_by, idempotency_key
          ) VALUES (
            v_batch.id, v_order.branch_id, 'WASTE', v_take, -v_take,
            v_after, v_before, 'REFUND_RETURN_WASTE', p_order_id,
            (v_preview_line->>'order_item_id')::uuid, v_waste_id, 'customer_return', v_actor,
            'refund:' || p_refund_operation_id || ':' || v_original.id || ':waste'
          ) RETURNING id INTO v_waste_movement_id;
          v_movement_ids := v_movement_ids || to_jsonb(v_waste_movement_id);
          v_waste_ids := v_waste_ids || to_jsonb(v_waste_id);
          v_discarded := v_discarded + v_take;
        END IF;

        v_needed := v_needed - v_take;
      END LOOP;

      -- Untracked each/box lines legitimately have no kg allocations. For a kg
      -- line, however, an incomplete exact reversal is a hard atomic failure.
      IF v_needed > 0 AND EXISTS (
        SELECT 1 FROM public.inventory_movements m
        WHERE m.order_id = p_order_id
          AND m.order_item_id = (v_preview_line->>'order_item_id')::uuid
          AND m.source_event = 'SALE_COLLECT' AND m.delta_kg < 0
      ) THEN
        RAISE EXCEPTION 'The exact original depletion allocation is no longer fully reversible.'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    v_receipt_lines := v_receipt_lines || (
      v_preview_line || jsonb_build_object(
        'disposition', v_disposition,
        'restocked_kg', v_restocked,
        'discarded_kg', v_discarded,
        'net_stock_effect_kg', CASE WHEN v_disposition = 'returned_restockable' THEN v_restocked ELSE 0 END,
        'movement_ids', v_movement_ids,
        'waste_event_ids', v_waste_ids
      )
    );
  END LOOP;

  IF v_group_id IS NOT NULL THEN
    UPDATE public.inventory_reversal_groups
    SET total_reversed_kg = v_total_reversed
    WHERE id = v_group_id;
  END IF;

  SELECT coalesce(
    (SELECT s.refund_alert_threshold_pence
     FROM public.branch_settings s
     WHERE s.branch_id = v_order.branch_id),
    2000
  ) INTO v_alert_threshold_pence;

  -- The owner job is part of the refund transaction, not a best-effort action
  -- after commit. A failure here rolls back money and stock; operation-scoped
  -- uniqueness makes a retry/replay incapable of duplicating the job.
  IF (v_preview->>'total_amount_pence')::integer >= v_alert_threshold_pence THEN
    INSERT INTO public.owner_alerts(
      branch_id, severity, kind, summary, entity_ref, created_by
    ) VALUES (
      v_order.branch_id,
      'warning',
      'refund_above_threshold',
      format(
        'Refund recorded: GBP %s for %s.',
        to_char((v_preview->>'total_amount_pence')::numeric / 100, 'FM999999990.00'),
        v_order.order_ref
      ),
      'refund:' || p_refund_operation_id::text,
      v_actor
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_alert_id;
    GET DIAGNOSTICS v_alert_inserted = ROW_COUNT;

    IF v_alert_id IS NULL THEN
      SELECT a.id INTO v_alert_id
      FROM public.owner_alerts a
      WHERE a.branch_id = v_order.branch_id
        AND a.kind = 'refund_above_threshold'
        AND a.entity_ref = 'refund:' || p_refund_operation_id::text;
    END IF;
    IF v_alert_id IS NULL THEN
      RAISE EXCEPTION 'The refund owner alert could not be recorded.' USING ERRCODE = '23514';
    END IF;
    IF v_alert_inserted = 1 THEN
      PERFORM public.emit_audit_log(
        'inventory_reconciliation_issue', 'owner_alert', v_alert_id, v_order.branch_id,
        jsonb_build_object(
          'kind', 'refund_above_threshold',
          'refund_operation_id', p_refund_operation_id,
          'amount_pence', (v_preview->>'total_amount_pence')::integer,
          'order_id', p_order_id,
          'order_ref', v_order.order_ref
        )
      );
    END IF;
  END IF;

  v_receipt := jsonb_build_object(
    'refund_operation_id', p_refund_operation_id,
    'order_id', p_order_id,
    'order_ref', v_order.order_ref,
    'total_amount_pence', (v_preview->>'total_amount_pence')::integer,
    'business_date', v_business_date,
    'owner_alert_id', v_alert_id,
    'money', v_preview->'money',
    'lines', v_receipt_lines,
    'reason', v_reason,
    'replayed', false
  );

  INSERT INTO public.refund_operations(
    id, branch_id, order_id, reason, total_amount_pence, business_date, actor_id,
    request_fingerprint, receipt
  ) VALUES (
    p_refund_operation_id, v_order.branch_id, p_order_id, v_reason,
    (v_preview->>'total_amount_pence')::integer, v_business_date, v_actor,
    v_request_fingerprint, v_receipt
  );

  FOR v_preview_line IN SELECT value FROM jsonb_array_elements(v_receipt_lines)
  LOOP
    INSERT INTO public.refund_line_outcomes(
      refund_operation_id, branch_id, order_id, order_item_id, quantity,
      amount_pence, disposition, restocked_kg, discarded_kg, movement_ids, waste_event_ids
    ) VALUES (
      p_refund_operation_id, v_order.branch_id, p_order_id,
      (v_preview_line->>'order_item_id')::uuid,
      (v_preview_line->>'quantity')::numeric,
      (v_preview_line->>'amount_pence')::integer,
      v_preview_line->>'disposition',
      (v_preview_line->>'restocked_kg')::numeric,
      (v_preview_line->>'discarded_kg')::numeric,
      v_preview_line->'movement_ids', v_preview_line->'waste_event_ids'
    );
  END LOOP;

  FOR v_money_line IN SELECT value FROM jsonb_array_elements(v_preview->'money')
  LOOP
    INSERT INTO public.payment_events(
      branch_id, order_id, direction, method, amount_pence, actor_id, reason,
      business_date, idempotency_key, refund_operation_id
    ) VALUES (
      v_order.branch_id, p_order_id, 'refund', v_money_line->>'method',
      (v_money_line->>'amount_pence')::integer, v_actor, v_reason, v_business_date,
      'refund:' || p_refund_operation_id || ':' || (v_money_line->>'method'),
      p_refund_operation_id
    ) RETURNING id INTO v_event_id;
  END LOOP;

  PERFORM public.emit_audit_log(
    'order_refunded', 'order', p_order_id, v_order.branch_id,
    jsonb_build_object(
      'refund_operation_id', p_refund_operation_id,
      'order_ref', v_order.order_ref,
      'amount_pence', (v_preview->>'total_amount_pence')::integer,
      'money', v_preview->'money',
      'line_count', jsonb_array_length(v_receipt_lines),
      'restocked_kg', (
        SELECT coalesce(sum((x->>'restocked_kg')::numeric), 0)
        FROM jsonb_array_elements(v_receipt_lines) x
      ),
      'discarded_kg', (
        SELECT coalesce(sum((x->>'discarded_kg')::numeric), 0)
        FROM jsonb_array_elements(v_receipt_lines) x
      ),
      'movement_count', (
        SELECT coalesce(sum(jsonb_array_length(x->'movement_ids')), 0)
        FROM jsonb_array_elements(v_receipt_lines) x
      ),
      'waste_event_count', (
        SELECT coalesce(sum(jsonb_array_length(x->'waste_event_ids')), 0)
        FROM jsonb_array_elements(v_receipt_lines) x
      ),
      'request_fingerprint', v_request_fingerprint
    )
  );

  RETURN v_receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_order_v18(uuid, uuid, jsonb, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_order_v18(uuid, uuid, jsonb, jsonb, text)
  TO authenticated, service_role;

-- Extend the trusted audit vocabulary. This is the latest emit_audit_log body
-- (202607141200) with B3/B4's two append-only order correction events added.
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
    'order_tender_recorded', 'till_event_recorded',
    'order_refunded', 'order_amended'
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
      RAISE EXCEPTION 'system audit emission requires an explicit reason' USING ERRCODE = '22023';
    END IF;
    v_actor := NULL;
  ELSE
    v_actor := v_uid;
    IF p_system_reason IS NOT NULL THEN
      RAISE EXCEPTION 'only system callers may set a system reason' USING ERRCODE = '42501';
    END IF;
    IF p_branch_id IS NOT NULL AND NOT public.is_branch_staff(p_branch_id) THEN
      RAISE EXCEPTION 'not authorised to write audit evidence for this branch' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_metadata := coalesce(p_metadata, '{}'::jsonb);
  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'audit metadata must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF length(v_metadata::text) > 8192 THEN
    RAISE EXCEPTION 'audit metadata exceeds the maximum allowed size' USING ERRCODE = '22023';
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
  INSERT INTO public.audit_logs(event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (p_event_type, p_target_type, p_target_id, p_branch_id, v_actor, v_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text)
  TO service_role;

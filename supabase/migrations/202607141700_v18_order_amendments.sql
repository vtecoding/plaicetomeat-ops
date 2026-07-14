-- V18 B4 — weigh-at-handover amendments (PTM-OPS-006).
--
-- Immutable order-item snapshots remain untouched. Ordered amendment facts are
-- folded by one authoritative PostgreSQL function. Collection locks the order,
-- freezes one sequence, and derives both tender and depletion from that exact
-- projection; every read surface consumes the same SQL projection.

CREATE TABLE public.order_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  order_item_id uuid NOT NULL REFERENCES public.order_items(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  kind text NOT NULL CHECK (kind IN ('weight_adjust', 'substitute', 'remove')),
  old_quantity numeric(10,3) NOT NULL CHECK (old_quantity > 0),
  new_quantity numeric(10,3) NOT NULL CHECK (new_quantity >= 0),
  old_line_total_pence integer NOT NULL CHECK (old_line_total_pence >= 0),
  new_line_total_pence integer NOT NULL CHECK (new_line_total_pence >= 0),
  old_unit_price_pence integer NOT NULL CHECK (old_unit_price_pence >= 0),
  new_unit_price_pence integer NOT NULL CHECK (new_unit_price_pence >= 0),
  substitute_product_id uuid REFERENCES public.products(id),
  substitute_product_name_snapshot text,
  substitute_unit_type_snapshot text CHECK (
    substitute_unit_type_snapshot IS NULL OR substitute_unit_type_snapshot IN ('kg', 'each', 'box')
  ),
  price_increase_confirmed boolean NOT NULL DEFAULT false,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  reason text CHECK (reason IS NULL OR length(reason) <= 500),
  idempotency_key text NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) > 0),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, sequence),
  CONSTRAINT order_amendments_kind_shape CHECK (
    (kind = 'weight_adjust' AND substitute_product_id IS NULL AND new_quantity > 0)
    OR (kind = 'substitute' AND substitute_product_id IS NOT NULL AND new_quantity > 0)
    OR (kind = 'remove' AND substitute_product_id IS NULL AND new_quantity < old_quantity)
  )
);

CREATE INDEX order_amendments_order_item_sequence_idx
  ON public.order_amendments(order_id, order_item_id, sequence);

-- Durable per-line collection classification. Inventory movements alone cannot
-- distinguish a deliberately untracked line from a tracked line with a 100%
-- stock shortfall, so refund caps must consume this immutable outcome.
CREATE TABLE public.order_inventory_line_depletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  order_item_id uuid NOT NULL REFERENCES public.order_items(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  product_id uuid REFERENCES public.products(id),
  source_event text NOT NULL DEFAULT 'SALE_COLLECT' CHECK (source_event = 'SALE_COLLECT'),
  unit_type text NOT NULL CHECK (unit_type IN ('kg', 'each', 'box')),
  inventory_policy_snapshot text NOT NULL CHECK (inventory_policy_snapshot IN ('kg_batch', 'untracked_manual')),
  effective_quantity numeric(10,3) NOT NULL CHECK (effective_quantity > 0),
  is_weight_tracked boolean NOT NULL,
  depleted_quantity numeric(10,3) NOT NULL DEFAULT 0 CHECK (depleted_quantity >= 0),
  shortfall_quantity numeric(10,3) NOT NULL DEFAULT 0 CHECK (shortfall_quantity >= 0),
  amendment_seq integer NOT NULL CHECK (amendment_seq >= 0),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, order_item_id, source_event),
  CHECK (
    (is_weight_tracked AND depleted_quantity + shortfall_quantity = effective_quantity)
    OR (NOT is_weight_tracked AND depleted_quantity = 0 AND shortfall_quantity = 0)
  )
);

ALTER TABLE public.order_inventory_line_depletions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read branch line depletion outcomes"
  ON public.order_inventory_line_depletions
  FOR SELECT USING (public.is_branch_staff(branch_id));
REVOKE ALL ON public.order_inventory_line_depletions FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_inventory_line_depletions FROM authenticated;

CREATE OR REPLACE FUNCTION public.prevent_order_inventory_line_depletion_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Order line depletion outcomes are append-only.' USING ERRCODE = '25006';
END;
$$;
CREATE TRIGGER order_inventory_line_depletions_append_only_row
BEFORE UPDATE OR DELETE ON public.order_inventory_line_depletions
FOR EACH ROW EXECUTE FUNCTION public.prevent_order_inventory_line_depletion_mutation();
CREATE TRIGGER order_inventory_line_depletions_append_only_truncate
BEFORE TRUNCATE ON public.order_inventory_line_depletions
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_order_inventory_line_depletion_mutation();

ALTER TABLE public.order_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read branch order amendments" ON public.order_amendments
FOR SELECT USING (public.is_branch_staff(branch_id));
REVOKE ALL ON public.order_amendments FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_amendments FROM authenticated;

CREATE OR REPLACE FUNCTION public.prevent_order_amendment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Order amendments are append-only; append another amendment instead'
    USING ERRCODE = '25006';
END;
$$;

CREATE TRIGGER order_amendments_append_only_row
BEFORE UPDATE OR DELETE ON public.order_amendments
FOR EACH ROW EXECUTE FUNCTION public.prevent_order_amendment_mutation();
CREATE TRIGGER order_amendments_append_only_truncate
BEFORE TRUNCATE ON public.order_amendments
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_order_amendment_mutation();

ALTER TABLE public.order_inventory_depletions
  ADD COLUMN IF NOT EXISTS amendment_seq integer NOT NULL DEFAULT 0 CHECK (amendment_seq >= 0);

-- The one authoritative ordered fold. Every immutable source item remains in
-- the result (removed lines carry quantity/total zero) so manager screens can
-- show ordered versus final. Money/depletion/public reads filter is_removed.
CREATE OR REPLACE FUNCTION public.get_effective_order_lines_v18(
  p_order_id uuid,
  p_up_to_sequence integer DEFAULT NULL
)
RETURNS TABLE (
  source_order_item_id uuid,
  product_id uuid,
  product_name text,
  unit_type text,
  effective_quantity numeric,
  effective_unit_price_pence integer,
  line_total_pence integer,
  original_product_id uuid,
  original_product_name text,
  original_unit_type text,
  original_quantity numeric,
  original_unit_price_pence integer,
  original_line_total_pence integer,
  applied_sequence integer,
  fold_sequence integer,
  order_subtotal_pence integer,
  is_removed boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE states AS (
    SELECT
      oi.id AS source_order_item_id,
      oi.product_id,
      oi.product_name_snapshot AS product_name,
      oi.unit_type,
      oi.quantity::numeric AS effective_quantity,
      round(oi.unit_price_snapshot * 100)::integer AS effective_unit_price_pence,
      round(oi.line_total * 100)::integer AS line_total_pence,
      oi.product_id AS original_product_id,
      oi.product_name_snapshot AS original_product_name,
      oi.unit_type AS original_unit_type,
      oi.quantity::numeric AS original_quantity,
      round(oi.unit_price_snapshot * 100)::integer AS original_unit_price_pence,
      round(oi.line_total * 100)::integer AS original_line_total_pence,
      0::integer AS applied_sequence,
      oi.created_at AS source_created_at
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id

    UNION ALL

    SELECT
      s.source_order_item_id,
      CASE WHEN a.kind = 'substitute' THEN a.substitute_product_id ELSE s.product_id END,
      CASE WHEN a.kind = 'substitute' THEN a.substitute_product_name_snapshot ELSE s.product_name END,
      CASE WHEN a.kind = 'substitute' THEN a.substitute_unit_type_snapshot ELSE s.unit_type END,
      a.new_quantity,
      a.new_unit_price_pence,
      a.new_line_total_pence,
      s.original_product_id,
      s.original_product_name,
      s.original_unit_type,
      s.original_quantity,
      s.original_unit_price_pence,
      s.original_line_total_pence,
      a.sequence,
      s.source_created_at
    FROM states s
    JOIN LATERAL (
      SELECT a.*
      FROM public.order_amendments a
      WHERE a.order_id = p_order_id
        AND a.order_item_id = s.source_order_item_id
        AND a.sequence > s.applied_sequence
        AND (p_up_to_sequence IS NULL OR a.sequence <= p_up_to_sequence)
      ORDER BY a.sequence
      LIMIT 1
    ) a ON true
  ), latest AS (
    SELECT DISTINCT ON (s.source_order_item_id) s.*
    FROM states s
    ORDER BY s.source_order_item_id, s.applied_sequence DESC
  ), frozen AS (
    SELECT coalesce(max(a.sequence), 0)::integer AS sequence
    FROM public.order_amendments a
    WHERE a.order_id = p_order_id
      AND (p_up_to_sequence IS NULL OR a.sequence <= p_up_to_sequence)
  ), subtotal AS (
    SELECT coalesce(sum(l.line_total_pence) FILTER (WHERE l.effective_quantity > 0), 0)::integer AS pence
    FROM latest l
  )
  SELECT
    l.source_order_item_id,
    l.product_id,
    l.product_name,
    l.unit_type,
    l.effective_quantity,
    l.effective_unit_price_pence,
    l.line_total_pence,
    l.original_product_id,
    l.original_product_name,
    l.original_unit_type,
    l.original_quantity,
    l.original_unit_price_pence,
    l.original_line_total_pence,
    l.applied_sequence,
    f.sequence,
    st.pence,
    l.effective_quantity <= 0
  FROM latest l CROSS JOIN frozen f CROSS JOIN subtotal st
  ORDER BY l.source_created_at, l.source_order_item_id;
$$;

REVOKE ALL ON FUNCTION public.get_effective_order_lines_v18(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_order_lines_v18(uuid, integer)
  TO authenticated, service_role;

-- Bounded server-side business-history projection. This is deliberately a
-- wrapper over the one authoritative fold above: intelligence reads never
-- fall back to mutable orders.subtotal or immutable pre-amendment item rows.
-- A recently collected pre-order is included by its sale event even when the
-- order header itself was created before the requested history window.
CREATE OR REPLACE FUNCTION public.get_branch_effective_order_lines_v18(
  p_branch_id uuid,
  p_since timestamptz
)
RETURNS TABLE (
  order_id uuid,
  customer_name text,
  customer_phone text,
  order_status text,
  is_test boolean,
  order_created_at timestamptz,
  source_order_item_id uuid,
  product_id uuid,
  product_name text,
  unit_type text,
  effective_quantity numeric,
  effective_unit_price_pence integer,
  line_total_pence integer,
  order_subtotal_pence integer,
  refunded_quantity numeric,
  refunded_amount_pence integer,
  returned_quantity numeric,
  stock_returned_kg numeric,
  is_removed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    o.customer_name,
    o.customer_phone,
    o.status,
    coalesce(o.is_test, false),
    o.created_at,
    e.source_order_item_id,
    e.product_id,
    e.product_name,
    e.unit_type,
    e.effective_quantity,
    e.effective_unit_price_pence,
    e.line_total_pence,
    e.order_subtotal_pence,
    coalesce(r.refunded_quantity, 0),
    coalesce(r.refunded_amount_pence, 0),
    coalesce(r.returned_quantity, 0),
    coalesce(r.stock_returned_kg, 0),
    e.is_removed
  FROM public.orders o
  CROSS JOIN LATERAL public.get_effective_order_lines_v18(o.id, NULL) e
  LEFT JOIN LATERAL (
    SELECT
      sum(rlo.quantity)::numeric AS refunded_quantity,
      sum(rlo.amount_pence)::integer AS refunded_amount_pence,
      (sum(rlo.quantity) FILTER (
        WHERE rlo.disposition IN ('returned_restockable', 'returned_discarded')
      ))::numeric AS returned_quantity,
      sum(rlo.restocked_kg)::numeric AS stock_returned_kg
    FROM public.refund_line_outcomes rlo
    WHERE rlo.order_id = o.id
      AND rlo.order_item_id = e.source_order_item_id
  ) r ON true
  WHERE o.branch_id = p_branch_id
    AND p_since IS NOT NULL
    AND (
      o.created_at >= p_since
      OR EXISTS (
        SELECT 1
        FROM public.payment_events pe
        WHERE pe.order_id = o.id
          AND pe.branch_id = p_branch_id
          AND pe.direction = 'sale'
          AND pe.created_at >= p_since
      )
    )
  ORDER BY o.created_at, o.id, e.source_order_item_id;
$$;

REVOKE ALL ON FUNCTION public.get_branch_effective_order_lines_v18(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_branch_effective_order_lines_v18(uuid, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.amend_order_item_v18(
  p_order_id uuid,
  p_order_item_id uuid,
  p_kind text,
  p_new_quantity numeric,
  p_substitute_product_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_expected_seq integer,
  p_confirm_price_increase boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_existing public.order_amendments%ROWTYPE;
  v_current record;
  v_target public.products%ROWTYPE;
  v_current_seq integer;
  v_new_seq integer;
  v_new_quantity numeric(10,3);
  v_new_unit_price integer;
  v_new_total integer;
  v_new_product_id uuid;
  v_new_product_name text;
  v_new_unit_type text;
  v_price_increase boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_amendment_id uuid;
  v_effective jsonb;
  v_request_fingerprint text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('weight_adjust', 'substitute', 'remove') THEN
    RAISE EXCEPTION 'Unknown amendment kind.' USING ERRCODE = '22023';
  END IF;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Amendment idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Amendment reason is too long.' USING ERRCODE = '22023';
  END IF;
  IF p_new_quantity IS NOT NULL AND (p_new_quantity < 0 OR scale(p_new_quantity) > 3) THEN
    RAISE EXCEPTION 'Amendment quantity must have at most three decimal places.' USING ERRCODE = '22023';
  END IF;
  v_request_fingerprint := encode(extensions.digest(jsonb_build_object(
    'order_id', p_order_id,
    'order_item_id', p_order_item_id,
    'kind', p_kind,
    'new_quantity_milli', CASE
      WHEN p_new_quantity IS NULL THEN NULL
      ELSE round(p_new_quantity * 1000)::bigint
    END,
    'substitute_product_id', p_substitute_product_id,
    'reason', v_reason,
    'expected_sequence', p_expected_seq,
    'confirm_price_increase', coalesce(p_confirm_price_increase, false)
  )::text, 'sha256'), 'hex');

  -- Fail one side of a genuinely overlapping amend/collect race cleanly. The
  -- row lock below remains the authoritative serialization point; this
  -- transaction advisory lock prevents the loser merely waiting and then
  -- applying a second action to a version it did not start with.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('v18-order:' || p_order_id::text, 0)) THEN
    RAISE EXCEPTION 'This order is being changed on another screen. Refresh and try again.'
      USING ERRCODE = '55P03';
  END IF;

  -- Same serialisation point as collection/refund/depletion.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.order_amendments WHERE idempotency_key = v_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.order_id <> p_order_id OR v_existing.order_item_id <> p_order_item_id THEN
      RAISE EXCEPTION 'Amendment key was already used for another line.' USING ERRCODE = '22023';
    END IF;
    IF v_existing.request_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'Amendment key was already completed with different details.' USING ERRCODE = '22023';
    END IF;
    SELECT to_jsonb(e) INTO v_effective
    FROM public.get_effective_order_lines_v18(p_order_id, v_existing.sequence) e
    WHERE e.source_order_item_id = p_order_item_id;
    RETURN jsonb_build_object(
      'amendment_id', v_existing.id,
      'sequence', v_existing.sequence,
      'kind', v_existing.kind,
      'price_increase', v_existing.new_line_total_pence > v_existing.old_line_total_pence,
      'effective_line', v_effective,
      'replayed', true
    );
  END IF;

  IF v_order.status NOT IN ('prepping', 'ready') THEN
    RAISE EXCEPTION 'This order can only be adjusted while it is being prepared or ready.'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(sequence), 0)::integer INTO v_current_seq
  FROM public.order_amendments WHERE order_id = p_order_id;
  IF p_expected_seq IS NULL OR p_expected_seq <> v_current_seq THEN
    RAISE EXCEPTION 'This order changed on another screen. Refresh before adjusting it.'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_current
  FROM public.get_effective_order_lines_v18(p_order_id, v_current_seq)
  WHERE source_order_item_id = p_order_item_id;
  IF v_current.source_order_item_id IS NULL THEN
    RAISE EXCEPTION 'Order line not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_current.is_removed THEN
    RAISE EXCEPTION 'A removed line cannot be adjusted again.' USING ERRCODE = '22023';
  END IF;
  -- Remove is terminal even when it was a partial removal. This preserves the
  -- supported composition substitute -> adjust -> partial-remove while making
  -- remove-then-adjust/substitute fail deterministically.
  IF EXISTS (
    SELECT 1 FROM public.order_amendments a
    WHERE a.order_id = p_order_id AND a.order_item_id = p_order_item_id
      AND a.kind = 'remove' AND a.sequence <= v_current_seq
  ) THEN
    RAISE EXCEPTION 'A removed line cannot be adjusted again.' USING ERRCODE = '22023';
  END IF;

  v_new_product_id := v_current.product_id;
  v_new_product_name := v_current.product_name;
  v_new_unit_type := v_current.unit_type;
  v_new_quantity := v_current.effective_quantity;
  v_new_unit_price := v_current.effective_unit_price_pence;

  IF p_kind = 'weight_adjust' THEN
    IF v_current.unit_type <> 'kg' THEN
      RAISE EXCEPTION 'Only a kg line can have its handover weight adjusted.' USING ERRCODE = '22023';
    END IF;
    IF p_new_quantity IS NULL OR p_new_quantity <= 0 OR scale(p_new_quantity) > 3 THEN
      RAISE EXCEPTION 'Actual weight must be positive with at most three decimal places.'
        USING ERRCODE = '22023';
    END IF;
    v_new_quantity := p_new_quantity;

  ELSIF p_kind = 'substitute' THEN
    IF p_substitute_product_id IS NULL THEN
      RAISE EXCEPTION 'Choose a substitute product.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_target FROM public.products WHERE id = p_substitute_product_id;
    IF v_target.id IS NULL OR v_target.branch_id <> v_order.branch_id THEN
      RAISE EXCEPTION 'Substitute product not found for this branch.' USING ERRCODE = 'P0002';
    END IF;
    IF NOT coalesce(v_target.is_available, false)
       OR coalesce(v_target.stock_status, 'out_of_stock') = 'out_of_stock' THEN
      RAISE EXCEPTION 'The substitute product is not currently sellable.' USING ERRCODE = '22023';
    END IF;
    IF v_target.unit_type IS DISTINCT FROM v_current.unit_type THEN
      RAISE EXCEPTION 'Substitute unit type is not compatible with this line.' USING ERRCODE = '22023';
    END IF;
    v_new_product_id := v_target.id;
    v_new_product_name := v_target.name;
    v_new_unit_type := v_target.unit_type;
    v_new_unit_price := round(v_target.price_per_unit * 100)::integer;

  ELSE -- remove, including an explicit partial removal
    v_new_quantity := coalesce(p_new_quantity, 0);
    IF v_new_quantity < 0 OR v_new_quantity >= v_current.effective_quantity OR scale(v_new_quantity) > 3 THEN
      RAISE EXCEPTION 'Removed quantity must leave less than the current line quantity.'
        USING ERRCODE = '22023';
    END IF;
    IF v_current.unit_type IN ('each', 'box') AND v_new_quantity <> trunc(v_new_quantity) THEN
      RAISE EXCEPTION 'Each or box adjustments must leave a whole item count.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_new_total := round(v_new_quantity * v_new_unit_price)::integer;
  v_price_increase := v_new_total > v_current.line_total_pence;
  IF v_price_increase AND NOT coalesce(p_confirm_price_increase, false) THEN
    RAISE EXCEPTION 'Customer confirmation is required for the higher final price of £%.',
      to_char(v_new_total::numeric / 100, 'FM999999990.00')
      USING ERRCODE = '22023';
  END IF;

  v_new_seq := v_current_seq + 1;
  INSERT INTO public.order_amendments(
    branch_id, order_id, order_item_id, sequence, kind, old_quantity, new_quantity,
    old_line_total_pence, new_line_total_pence, old_unit_price_pence,
    new_unit_price_pence, substitute_product_id, substitute_product_name_snapshot,
    substitute_unit_type_snapshot, price_increase_confirmed, actor_id, reason,
    idempotency_key, request_fingerprint
  ) VALUES (
    v_order.branch_id, p_order_id, p_order_item_id, v_new_seq, p_kind,
    v_current.effective_quantity, v_new_quantity, v_current.line_total_pence,
    v_new_total, v_current.effective_unit_price_pence, v_new_unit_price,
    CASE WHEN p_kind = 'substitute' THEN v_new_product_id ELSE NULL END,
    CASE WHEN p_kind = 'substitute' THEN v_new_product_name ELSE NULL END,
    CASE WHEN p_kind = 'substitute' THEN v_new_unit_type ELSE NULL END,
    coalesce(p_confirm_price_increase, false), v_actor, v_reason, v_key,
    v_request_fingerprint
  ) RETURNING id INTO v_amendment_id;

  SELECT to_jsonb(e) INTO v_effective
  FROM public.get_effective_order_lines_v18(p_order_id, v_new_seq) e
  WHERE e.source_order_item_id = p_order_item_id;

  PERFORM public.emit_audit_log(
    'order_amended', 'order', p_order_id, v_order.branch_id,
    jsonb_build_object(
      'order_ref', v_order.order_ref,
      'amendment_id', v_amendment_id,
      'sequence', v_new_seq,
      'kind', p_kind,
      'order_item_id', p_order_item_id,
      'old_quantity', v_current.effective_quantity,
      'new_quantity', v_new_quantity,
      'old_line_total_pence', v_current.line_total_pence,
      'new_line_total_pence', v_new_total,
      'price_increase', v_price_increase,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'amendment_id', v_amendment_id,
    'sequence', v_new_seq,
    'kind', p_kind,
    'price_increase', v_price_increase,
    'effective_line', v_effective,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.amend_order_item_v18(uuid, uuid, text, numeric, uuid, text, text, integer, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amend_order_item_v18(uuid, uuid, text, numeric, uuid, text, text, integer, boolean)
  TO authenticated, service_role;

-- Collection freezes the fold sequence under the order lock. transition_order_status
-- calls the depletion engine in this same transaction; the engine records/uses the
-- same max sequence, which cannot change while this lock is held.
CREATE OR REPLACE FUNCTION public.collect_order_with_tender(
  p_order_id uuid,
  p_method text,
  p_idempotency_key text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_existing public.payment_events%ROWTYPE;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_amount integer;
  v_business_date date;
  v_event_id uuid;
  v_frozen_seq integer;
  v_depletion_seq integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'card') THEN
    RAISE EXCEPTION 'Unknown payment method: %', p_method USING ERRCODE = '22023';
  END IF;
  IF v_key IS NULL THEN RAISE EXCEPTION 'Missing tender idempotency key.' USING ERRCODE = '22023'; END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended('v18-order:' || p_order_id::text, 0)) THEN
    RAISE EXCEPTION 'This order is being changed on another screen. Refresh and try again.'
      USING ERRCODE = '55P03';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.payment_events WHERE idempotency_key = v_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id
       OR v_existing.direction IS DISTINCT FROM 'sale'
       OR v_existing.method IS DISTINCT FROM p_method THEN
      RAISE EXCEPTION 'Tender key was already completed with different details.' USING ERRCODE = '22023';
    END IF;
    SELECT amendment_seq INTO v_depletion_seq
    FROM public.order_inventory_depletions
    WHERE order_id = p_order_id AND source_event = 'SALE_COLLECT';
    RETURN jsonb_build_object(
      'payment_event_id', v_existing.id, 'order_id', v_existing.order_id,
      'method', v_existing.method, 'amount_pence', v_existing.amount_pence,
      'business_date', v_existing.business_date,
      'amendment_seq', coalesce(v_depletion_seq, 0), 'replayed', true
    );
  END IF;

  IF v_order.status = 'collected' THEN
    RAISE EXCEPTION 'Order already collected.' USING ERRCODE = '22023';
  END IF;
  IF v_order.status <> 'ready' THEN
    RAISE EXCEPTION 'Invalid transition from % to collected.', v_order.status USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(sequence), 0)::integer INTO v_frozen_seq
  FROM public.order_amendments WHERE order_id = p_order_id;
  SELECT coalesce(sum(line_total_pence) FILTER (WHERE NOT is_removed), 0)::integer
  INTO v_amount
  FROM public.get_effective_order_lines_v18(p_order_id, v_frozen_seq);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Order has no positive amount to tender.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.transition_order_status(p_order_id, 'collected', p_note);
  SELECT amendment_seq INTO v_depletion_seq
  FROM public.order_inventory_depletions
  WHERE order_id = p_order_id AND source_event = 'SALE_COLLECT';
  IF v_depletion_seq IS DISTINCT FROM v_frozen_seq THEN
    RAISE EXCEPTION 'Collection version did not match inventory depletion version.' USING ERRCODE = '40001';
  END IF;

  v_business_date := public.branch_business_date(v_order.branch_id, now());
  INSERT INTO public.payment_events(
    branch_id, order_id, direction, method, amount_pence, actor_id,
    business_date, idempotency_key
  ) VALUES (
    v_order.branch_id, p_order_id, 'sale', p_method, v_amount, v_actor,
    v_business_date, v_key
  ) RETURNING id INTO v_event_id;

  PERFORM public.emit_audit_log(
    'order_tender_recorded', 'order', p_order_id, v_order.branch_id,
    jsonb_build_object(
      'method', p_method, 'amount_pence', v_amount, 'business_date', v_business_date,
      'order_ref', v_order.order_ref, 'payment_event_id', v_event_id,
      'amendment_seq', v_frozen_seq
    )
  );

  RETURN jsonb_build_object(
    'payment_event_id', v_event_id, 'order_id', p_order_id, 'method', p_method,
    'amount_pence', v_amount, 'business_date', v_business_date,
    'amendment_seq', v_frozen_seq, 'replayed', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.collect_order_with_tender(uuid, text, text, text)
  TO authenticated, service_role;

-- Surgical V14 depletion upgrade: only its line source changes. With no
-- amendments it emits the same SALE_COLLECT movement fields and idempotency keys.
-- A2's inventory_policy isolation is preserved: only kg_batch lines move stock.
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
  v_weight_lines integer := 0;
  v_nonweight_lines integer := 0;
  v_status text;
  v_frozen_seq integer;
  v_line_depleted numeric(10,3);
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;
  IF v_order.status <> 'collected' THEN
    RAISE EXCEPTION 'Stock only moves once an order is collected.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.order_inventory_depletions
  WHERE order_id = p_order_id AND source_event = 'SALE_COLLECT' FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT coalesce(max(sequence), 0)::integer INTO v_frozen_seq
  FROM public.order_amendments WHERE order_id = p_order_id;

  FOR v_item IN
    SELECT e.source_order_item_id AS id, e.product_id, e.product_name,
           e.effective_quantity AS quantity, e.unit_type,
           coalesce(p.inventory_policy, 'untracked_manual') AS inventory_policy
    FROM public.get_effective_order_lines_v18(p_order_id, v_frozen_seq) e
    LEFT JOIN public.products p ON p.id = e.product_id
    ORDER BY e.source_order_item_id
  LOOP
    IF coalesce(v_item.quantity, 0) <= 0 THEN CONTINUE; END IF;
    v_line_depleted := 0;
    IF v_item.product_id IS NULL OR v_item.unit_type <> 'kg' OR v_item.inventory_policy <> 'kg_batch' THEN
      v_nonweight_lines := v_nonweight_lines + 1;
      INSERT INTO public.order_inventory_line_depletions(
        order_id, order_item_id, branch_id, product_id, unit_type,
        inventory_policy_snapshot, effective_quantity, is_weight_tracked,
        depleted_quantity, shortfall_quantity, amendment_seq, created_by
      ) VALUES (
        p_order_id, v_item.id, v_order.branch_id, v_item.product_id, v_item.unit_type,
        CASE WHEN v_item.inventory_policy = 'kg_batch' THEN 'kg_batch' ELSE 'untracked_manual' END,
        v_item.quantity, false, 0, 0, v_frozen_seq, v_actor
      );
      CONTINUE;
    END IF;

    v_weight_lines := v_weight_lines + 1;
    v_needed := v_item.quantity;
    v_total_required := v_total_required + v_needed;

    FOR v_batch IN
      SELECT id, remaining_weight_kg
      FROM public.inventory_batches
      WHERE branch_id = v_order.branch_id AND product_id = v_item.product_id
        AND status = 'active' AND remaining_weight_kg > 0
      ORDER BY expiry_date, received_date, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_needed <= 0;
      v_before := v_batch.remaining_weight_kg;
      v_take := least(v_needed, v_before);
      CONTINUE WHEN v_take <= 0;
      v_after := v_before - v_take;
      UPDATE public.inventory_batches
      SET remaining_weight_kg = v_after,
          status = CASE WHEN v_after = 0 THEN 'depleted' ELSE status END,
          updated_at = now()
      WHERE id = v_batch.id;
      INSERT INTO public.inventory_movements(
        batch_id, branch_id, movement_type, quantity_kg, delta_kg,
        balance_before_kg, balance_after_kg, source_event, order_id, order_item_id,
        idempotency_key, reference_id, reason, created_by
      ) VALUES (
        v_batch.id, v_order.branch_id, 'SALE', v_take, -v_take,
        v_before, v_after, 'SALE_COLLECT', p_order_id, v_item.id,
        p_order_id::text || ':' || v_item.id::text || ':' || v_batch.id::text || ':SALE_COLLECT',
        p_order_id, 'Sold — order ' || v_order.order_ref, v_actor
      );
      v_needed := v_needed - v_take;
      v_total_depleted := v_total_depleted + v_take;
      v_line_depleted := v_line_depleted + v_take;
    END LOOP;

    IF v_needed > 0 THEN
      v_shortfall := v_shortfall + v_needed;
      v_shortfall_detail := v_shortfall_detail || jsonb_build_object(
        'order_item_id', v_item.id,
        'product_id', v_item.product_id, 'product_name', v_item.product_name,
        'required_kg', v_item.quantity, 'depleted_kg', v_line_depleted,
        'short_kg', v_needed
      );
    END IF;
    INSERT INTO public.order_inventory_line_depletions(
      order_id, order_item_id, branch_id, product_id, unit_type,
      inventory_policy_snapshot, effective_quantity, is_weight_tracked,
      depleted_quantity, shortfall_quantity, amendment_seq, created_by
    ) VALUES (
      p_order_id, v_item.id, v_order.branch_id, v_item.product_id, v_item.unit_type,
      'kg_batch', v_item.quantity, true, v_line_depleted, v_needed,
      v_frozen_seq, v_actor
    );
  END LOOP;

  v_status := CASE WHEN v_shortfall > 0 THEN 'completed_with_shortfall' ELSE 'completed' END;
  INSERT INTO public.order_inventory_depletions(
    order_id, branch_id, source_event, status, weight_tracked_lines,
    non_weight_tracked_lines, total_required_kg, total_depleted_kg, shortfall_kg,
    shortfall_detail, created_by, amendment_seq
  ) VALUES (
    p_order_id, v_order.branch_id, 'SALE_COLLECT', v_status, v_weight_lines,
    v_nonweight_lines, v_total_required, v_total_depleted, v_shortfall,
    v_shortfall_detail, v_actor, v_frozen_seq
  ) RETURNING * INTO v_result;

  PERFORM public.emit_audit_log(
    'inventory_depleted_for_order', 'order', p_order_id, v_order.branch_id,
    jsonb_build_object(
      'order_ref', v_order.order_ref, 'weight_tracked_lines', v_weight_lines,
      'non_weight_tracked_lines', v_nonweight_lines, 'total_required_kg', v_total_required,
      'total_depleted_kg', v_total_depleted, 'amendment_seq', v_frozen_seq
    )
  );
  IF v_shortfall > 0 THEN
    PERFORM public.emit_audit_log(
      'inventory_depletion_shortfall', 'order', p_order_id, v_order.branch_id,
      jsonb_build_object('order_ref', v_order.order_ref, 'shortfall_kg', v_shortfall, 'detail', v_shortfall_detail)
    );
  END IF;
  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_result FROM public.order_inventory_depletions
  WHERE order_id = p_order_id AND source_event = 'SALE_COLLECT';
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.deplete_order_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deplete_order_inventory(uuid) TO authenticated, service_role;

-- B3 now consumes the canonical fold (and only the fold) for money/quantity.
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
    e.source_order_item_id, e.product_id, e.product_name, e.unit_type,
    e.effective_quantity, e.effective_unit_price_pence, e.line_total_pence,
    CASE
      WHEN ld.order_item_id IS NOT NULL AND ld.is_weight_tracked
        THEN least(e.effective_quantity, ld.depleted_quantity)
      WHEN ld.order_item_id IS NOT NULL
        THEN e.effective_quantity
      -- Backward-compatible history before line outcomes existed: a movement
      -- proves tracking, and zero-allocation shortfall detail proves tracking
      -- even when no movement could be written.
      WHEN d.depleted_quantity IS NOT NULL
        THEN least(e.effective_quantity, d.depleted_quantity)
      WHEN EXISTS (
        SELECT 1
        FROM public.order_inventory_depletions od,
             LATERAL jsonb_array_elements(coalesce(od.shortfall_detail, '[]'::jsonb)) s
        WHERE od.order_id = p_order_id AND od.source_event = 'SALE_COLLECT'
          AND (
            nullif(s->>'order_item_id', '')::uuid = e.source_order_item_id
            OR (
              s->>'order_item_id' IS NULL
              AND nullif(s->>'product_id', '')::uuid = e.product_id
            )
          )
      ) THEN 0
      ELSE e.effective_quantity
    END
  FROM public.get_effective_order_lines_v18(p_order_id, NULL) e
  LEFT JOIN public.order_inventory_line_depletions ld
    ON ld.order_id = p_order_id
   AND ld.order_item_id = e.source_order_item_id
   AND ld.source_event = 'SALE_COLLECT'
  LEFT JOIN LATERAL (
    SELECT sum(abs(m.delta_kg))::numeric AS depleted_quantity
    FROM public.inventory_movements m
    WHERE m.order_id = p_order_id
      AND m.order_item_id = e.source_order_item_id
      AND m.source_event = 'SALE_COLLECT' AND m.delta_kg < 0
  ) d ON d.depleted_quantity IS NOT NULL
  ORDER BY e.source_order_item_id;
$$;

REVOKE ALL ON FUNCTION public.get_refund_basis_lines_v18(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_refund_basis_lines_v18(uuid) TO service_role;

-- Customer status renders final lines/subtotal from the canonical fold. No
-- customer-sensitive fields are added; unitPrice is a safe final-price field.
CREATE OR REPLACE FUNCTION public.get_public_order_status(p_public_access_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_window_minutes integer;
  v_deadline timestamptz;
  v_can_cancel boolean;
  v_window_label text;
  v_items jsonb;
  v_subtotal_pence integer;
BEGIN
  IF p_public_access_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_order FROM public.orders
  WHERE public_access_id = p_public_access_id AND public_access_revoked_at IS NULL;
  IF v_order.id IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(cancellation_window_minutes, 60) INTO v_window_minutes
  FROM public.branch_settings WHERE branch_id = v_order.branch_id;
  v_window_minutes := coalesce(v_window_minutes, 60);
  v_deadline := v_order.created_at + make_interval(mins => v_window_minutes);
  v_can_cancel := v_order.status = 'incoming' AND now() <= v_deadline;
  SELECT label INTO v_window_label FROM public.pickup_windows WHERE id = v_order.pickup_window_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', e.product_name,
      'quantity', e.effective_quantity,
      'unitType', e.unit_type,
      'unitPrice', e.effective_unit_price_pence::numeric / 100,
      'lineTotal', e.line_total_pence::numeric / 100
    ) ORDER BY e.source_order_item_id), '[]'::jsonb),
    coalesce(max(e.order_subtotal_pence), 0)
  INTO v_items, v_subtotal_pence
  FROM public.get_effective_order_lines_v18(v_order.id, NULL) e
  WHERE NOT e.is_removed;

  RETURN jsonb_build_object(
    'orderRef', v_order.order_ref,
    'customerDisplayName', split_part(btrim(v_order.customer_name), ' ', 1),
    'status', v_order.status,
    'pickupDate', v_order.pickup_date,
    'pickupWindowLabel', coalesce(v_window_label, 'Selected window'),
    'items', v_items,
    'subtotal', v_subtotal_pence::numeric / 100,
    'canCancel', v_can_cancel,
    'cancellationDeadline', CASE WHEN v_order.status = 'incoming'
      THEN to_char(v_deadline AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_order_status(uuid)
  TO anon, authenticated, service_role;

-- V14.1 — Sales-driven stock truth (first real Inventory Truth Engine slice)
-- ============================================================================
-- Goal: when an order is COLLECTED, stock physically leaves the building — so the
-- ledger must move with it. This is the Option-C depletion event from the V14
-- architecture pack (docs/v14/03): collected is the terminal, physical-transfer
-- state, giving the smallest reversal surface and the smallest blast radius
-- (staff-only, post-prep — never the public checkout path).
--
-- Owner-confirmed decisions baked in here:
--   * Unit→kg policy = KG PRODUCTS ONLY. Only order lines on `kg` products move
--     stock (their `quantity` already IS the kg). `each`/`box` products stay
--     sellable and are recorded as "not weight-tracked" — counted manually, never
--     converted with invented nominal weights, never a failure. (F12 deferred to
--     V14.2; see docs/v14/11-each-box-conversion-design.md.)
--   * Oversell policy (belief < physical) = ALLOW + FLAG. Deplete what's available
--     (never below zero — the existing CHECK forbids negative), record an explicit
--     shortfall for a manager to reconcile, and let the collection complete. The
--     meat physically left; we never block a real handover and never go negative. (F11)
--
-- Reuses the proven house primitives (docs/v14/01,06): SECURITY DEFINER + branch
-- gate, pessimistic FOR UPDATE in a deterministic FEFO order, idempotency by unique
-- key + short-circuit, all inside the existing transition_order_status transaction.
-- No behaviour changes to any total except via a recorded movement.
-- ============================================================================

-- 1. Ledger-truth columns on inventory_movements --------------------------------
-- Additive and nullable so legacy rows are untouched. `quantity_kg` stays the
-- positive magnitude (existing CHECK > 0, existing readers); `delta_kg` carries the
-- sign (negative for SALE) and balance_before/after make every row reconstructable.
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS delta_kg numeric(8,3),
  ADD COLUMN IF NOT EXISTS balance_before_kg numeric(8,3),
  ADD COLUMN IF NOT EXISTS balance_after_kg numeric(8,3),
  ADD COLUMN IF NOT EXISTS source_event text,
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- The ledger must never describe a physically impossible negative balance.
-- NOT VALID: applies to new rows only, so the migration never fails on legacy nulls.
ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_balance_after_nonneg;
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_balance_after_nonneg
  CHECK (balance_after_kg IS NULL OR balance_after_kg >= 0) NOT VALID;

-- One SALE movement per (order line, batch) — row-level backstop against
-- double-depletion, beneath the order-level idempotency guard below.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_movements_sale_line_batch
  ON public.inventory_movements (order_item_id, batch_id)
  WHERE source_event = 'SALE_COLLECT';

CREATE INDEX IF NOT EXISTS idx_inventory_movements_order
  ON public.inventory_movements (order_id)
  WHERE order_id IS NOT NULL;

-- 2. Order depletion guard / summary -------------------------------------------
-- Exactly one row per (order, SALE_COLLECT): the idempotency key that collapses
-- duplicate collections, and the record that carries the shortfall flag for the
-- "count this item when convenient" operator nudge.
CREATE TABLE IF NOT EXISTS public.order_inventory_depletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  source_event text NOT NULL DEFAULT 'SALE_COLLECT',
  status text NOT NULL CHECK (status IN ('completed', 'completed_with_shortfall')),
  weight_tracked_lines int NOT NULL DEFAULT 0,
  non_weight_tracked_lines int NOT NULL DEFAULT 0,
  total_required_kg numeric(10,3) NOT NULL DEFAULT 0,
  total_depleted_kg numeric(10,3) NOT NULL DEFAULT 0,
  shortfall_kg numeric(10,3) NOT NULL DEFAULT 0,
  shortfall_detail jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, source_event)
);

ALTER TABLE public.order_inventory_depletions ENABLE ROW LEVEL SECURITY;

-- Read-only to branch staff (drives the operator message + manager reconciliation).
-- No INSERT/UPDATE/DELETE policy: only the SECURITY DEFINER engine below writes here.
DROP POLICY IF EXISTS "staff read branch depletions" ON public.order_inventory_depletions;
CREATE POLICY "staff read branch depletions" ON public.order_inventory_depletions
FOR SELECT USING (public.is_branch_staff(branch_id));

-- 3. Extend the audit allowlist (reproduced verbatim from V11.2 + 2 entries) -----
-- Keeps all sale-depletion evidence on the hardened path: actor-bound, branch-
-- validated, secret-stripped, size-capped, append-only. The ONLY change from the
-- 202606051400 definition is the two new event types in v_allowed.
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
  -- Allowlist mirrors the event_type vocabulary emitted across the schema.
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
    'certificate_uploaded', 'certificate_verified', 'security_event',
    -- V14.1 sales-driven stock truth:
    'inventory_depleted_for_order', 'inventory_depletion_shortfall'
  ];
  -- Secret-like metadata keys are stripped before persistence (case-insensitive).
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

  -- Actor + authority.
  IF v_is_system THEN
    IF p_system_reason IS NULL OR btrim(p_system_reason) = '' THEN
      RAISE EXCEPTION 'system audit emission requires an explicit reason'
        USING ERRCODE = '22023';
    END IF;
    v_actor := NULL;
  ELSE
    v_actor := v_uid;
    IF p_system_reason IS NOT NULL THEN
      RAISE EXCEPTION 'only system callers may set a system reason'
        USING ERRCODE = '42501';
    END IF;
    IF p_branch_id IS NOT NULL AND NOT public.is_branch_staff(p_branch_id) THEN
      RAISE EXCEPTION 'not authorised to write audit evidence for this branch'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Metadata hygiene.
  v_metadata := coalesce(p_metadata, '{}'::jsonb);
  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'audit metadata must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF length(v_metadata::text) > 8192 THEN
    RAISE EXCEPTION 'audit metadata exceeds the maximum allowed size'
      USING ERRCODE = '22023';
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

  INSERT INTO public.audit_logs (event_type, target_type, target_id, branch_id, actor_id, metadata)
  VALUES (p_event_type, p_target_type, p_target_id, p_branch_id, v_actor, v_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emit_audit_log(text, text, uuid, uuid, jsonb, text)
  TO authenticated, service_role;

-- 4. The depletion engine ------------------------------------------------------
-- SECURITY DEFINER so it can write the ledger from inside transition_order_status
-- (which runs SECURITY INVOKER) — exactly how that function already nests
-- emit_audit_log. auth.uid() still resolves to the acting staff member, so branch
-- authority and audit actor are real. Idempotent, FEFO, never negative.
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

  -- Lock the order (already held by transition_order_status on the normal path; a
  -- direct call takes the lock here). RLS is bypassed under DEFINER, so we assert
  -- branch authority explicitly below (defence in depth, F9/F17).
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_branch_staff(v_order.branch_id) THEN
    RAISE EXCEPTION 'Not authorised for this branch.' USING ERRCODE = '42501';
  END IF;

  -- Stock only moves as a consequence of collection. Blocks misuse on other states.
  IF v_order.status <> 'collected' THEN
    RAISE EXCEPTION 'Stock only moves once an order is collected.' USING ERRCODE = '22023';
  END IF;

  -- F1 idempotency: a prior collection already moved this order's stock.
  SELECT * INTO v_existing FROM public.order_inventory_depletions
    WHERE order_id = p_order_id AND source_event = 'SALE_COLLECT'
    FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Walk the order lines. Only weight (kg) products move stock in this slice.
  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.product_name_snapshot, oi.quantity, p.unit_type
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
    ORDER BY oi.id
  LOOP
    IF v_item.product_id IS NULL
       OR coalesce(v_item.unit_type, '') <> 'kg'
       OR coalesce(v_item.quantity, 0) <= 0 THEN
      -- Not weight-tracked: stays sellable, counted manually. No movement, no failure.
      v_nonweight_lines := v_nonweight_lines + 1;
      CONTINUE;
    END IF;

    v_weight_lines := v_weight_lines + 1;
    v_needed := v_item.quantity;
    v_total_required := v_total_required + v_needed;

    -- FEFO: soonest expiry first, total deterministic order; lock the candidate set
    -- in that same order so concurrent depletions on shared batches serialize
    -- (no lost updates, no deadlock). recalled/disposed batches are excluded.
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
      v_before := v_batch.remaining_weight_kg;          -- read under lock (F4)
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

    -- F11 oversell: goods left the shop but the ledger believed less remained.
    -- Deplete-available (done above, floored at 0), record the shortfall, allow it.
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

  -- Audit evidence: which order, which lines, how much, who, when.
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
    -- Lost a genuine race to a concurrent collection (F1/F6): the winner already
    -- wrote the guard row + movements. Return the winner's summary; never double.
    SELECT * INTO v_result FROM public.order_inventory_depletions
      WHERE order_id = p_order_id AND source_event = 'SALE_COLLECT';
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.deplete_order_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deplete_order_inventory(uuid) TO authenticated, service_role;

-- 5. Hook depletion into the collection transition ------------------------------
-- Reproduced from the V11.2 definition (202606051400) UNCHANGED except for the
-- single PERFORM in the collected branch. The status flip and the stock movement
-- now commit together or not at all (Invariant 13): if depletion throws, the
-- whole transition rolls back and the order stays `ready`.
CREATE OR REPLACE FUNCTION public.transition_order_status(
  p_order_id uuid,
  p_next_status text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
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

  -- Trusted audit path (was an inline INSERT INTO public.audit_logs).
  PERFORM public.emit_audit_log(
    'order_status_changed',
    'order',
    p_order_id,
    v_order.branch_id,
    jsonb_build_object('from', v_order.status, 'to', p_next_status, 'order_ref', v_order.order_ref)
  );

  -- V14.1: a collected order moves stock, in this same transaction and lock.
  IF p_next_status = 'collected' THEN
    PERFORM public.deplete_order_inventory(p_order_id);
  END IF;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_order_status(uuid, text, text) TO authenticated;

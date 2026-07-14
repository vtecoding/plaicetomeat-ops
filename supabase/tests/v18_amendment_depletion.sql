\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_v18(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'ASSERTION FAILED: %', message; END IF;
END;
$$;

DO $$
DECLARE
  b uuid := '00000000-0000-4000-8000-000000000001';
  manager_id uuid;
  staff_id uuid;
  cross_branch_staff_id uuid;
  beef uuid := 'b4000000-0000-4000-8000-000000000001';
  lamb uuid := 'b4000000-0000-4000-8000-000000000002';
  each_product uuid := 'b4000000-0000-4000-8000-000000000003';
  inactive_lamb uuid := 'b4000000-0000-4000-8000-000000000004';
  out_of_stock_lamb uuid := 'b4000000-0000-4000-8000-000000000005';
  beef_batch uuid := 'b4000000-0000-4000-8000-000000000101';
  lamb_batch uuid := 'b4000000-0000-4000-8000-000000000102';
  order_composed uuid := 'b4000000-0000-4000-8000-000000000201';
  order_identity uuid := 'b4000000-0000-4000-8000-000000000202';
  order_access uuid := 'b4000000-0000-4000-8000-000000000203';
  order_each uuid := 'b4000000-0000-4000-8000-000000000204';
  item_composed uuid := 'b4000000-0000-4000-8000-000000000301';
  item_identity uuid := 'b4000000-0000-4000-8000-000000000302';
  item_access uuid := 'b4000000-0000-4000-8000-000000000303';
  item_each uuid := 'b4000000-0000-4000-8000-000000000304';
  r jsonb;
  folded record;
  failed boolean;
  movement record;
  amendment_count integer;
  audit_count integer;
  stock_before numeric;
BEGIN
  SELECT id INTO manager_id FROM public.profiles WHERE branch_id = b AND role = 'manager' AND is_active LIMIT 1;
  SELECT id INTO staff_id FROM public.profiles WHERE branch_id = b AND role = 'staff' AND is_active LIMIT 1;
  SELECT id INTO cross_branch_staff_id FROM public.profiles WHERE branch_id <> b AND is_active LIMIT 1;
  PERFORM pg_temp.assert_v18(
    manager_id IS NOT NULL AND staff_id IS NOT NULL AND cross_branch_staff_id IS NOT NULL,
    'seeded manager, staff and cross-branch staff required'
  );
  PERFORM set_config('request.jwt.claim.sub', manager_id::text, true);

  INSERT INTO public.products(id, branch_id, name, slug, unit_type, inventory_policy, price_per_unit, is_available, stock_status)
  VALUES
    (beef, b, 'B4 beef', 'b4-beef', 'kg', 'kg_batch', 10, true, 'in_stock'),
    (lamb, b, 'B4 lamb', 'b4-lamb', 'kg', 'kg_batch', 12, true, 'in_stock'),
    (each_product, b, 'B4 each', 'b4-each', 'each', 'untracked_manual', 4, true, 'in_stock'),
    (inactive_lamb, b, 'B4 inactive lamb', 'b4-inactive-lamb', 'kg', 'kg_batch', 8, false, 'in_stock'),
    (out_of_stock_lamb, b, 'B4 unavailable lamb', 'b4-unavailable-lamb', 'kg', 'kg_batch', 8, true, 'out_of_stock');
  INSERT INTO public.inventory_batches(
    id, product_id, branch_id, received_date, expiry_date,
    received_weight_kg, remaining_weight_kg, cost_per_kg
  ) VALUES
    (beef_batch, beef, b, current_date, current_date + 4, 20, 20, 5),
    (lamb_batch, lamb, b, current_date, current_date + 4, 20, 20, 6);

  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (order_composed, b, 'B4-COMPOSED', 'incoming', current_date, 10, 'b4-composed-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (item_composed, b, order_composed, beef, 'B4 beef', 1, 'kg', 10, 10);
  PERFORM public.transition_order_status(order_composed, 'prepping', NULL);

  SELECT * INTO folded FROM public.get_effective_order_lines_v18(order_composed, NULL);
  PERFORM pg_temp.assert_v18(
    folded.product_id = beef AND folded.effective_quantity = 1
      AND folded.effective_unit_price_pence = 1000 AND folded.line_total_pence = 1000
      AND folded.fold_sequence = 0,
    'no-amendment fold must equal immutable snapshot'
  );

  failed := false;
  BEGIN
    PERFORM public.amend_order_item_v18(
      order_composed, item_composed, 'substitute', NULL, each_product, NULL,
      'b4000000-0000-4000-8000-000000000401', 0, true
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%unit type%'; END;
  PERFORM pg_temp.assert_v18(failed, 'kg-to-each substitution must fail');

  failed := false;
  BEGIN
    PERFORM public.amend_order_item_v18(
      order_composed, item_composed, 'substitute', NULL, inactive_lamb, NULL,
      'b4000000-0000-4000-8000-000000000402', 0, true
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%not currently sellable%'; END;
  PERFORM pg_temp.assert_v18(failed, 'inactive substitute must fail');

  failed := false;
  BEGIN
    PERFORM public.amend_order_item_v18(
      order_composed, item_composed, 'substitute', NULL, out_of_stock_lamb, NULL,
      'b4000000-0000-4000-8000-000000000410', 0, true
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%not currently sellable%'; END;
  PERFORM pg_temp.assert_v18(failed, 'out-of-stock substitute must fail even when is_available is true');

  failed := false;
  BEGIN
    PERFORM public.amend_order_item_v18(
      order_composed, item_composed, 'substitute', NULL, lamb, NULL,
      'b4000000-0000-4000-8000-000000000403', 0, false
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%customer confirmation%'; END;
  PERFORM pg_temp.assert_v18(failed, 'unconfirmed price increase must fail');

  r := public.amend_order_item_v18(
    order_composed, item_composed, 'substitute', NULL, lamb, 'customer agreed',
    'b4000000-0000-4000-8000-000000000404', 0, true
  );
  PERFORM pg_temp.assert_v18((r->>'sequence')::integer = 1 AND (r->>'price_increase')::boolean, 'substitution seq/price flag');

  failed := false;
  BEGIN
    PERFORM public.amend_order_item_v18(
      order_composed, item_composed, 'weight_adjust', 1.2, NULL, NULL,
      'b4000000-0000-4000-8000-000000000405', 0, true
    );
  EXCEPTION WHEN serialization_failure THEN failed := true; WHEN OTHERS THEN failed := SQLSTATE = '40001'; END;
  PERFORM pg_temp.assert_v18(failed, 'stale expected sequence must fail');

  r := public.amend_order_item_v18(
    order_composed, item_composed, 'weight_adjust', 1.245, NULL, NULL,
    'b4000000-0000-4000-8000-000000000406', 1, true
  );
  PERFORM pg_temp.assert_v18((r->>'sequence')::integer = 2, 'weight adjustment sequence');
  r := public.amend_order_item_v18(
    order_composed, item_composed, 'remove', 1.1, NULL, 'partial removal',
    'b4000000-0000-4000-8000-000000000407', 2, false
  );
  PERFORM pg_temp.assert_v18((r->>'sequence')::integer = 3, 'partial remove sequence');

  SELECT * INTO folded FROM public.get_effective_order_lines_v18(order_composed, NULL);
  PERFORM pg_temp.assert_v18(
    folded.product_id = lamb AND folded.product_name = 'B4 lamb'
      AND folded.effective_quantity = 1.1
      AND folded.effective_unit_price_pence = 1200
      AND folded.line_total_pence = 1320
      AND folded.order_subtotal_pence = 1320
      AND folded.applied_sequence = 3 AND folded.fold_sequence = 3,
    'authoritative fold must compose substitute -> adjust -> partial remove in sequence'
  );

  SELECT count(*) INTO amendment_count FROM public.order_amendments WHERE order_id = order_composed;
  r := public.amend_order_item_v18(
    order_composed, item_composed, 'remove', 1.1, NULL, 'partial removal',
    'b4000000-0000-4000-8000-000000000407', 2, false
  );
  PERFORM pg_temp.assert_v18((r->>'replayed')::boolean, 'amendment idempotency replay');
  PERFORM pg_temp.assert_v18(
    (SELECT count(*) FROM public.order_amendments WHERE order_id = order_composed) = amendment_count,
    'amendment replay writes nothing'
  );
  failed := false;
  BEGIN
    PERFORM public.amend_order_item_v18(
      order_composed, item_composed, 'remove', 1.1, NULL, 'changed replay reason',
      'b4000000-0000-4000-8000-000000000407', 2, false
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%different details%'; END;
  PERFORM pg_temp.assert_v18(
    failed
    AND (SELECT count(*) FROM public.order_amendments WHERE order_id = order_composed) = amendment_count,
    'same amendment key with changed payload must fail without a new fact'
  );

  failed := false;
  BEGIN
    PERFORM public.amend_order_item_v18(
      order_composed, item_composed, 'weight_adjust', 1.0, NULL, NULL,
      'b4000000-0000-4000-8000-000000000408', 3, false
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%removed line%'; END;
  PERFORM pg_temp.assert_v18(failed, 'remove-then-adjust must be terminal even for partial remove');

  -- Collection freezes the same seq for folded tender and folded depletion.
  PERFORM public.transition_order_status(order_composed, 'ready', NULL);
  r := public.collect_order_with_tender(order_composed, 'card', 'b4-composed-tender', NULL);
  PERFORM pg_temp.assert_v18(
    (r->>'amount_pence')::integer = 1320 AND (r->>'amendment_seq')::integer = 3,
    'tender must use folded subtotal/frozen seq'
  );
  PERFORM pg_temp.assert_v18(
    (SELECT amendment_seq = 3 AND total_required_kg = 1.1 AND total_depleted_kg = 1.1
     FROM public.order_inventory_depletions WHERE order_id = order_composed),
    'depletion summary must use the same frozen folded version'
  );
  PERFORM pg_temp.assert_v18(
    (SELECT coalesce(sum(abs(m.delta_kg)), 0) = 1.1
     FROM public.inventory_movements m JOIN public.inventory_batches ib ON ib.id = m.batch_id
     WHERE m.order_id = order_composed AND m.source_event = 'SALE_COLLECT' AND ib.product_id = lamb),
    'substitution must deplete folded substitute product/quantity'
  );
  PERFORM pg_temp.assert_v18(
    NOT EXISTS (
      SELECT 1 FROM public.inventory_movements m JOIN public.inventory_batches ib ON ib.id = m.batch_id
      WHERE m.order_id = order_composed AND m.source_event = 'SALE_COLLECT' AND ib.product_id = beef
    ),
    'substitution must not deplete original product'
  );
  r := public.collect_order_with_tender(order_composed, 'card', 'b4-composed-tender', NULL);
  PERFORM pg_temp.assert_v18(
    (r->>'replayed')::boolean
      AND (SELECT count(*) = 1 FROM public.payment_events WHERE order_id = order_composed),
    'exact tender replay must return the original money fact'
  );
  failed := false;
  BEGIN
    PERFORM public.collect_order_with_tender(order_composed, 'cash', 'b4-composed-tender', NULL);
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%different details%'; END;
  PERFORM pg_temp.assert_v18(
    failed
      AND (SELECT count(*) = 1 FROM public.payment_events WHERE order_id = order_composed)
      AND (SELECT method = 'card' FROM public.payment_events WHERE order_id = order_composed),
    'same tender key with a changed method must fail without changing money truth'
  );
  failed := false;
  BEGIN
    PERFORM public.amend_order_item_v18(
      order_composed, item_composed, 'weight_adjust', 1.2, NULL, NULL,
      'b4000000-0000-4000-8000-000000000409', 3, false
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%only be adjusted%'; END;
  PERFORM pg_temp.assert_v18(failed, 'amend-after-collected must fail');

  -- No-amendment identity: movement fields and key remain V14-exact, seq=0.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (order_identity, b, 'B4-IDENTITY', 'incoming', current_date, 7.5, 'b4-identity-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (item_identity, b, order_identity, beef, 'B4 beef', 0.75, 'kg', 10, 7.5);
  PERFORM public.transition_order_status(order_identity, 'prepping', NULL);
  PERFORM public.transition_order_status(order_identity, 'ready', NULL);
  PERFORM public.collect_order_with_tender(order_identity, 'cash', 'b4-identity-tender', NULL);
  SELECT * INTO movement FROM public.inventory_movements
  WHERE order_id = order_identity AND source_event = 'SALE_COLLECT';
  PERFORM pg_temp.assert_v18(
    movement.movement_type = 'SALE' AND movement.quantity_kg = 0.75
      AND movement.delta_kg = -0.75 AND movement.order_item_id = item_identity
      AND movement.reference_id = order_identity
      AND movement.idempotency_key = order_identity::text || ':' || item_identity::text || ':' || movement.batch_id::text || ':SALE_COLLECT',
    'no-amendment movement must retain exact V14 fields/key'
  );
  PERFORM pg_temp.assert_v18(
    (SELECT amendment_seq = 0 FROM public.order_inventory_depletions WHERE order_id = order_identity),
    'no-amendment collection freezes seq zero'
  );

  -- A2 each/box quantities stay integral through partial-removal amendments.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (order_each, b, 'B4-EACH', 'incoming', current_date, 12, 'b4-each-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (item_each, b, order_each, each_product, 'B4 each', 3, 'each', 4, 12);
  PERFORM set_config('request.jwt.claim.sub', manager_id::text, true);
  PERFORM public.transition_order_status(order_each, 'prepping', NULL);
  PERFORM public.transition_order_status(order_each, 'ready', NULL);
  SELECT count(*) INTO audit_count FROM public.audit_logs WHERE target_id = order_each;
  failed := false;
  BEGIN
    PERFORM public.amend_order_item_v18(
      order_each, item_each, 'remove', 1.5, NULL, 'fractional count probe',
      'b4000000-0000-4000-8000-000000000413', 0, false
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%whole item count%'; END;
  PERFORM pg_temp.assert_v18(
    failed
    AND NOT EXISTS (SELECT 1 FROM public.order_amendments WHERE order_id = order_each)
    AND (SELECT count(*) FROM public.audit_logs WHERE target_id = order_each) = audit_count,
    'fractional each amendment must fail without event or audit facts'
  );
  r := public.amend_order_item_v18(
    order_each, item_each, 'remove', 2, NULL, 'whole count probe',
    'b4000000-0000-4000-8000-000000000414', 0, false
  );
  PERFORM pg_temp.assert_v18(
    (r->'effective_line'->>'effective_quantity')::numeric = 2,
    'whole each partial removal must remain supported'
  );

  failed := false;
  BEGIN
    UPDATE public.order_amendments SET reason = 'tamper' WHERE order_id = order_composed;
  EXCEPTION WHEN read_only_sql_transaction THEN failed := true; WHEN OTHERS THEN failed := SQLSTATE = '25006'; END;
  PERFORM pg_temp.assert_v18(failed, 'amendment event log must be append-only');

  -- Same-branch staff may amend, while a staff member from another branch is
  -- denied without leaving an amendment, audit, tender, depletion or stock fact.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (order_access, b, 'B4-ACCESS', 'incoming', current_date, 10, 'b4-access-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (item_access, b, order_access, beef, 'B4 beef', 1, 'kg', 10, 10);
  PERFORM set_config('request.jwt.claim.sub', manager_id::text, true);
  PERFORM public.transition_order_status(order_access, 'prepping', NULL);
  PERFORM public.transition_order_status(order_access, 'ready', NULL);
  SELECT remaining_weight_kg INTO stock_before FROM public.inventory_batches WHERE id = beef_batch;

  PERFORM set_config('request.jwt.claim.sub', staff_id::text, true);
  r := public.amend_order_item_v18(
    order_access, item_access, 'weight_adjust', 0.9, NULL, 'same branch staff probe',
    'b4000000-0000-4000-8000-000000000411', 0, false
  );
  PERFORM pg_temp.assert_v18((r->>'sequence')::integer = 1, 'same-branch staff amendment must succeed');
  SELECT count(*) INTO audit_count FROM public.audit_logs WHERE target_id = order_access;

  PERFORM set_config('request.jwt.claim.sub', cross_branch_staff_id::text, true);
  failed := false;
  BEGIN
    PERFORM public.amend_order_item_v18(
      order_access, item_access, 'weight_adjust', 0.8, NULL, 'cross branch staff probe',
      'b4000000-0000-4000-8000-000000000412', 1, false
    );
  EXCEPTION WHEN insufficient_privilege THEN failed := true; WHEN OTHERS THEN failed := SQLSTATE = '42501'; END;
  PERFORM pg_temp.assert_v18(failed, 'cross-branch staff amendment must be denied');
  PERFORM pg_temp.assert_v18(
    (SELECT count(*) FROM public.order_amendments WHERE order_id = order_access) = 1
    AND NOT EXISTS (
      SELECT 1 FROM public.order_amendments
      WHERE idempotency_key = 'b4000000-0000-4000-8000-000000000412'
    )
    AND (SELECT count(*) FROM public.audit_logs WHERE target_id = order_access) = audit_count
    AND (SELECT remaining_weight_kg FROM public.inventory_batches WHERE id = beef_batch) = stock_before
    AND NOT EXISTS (SELECT 1 FROM public.payment_events WHERE order_id = order_access)
    AND NOT EXISTS (SELECT 1 FROM public.order_inventory_depletions WHERE order_id = order_access)
    AND (SELECT status FROM public.orders WHERE id = order_access) = 'ready',
    'denied cross-branch amendment must write no event, audit, money, depletion or stock fact'
  );
END;
$$;

-- Exercise the canonical fold as the authenticated database role so RLS is
-- part of the proof rather than being bypassed by the psql superuser.
SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT id::text FROM public.profiles
   WHERE branch_id <> '00000000-0000-4000-8000-000000000001'::uuid AND is_active LIMIT 1),
  true
);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.get_effective_order_lines_v18(
      'b4000000-0000-4000-8000-000000000203'::uuid, NULL
    )
  ) OR EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = 'b4000000-0000-4000-8000-000000000203'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.order_items
    WHERE order_id = 'b4000000-0000-4000-8000-000000000203'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.order_amendments
    WHERE order_id = 'b4000000-0000-4000-8000-000000000203'::uuid
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: cross-branch order detail/fold/amendment rows must be RLS-hidden';
  END IF;
END;
$$;
RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT id::text FROM public.profiles
   WHERE branch_id = '00000000-0000-4000-8000-000000000001'::uuid
     AND role = 'staff' AND is_active LIMIT 1),
  true
);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.get_effective_order_lines_v18(
        'b4000000-0000-4000-8000-000000000203'::uuid, NULL
      )) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.get_effective_order_lines_v18(
         'b4000000-0000-4000-8000-000000000203'::uuid, NULL
       ) WHERE effective_quantity = 0.9 AND fold_sequence = 1
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.orders
       WHERE id = 'b4000000-0000-4000-8000-000000000203'::uuid
     ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: same-branch staff must read the order detail and folded amendment';
  END IF;
END;
$$;
RESET ROLE;

ROLLBACK;
\echo 'V18 amendment/depletion DB battery passed'

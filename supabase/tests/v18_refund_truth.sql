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
  p uuid := 'b3000000-0000-4000-8000-000000000001';
  p_round uuid := 'b3000000-0000-4000-8000-000000000002';
  p_short uuid := 'b3000000-0000-4000-8000-000000000003';
  p_each uuid := 'b3000000-0000-4000-8000-000000000004';
  p_expired uuid := 'b3000000-0000-4000-8000-000000000005';
  p_manual uuid := 'b3000000-0000-4000-8000-000000000006';
  p_zero uuid := 'b3000000-0000-4000-8000-000000000007';
  p_large uuid := 'b3000000-0000-4000-8000-000000000008';
  batch_a uuid := 'b3000000-0000-4000-8000-000000000101';
  batch_b uuid := 'b3000000-0000-4000-8000-000000000102';
  batch_round uuid := 'b3000000-0000-4000-8000-000000000103';
  batch_short uuid := 'b3000000-0000-4000-8000-000000000104';
  batch_expired uuid := 'b3000000-0000-4000-8000-000000000105';
  batch_large uuid := 'b3000000-0000-4000-8000-000000000106';
  o_restock uuid := 'b3000000-0000-4000-8000-000000000201';
  o_discard uuid := 'b3000000-0000-4000-8000-000000000202';
  o_round uuid := 'b3000000-0000-4000-8000-000000000203';
  o_no_tender uuid := 'b3000000-0000-4000-8000-000000000204';
  o_fault uuid := 'b3000000-0000-4000-8000-000000000205';
  o_short uuid := 'b3000000-0000-4000-8000-000000000206';
  o_alert uuid := 'b3000000-0000-4000-8000-000000000207';
  o_each uuid := 'b3000000-0000-4000-8000-000000000208';
  o_expired uuid := 'b3000000-0000-4000-8000-000000000209';
  o_manual uuid := 'b3000000-0000-4000-8000-000000000210';
  o_zero uuid := 'b3000000-0000-4000-8000-000000000211';
  o_large uuid := 'b3000000-0000-4000-8000-000000000212';
  i_restock uuid := 'b3000000-0000-4000-8000-000000000301';
  i_discard uuid := 'b3000000-0000-4000-8000-000000000302';
  i_round uuid := 'b3000000-0000-4000-8000-000000000303';
  i_no_tender uuid := 'b3000000-0000-4000-8000-000000000304';
  i_fault uuid := 'b3000000-0000-4000-8000-000000000305';
  i_short uuid := 'b3000000-0000-4000-8000-000000000306';
  i_alert uuid := 'b3000000-0000-4000-8000-000000000307';
  i_each uuid := 'b3000000-0000-4000-8000-000000000308';
  i_expired uuid := 'b3000000-0000-4000-8000-000000000309';
  i_manual uuid := 'b3000000-0000-4000-8000-000000000310';
  i_zero uuid := 'b3000000-0000-4000-8000-000000000311';
  op uuid;
  r jsonb;
  before_kg numeric;
  refund_count integer;
  failed boolean;
  large_lines jsonb;
  large_dispositions jsonb;
BEGIN
  SELECT id INTO manager_id FROM public.profiles WHERE branch_id = b AND role = 'manager' AND is_active LIMIT 1;
  SELECT id INTO staff_id FROM public.profiles WHERE branch_id = b AND role = 'staff' AND is_active LIMIT 1;
  SELECT id INTO cross_branch_staff_id FROM public.profiles WHERE branch_id <> b AND is_active LIMIT 1;
  PERFORM pg_temp.assert_v18(
    manager_id IS NOT NULL AND staff_id IS NOT NULL AND cross_branch_staff_id IS NOT NULL,
    'seeded manager, staff and cross-branch staff required'
  );
  PERFORM set_config('request.jwt.claim.sub', manager_id::text, true);

  PERFORM pg_temp.assert_v18(
    NOT EXISTS (
      SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
      WHERE n.nspname = 'public' AND pr.proname = 'refund_order_v18'
        AND pg_get_function_identity_arguments(pr.oid) ILIKE '%method%'
    ),
    'refund RPC must expose no method parameter'
  );

  INSERT INTO public.products(id, branch_id, name, slug, unit_type, inventory_policy, price_per_unit, is_available, stock_status)
  VALUES
    (p, b, 'B3 refund product', 'b3-refund-product', 'kg', 'kg_batch', 10, true, 'in_stock'),
    (p_round, b, 'B3 rounding product', 'b3-rounding-product', 'kg', 'kg_batch', 10.01, true, 'in_stock'),
    (p_short, b, 'B3 shortfall product', 'b3-shortfall-product', 'kg', 'kg_batch', 10, true, 'in_stock'),
    (p_each, b, 'B3 each product', 'b3-each-product', 'each', 'untracked_manual', 4, true, 'in_stock'),
    (p_expired, b, 'B3 expired return product', 'b3-expired-return-product', 'kg', 'kg_batch', 10, true, 'in_stock'),
    (p_manual, b, 'B3 policy-history product', 'b3-policy-history-product', 'kg', 'untracked_manual', 10, true, 'in_stock'),
    (p_zero, b, 'B3 zero-stock tracked product', 'b3-zero-stock-tracked-product', 'kg', 'kg_batch', 10, true, 'in_stock'),
    (p_large, b, 'B3 capacity product with deliberately long repeated receipt text', 'b3-capacity-product', 'kg', 'kg_batch', 10, true, 'in_stock');
  INSERT INTO public.inventory_batches(
    id, product_id, branch_id, received_date, expiry_date,
    received_weight_kg, remaining_weight_kg, cost_per_kg
  ) VALUES
    (batch_a, p, b, current_date - 2, current_date + 2, 1, 1, 4),
    (batch_b, p, b, current_date - 1, current_date + 3, 10, 10, 5),
    (batch_round, p_round, b, current_date, current_date + 4, 10, 10, 6),
    (batch_short, p_short, b, current_date, current_date + 4, 1, 1, 5),
    (batch_expired, p_expired, b, current_date, current_date + 1, 0.5, 0.5, 5),
    (batch_large, p_large, b, current_date, current_date + 5, 0.030, 0.030, 5);

  -- Exact multi-batch FEFO restock and operation replay.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_restock, b, 'B3-RESTOCK', 'incoming', current_date, 15, 'b3-restock-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (i_restock, b, o_restock, p, 'B3 refund product', 1.5, 'kg', 10, 15);
  PERFORM public.transition_order_status(o_restock, 'prepping', NULL);
  PERFORM public.transition_order_status(o_restock, 'ready', NULL);
  PERFORM public.collect_order_with_tender(o_restock, 'cash', 'b3-restock-tender', NULL);
  PERFORM pg_temp.assert_v18(
    (SELECT count(*) = 2 FROM public.inventory_movements WHERE order_id = o_restock AND source_event = 'SALE_COLLECT'),
    'collection must span both FEFO batches'
  );

  op := 'b3000000-0000-4000-8000-000000000401';
  r := public.refund_order_v18(
    op, o_restock,
    jsonb_build_array(jsonb_build_object('order_item_id', i_restock, 'quantity', 1.5)),
    jsonb_build_array(jsonb_build_object('order_item_id', i_restock, 'disposition', 'returned_restockable')),
    'same reason'
  );
  PERFORM pg_temp.assert_v18(r->'money'->0->>'method' = 'cash', 'cash sale must refund only to cash');
  PERFORM pg_temp.assert_v18((r->>'total_amount_pence')::integer = 1500, 'full refund amount');
  PERFORM pg_temp.assert_v18(
    (SELECT remaining_weight_kg = 1 FROM public.inventory_batches WHERE id = batch_a)
    AND (SELECT remaining_weight_kg = 10 FROM public.inventory_batches WHERE id = batch_b),
    'restock must restore exact original batches'
  );
  PERFORM pg_temp.assert_v18(
    NOT EXISTS (
      SELECT 1 FROM public.inventory_movements original
      WHERE original.order_id = o_restock AND original.source_event = 'SALE_COLLECT'
        AND (SELECT coalesce(sum(reversal.quantity_kg), 0) FROM public.inventory_movements reversal
             WHERE reversal.reversal_of_movement_id = original.id) <> abs(original.delta_kg)
    ),
    'every FEFO allocation must be reversed exactly'
  );
  SELECT count(*) INTO refund_count FROM public.payment_events WHERE order_id = o_restock AND direction = 'refund';
  r := public.refund_order_v18(
    op, o_restock,
    jsonb_build_array(jsonb_build_object('order_item_id', i_restock, 'quantity', 1.5)),
    jsonb_build_array(jsonb_build_object('order_item_id', i_restock, 'disposition', 'returned_restockable')),
    'same reason'
  );
  PERFORM pg_temp.assert_v18((r->>'replayed')::boolean, 'operation replay must return original receipt');
  PERFORM pg_temp.assert_v18(
    (SELECT count(*) FROM public.payment_events WHERE order_id = o_restock AND direction = 'refund') = refund_count,
    'operation replay must not write a second payment'
  );
  failed := false;
  BEGIN
    PERFORM public.refund_order_v18(
      op, o_restock,
      jsonb_build_array(jsonb_build_object('order_item_id', i_restock, 'quantity', 1.4)),
      jsonb_build_array(jsonb_build_object('order_item_id', i_restock, 'disposition', 'returned_restockable')),
      'same reason'
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%different details%'; END;
  PERFORM pg_temp.assert_v18(
    failed
    AND (SELECT count(*) FROM public.payment_events WHERE order_id = o_restock AND direction = 'refund') = refund_count,
    'same refund operation id with changed payload must fail without new facts'
  );
  failed := false;
  BEGIN
    PERFORM public.refund_order_v18(
      'b3000000-0000-4000-8000-000000000402', o_restock,
      jsonb_build_array(jsonb_build_object('order_item_id', i_restock, 'quantity', 0.001)),
      jsonb_build_array(jsonb_build_object('order_item_id', i_restock, 'disposition', 'customer_kept')),
      'same reason'
    );
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  PERFORM pg_temp.assert_v18(failed, 'cumulative line over-refund must fail');

  -- Discarded return is reversal + waste: net stock zero, cost-bearing waste row.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_discard, b, 'B3-DISCARD', 'incoming', current_date, 5, 'b3-discard-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (i_discard, b, o_discard, p, 'B3 refund product', 0.5, 'kg', 10, 5);
  PERFORM public.transition_order_status(o_discard, 'prepping', NULL);
  PERFORM public.transition_order_status(o_discard, 'ready', NULL);
  PERFORM public.collect_order_with_tender(o_discard, 'cash', 'b3-discard-tender', NULL);
  SELECT sum(remaining_weight_kg) INTO before_kg FROM public.inventory_batches WHERE product_id = p;
  op := 'b3000000-0000-4000-8000-000000000403';
  r := public.refund_order_v18(
    op, o_discard,
    jsonb_build_array(jsonb_build_object('order_item_id', i_discard, 'quantity', 0.5)),
    jsonb_build_array(jsonb_build_object('order_item_id', i_discard, 'disposition', 'returned_discarded')),
    'returned quality issue'
  );
  PERFORM pg_temp.assert_v18(
    (SELECT sum(remaining_weight_kg) FROM public.inventory_batches WHERE product_id = p) = before_kg,
    'discarded return must have net-zero stock effect'
  );
  PERFORM pg_temp.assert_v18(
    (SELECT coalesce(sum(waste_kg), 0) = 0.5 FROM public.inventory_waste_events WHERE refund_operation_id = op),
    'discarded return must preserve a waste-cost row'
  );
  PERFORM pg_temp.assert_v18(
    (SELECT count(*) = 1 FROM public.inventory_movements WHERE order_id = o_discard AND source_event = 'REFUND_LINE_REVERSAL')
    AND (SELECT count(*) = 1 FROM public.inventory_movements WHERE order_id = o_discard AND source_event = 'REFUND_RETURN_WASTE'),
    'discard path must be reversal then waste, never lone second depletion'
  );

  -- Three fractional, same-reason refunds: final slice absorbs rounding penny.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_round, b, 'B3-ROUND', 'incoming', current_date, 10.01, 'b3-round-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (i_round, b, o_round, p_round, 'B3 rounding product', 1, 'kg', 10.01, 10.01);
  PERFORM public.transition_order_status(o_round, 'prepping', NULL);
  PERFORM public.transition_order_status(o_round, 'ready', NULL);
  PERFORM public.collect_order_with_tender(o_round, 'card', 'b3-round-tender', NULL);
  FOREACH op IN ARRAY ARRAY[
    'b3000000-0000-4000-8000-000000000404'::uuid,
    'b3000000-0000-4000-8000-000000000405'::uuid,
    'b3000000-0000-4000-8000-000000000406'::uuid
  ] LOOP
    r := public.refund_order_v18(
      op, o_round,
      jsonb_build_array(jsonb_build_object(
        'order_item_id', i_round,
        'quantity', CASE op
          WHEN 'b3000000-0000-4000-8000-000000000406'::uuid THEN 0.334 ELSE 0.333 END
      )),
      jsonb_build_array(jsonb_build_object('order_item_id', i_round, 'disposition', 'customer_kept')),
      'same reason'
    );
    PERFORM pg_temp.assert_v18(r->'money'->0->>'method' = 'card', 'card sale must refund only to card');
  END LOOP;
  PERFORM pg_temp.assert_v18(
    (SELECT sum(amount_pence) = 1001 FROM public.refund_line_outcomes WHERE order_item_id = i_round),
    'split rounding may never exceed/undershoot folded line pence'
  );
  PERFORM pg_temp.assert_v18(
    (SELECT count(*) = 3 FROM public.refund_operations WHERE order_id = o_round AND reason = 'same reason'),
    'distinct operation ids with the same reason must all succeed within cap'
  );
  PERFORM pg_temp.assert_v18(
    (SELECT count(*) = 1 FROM public.inventory_movements WHERE order_id = o_round),
    'customer-kept refunds must write no inventory movement'
  );

  -- Physical depletion cap also caps money: 1kg depleted of a 2kg/£20 line = £10.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_short, b, 'B3-SHORT', 'incoming', current_date, 20, 'b3-short-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (i_short, b, o_short, p_short, 'B3 shortfall product', 2, 'kg', 10, 20);
  PERFORM public.transition_order_status(o_short, 'prepping', NULL);
  PERFORM public.transition_order_status(o_short, 'ready', NULL);
  PERFORM public.collect_order_with_tender(o_short, 'cash', 'b3-short-tender', NULL);
  PERFORM pg_temp.assert_v18(
    (SELECT total_depleted_kg = 1 AND shortfall_kg = 1 FROM public.order_inventory_depletions WHERE order_id = o_short),
    'shortfall fixture must deplete only 1kg'
  );
  -- Mutable catalogue policy must not rewrite the allocation history below.
  UPDATE public.products SET inventory_policy = 'untracked_manual' WHERE id = p_short;
  r := public.refund_order_v18(
    'b3000000-0000-4000-8000-000000000409', o_short,
    jsonb_build_array(jsonb_build_object('order_item_id', i_short, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('order_item_id', i_short, 'disposition', 'customer_kept')),
    'shortfall cap probe'
  );
  PERFORM pg_temp.assert_v18(
    (r->>'total_amount_pence')::integer = 1000,
    '1kg depleted from 2kg £20 line must refund £10, not £20'
  );

  failed := false;
  BEGIN
    PERFORM public.refund_order_v18(
      'b3000000-0000-4000-8000-000000000418', o_short,
      jsonb_build_array(jsonb_build_object('order_item_id', i_short, 'quantity', 0.001)),
      jsonb_build_array(jsonb_build_object('order_item_id', i_short, 'disposition', 'customer_kept')),
      'tracked policy transition cap probe'
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%remaining refundable%'; END;
  PERFORM pg_temp.assert_v18(
    failed AND NOT EXISTS (
      SELECT 1 FROM public.refund_operations
      WHERE id = 'b3000000-0000-4000-8000-000000000418'
    ),
    'tracked allocation cap must survive a later count-off catalogue change'
  );

  -- A paid untracked line has no kg allocation. Turning count-on later must not
  -- rewrite its collection history or erase its full refundable quantity.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_manual, b, 'B3-MANUAL-HISTORY', 'incoming', current_date, 10, 'b3-manual-history-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (i_manual, b, o_manual, p_manual, 'B3 policy-history product', 1, 'kg', 10, 10);
  PERFORM public.transition_order_status(o_manual, 'prepping', NULL);
  PERFORM public.transition_order_status(o_manual, 'ready', NULL);
  PERFORM public.collect_order_with_tender(o_manual, 'cash', 'b3-manual-history-tender', NULL);
  PERFORM pg_temp.assert_v18(
    NOT EXISTS (
      SELECT 1 FROM public.inventory_movements
      WHERE order_id = o_manual AND source_event = 'SALE_COLLECT'
    ),
    'untracked history fixture must have no tracked allocation'
  );
  UPDATE public.products SET inventory_policy = 'kg_batch' WHERE id = p_manual;
  r := public.refund_order_v18(
    'b3000000-0000-4000-8000-000000000417', o_manual,
    jsonb_build_array(jsonb_build_object('order_item_id', i_manual, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('order_item_id', i_manual, 'disposition', 'customer_kept')),
    'untracked policy transition probe'
  );
  PERFORM pg_temp.assert_v18(
    (r->>'total_amount_pence')::integer = 1000,
    'untracked paid quantity must remain fully refundable after count-on'
  );

  -- A tracked line with no available batch writes no movement, but its durable
  -- line outcome still caps refundable physical quantity at zero. A later
  -- count-off catalogue edit must not turn that shortfall into refundable qty.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_zero, b, 'B3-ZERO-TRACKED', 'incoming', current_date, 10, 'b3-zero-tracked-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (i_zero, b, o_zero, p_zero, 'B3 zero-stock tracked product', 1, 'kg', 10, 10);
  PERFORM public.transition_order_status(o_zero, 'prepping', NULL);
  PERFORM public.transition_order_status(o_zero, 'ready', NULL);
  PERFORM public.collect_order_with_tender(o_zero, 'cash', 'b3-zero-tracked-tender', NULL);
  PERFORM pg_temp.assert_v18(
    NOT EXISTS (
      SELECT 1 FROM public.inventory_movements
      WHERE order_id = o_zero AND source_event = 'SALE_COLLECT'
    )
    AND EXISTS (
      SELECT 1 FROM public.order_inventory_line_depletions
      WHERE order_id = o_zero AND order_item_id = i_zero
        AND is_weight_tracked AND effective_quantity = 1
        AND depleted_quantity = 0 AND shortfall_quantity = 1
    ),
    '100% tracked shortfall must persist an explicit zero-depletion line outcome'
  );
  UPDATE public.products SET inventory_policy = 'untracked_manual' WHERE id = p_zero;
  failed := false;
  BEGIN
    PERFORM public.refund_order_v18(
      'b3000000-0000-4000-8000-000000000419', o_zero,
      jsonb_build_array(jsonb_build_object('order_item_id', i_zero, 'quantity', 1)),
      jsonb_build_array(jsonb_build_object('order_item_id', i_zero, 'disposition', 'customer_kept')),
      'zero tracked allocation probe'
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%remaining refundable%'; END;
  PERFORM pg_temp.assert_v18(
    failed AND NOT EXISTS (
      SELECT 1 FROM public.refund_operations
      WHERE id = 'b3000000-0000-4000-8000-000000000419'
    ),
    'tracked zero-allocation line must remain capped at zero after count-off'
  );

  -- An expired original allocation may never be made sellable again. Discard
  -- remains valid as a net-zero reverse+waste and preserves the batch state.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_expired, b, 'B3-EXPIRED', 'incoming', current_date, 5, 'b3-expired-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (i_expired, b, o_expired, p_expired, 'B3 expired return product', 0.5, 'kg', 10, 5);
  PERFORM public.transition_order_status(o_expired, 'prepping', NULL);
  PERFORM public.transition_order_status(o_expired, 'ready', NULL);
  PERFORM public.collect_order_with_tender(o_expired, 'cash', 'b3-expired-tender', NULL);
  UPDATE public.inventory_batches SET expiry_date = current_date - 1 WHERE id = batch_expired;
  failed := false;
  BEGIN
    PERFORM public.refund_order_v18(
      'b3000000-0000-4000-8000-000000000415', o_expired,
      jsonb_build_array(jsonb_build_object('order_item_id', i_expired, 'quantity', 0.5)),
      jsonb_build_array(jsonb_build_object('order_item_id', i_expired, 'disposition', 'returned_restockable')),
      'expired restock probe'
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%expired%'; END;
  PERFORM pg_temp.assert_v18(
    failed
    AND NOT EXISTS (
      SELECT 1 FROM public.refund_operations
      WHERE id = 'b3000000-0000-4000-8000-000000000415'
    )
    AND (SELECT remaining_weight_kg = 0 AND status = 'depleted' FROM public.inventory_batches WHERE id = batch_expired),
    'expired restock must fail atomically without making the original batch sellable'
  );
  r := public.refund_order_v18(
    'b3000000-0000-4000-8000-000000000416', o_expired,
    jsonb_build_array(jsonb_build_object('order_item_id', i_expired, 'quantity', 0.5)),
    jsonb_build_array(jsonb_build_object('order_item_id', i_expired, 'disposition', 'returned_discarded')),
    'expired discard probe'
  );
  PERFORM pg_temp.assert_v18(
    (SELECT remaining_weight_kg = 0 AND status = 'depleted' FROM public.inventory_batches WHERE id = batch_expired)
    AND (SELECT count(*) = 1 FROM public.inventory_movements WHERE order_id = o_expired AND source_event = 'REFUND_LINE_REVERSAL')
    AND (SELECT count(*) = 1 FROM public.inventory_movements WHERE order_id = o_expired AND source_event = 'REFUND_RETURN_WASTE')
    AND (SELECT coalesce(sum(waste_kg), 0) = 0.5 FROM public.inventory_waste_events WHERE refund_operation_id = 'b3000000-0000-4000-8000-000000000416'),
    'expired discard must record reverse+waste with zero sellable stock and preserved state'
  );

  -- Collected legacy/no-tender order gets a clear refusal.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_no_tender, b, 'B3-NOTENDER', 'incoming', current_date, 1, 'b3-notender-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (i_no_tender, b, o_no_tender, p, 'B3 refund product', 0.1, 'kg', 10, 1);
  PERFORM public.transition_order_status(o_no_tender, 'prepping', NULL);
  PERFORM public.transition_order_status(o_no_tender, 'ready', NULL);
  PERFORM public.transition_order_status(o_no_tender, 'collected', NULL);
  failed := false;
  BEGIN
    PERFORM public.refund_order_v18(
      'b3000000-0000-4000-8000-000000000407', o_no_tender,
      jsonb_build_array(jsonb_build_object('order_item_id', i_no_tender, 'quantity', 0.1)),
      jsonb_build_array(jsonb_build_object('order_item_id', i_no_tender, 'disposition', 'customer_kept')),
      'no tender probe'
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%no recorded tender%'; END;
  PERFORM pg_temp.assert_v18(failed, 'zero-tender refund must fail clearly');

  -- Fault after stock reversal but before payment: whole operation rolls back.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_fault, b, 'B3-FAULT', 'incoming', current_date, 2, 'b3-fault-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (i_fault, b, o_fault, p, 'B3 refund product', 0.2, 'kg', 10, 2);
  PERFORM public.transition_order_status(o_fault, 'prepping', NULL);
  PERFORM public.transition_order_status(o_fault, 'ready', NULL);
  PERFORM public.collect_order_with_tender(o_fault, 'cash', 'b3-fault-tender', NULL);
  op := 'b3000000-0000-4000-8000-000000000408';
  CREATE OR REPLACE FUNCTION pg_temp.fail_refund_waste() RETURNS trigger LANGUAGE plpgsql AS
  'BEGIN RAISE EXCEPTION ''forced disposition failure''; END';
  CREATE TRIGGER b3_forced_disposition_failure
    BEFORE INSERT ON public.inventory_waste_events
    FOR EACH ROW WHEN (NEW.refund_operation_id IS NOT NULL)
    EXECUTE FUNCTION pg_temp.fail_refund_waste();
  failed := false;
  BEGIN
    PERFORM public.refund_order_v18(
      op, o_fault,
      jsonb_build_array(jsonb_build_object('order_item_id', i_fault, 'quantity', 0.2)),
      jsonb_build_array(jsonb_build_object('order_item_id', i_fault, 'disposition', 'returned_discarded')),
      'fault probe'
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%forced disposition failure%'; END;
  DROP TRIGGER b3_forced_disposition_failure ON public.inventory_waste_events;
  PERFORM pg_temp.assert_v18(failed, 'forced disposition fault must reach caller');
  PERFORM pg_temp.assert_v18(
    NOT EXISTS (SELECT 1 FROM public.refund_operations WHERE id = op)
    AND NOT EXISTS (SELECT 1 FROM public.payment_events WHERE refund_operation_id = op)
    AND NOT EXISTS (SELECT 1 FROM public.inventory_movements WHERE idempotency_key LIKE 'refund:' || op || ':%'),
    'fault must roll back money, stock and operation receipt together'
  );

  -- The default GBP 20 owner-job threshold is transactional. Force its insert
  -- to fail after stock reversal: the whole refund must roll back. Retrying the
  -- same operation then creates exactly one job, and replay never duplicates it.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_alert, b, 'B3-ALERT', 'incoming', current_date, 25, 'b3-alert-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (i_alert, b, o_alert, p, 'B3 refund product', 2.5, 'kg', 10, 25);
  PERFORM set_config('request.jwt.claim.sub', manager_id::text, true);
  PERFORM public.transition_order_status(o_alert, 'prepping', NULL);
  PERFORM public.transition_order_status(o_alert, 'ready', NULL);
  PERFORM public.collect_order_with_tender(o_alert, 'cash', 'b3-alert-tender', NULL);
  PERFORM pg_temp.assert_v18(
    (SELECT refund_alert_threshold_pence = 2000 FROM public.branch_settings WHERE branch_id = b),
    'refund owner-job threshold must default to GBP 20'
  );
  SELECT sum(remaining_weight_kg) INTO before_kg FROM public.inventory_batches WHERE product_id = p;
  SELECT count(*) INTO refund_count FROM public.audit_logs WHERE target_id = o_alert;
  op := 'b3000000-0000-4000-8000-000000000412';
  CREATE OR REPLACE FUNCTION pg_temp.fail_refund_alert() RETURNS trigger LANGUAGE plpgsql AS
  'BEGIN RAISE EXCEPTION ''forced refund alert failure''; END';
  CREATE TRIGGER b3_forced_alert_failure
    BEFORE INSERT ON public.owner_alerts
    FOR EACH ROW WHEN (NEW.kind = 'refund_above_threshold')
    EXECUTE FUNCTION pg_temp.fail_refund_alert();
  failed := false;
  BEGIN
    PERFORM public.refund_order_v18(
      op, o_alert,
      jsonb_build_array(jsonb_build_object('order_item_id', i_alert, 'quantity', 2.5)),
      jsonb_build_array(jsonb_build_object('order_item_id', i_alert, 'disposition', 'returned_restockable')),
      'large refund alert fault probe'
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%forced refund alert failure%'; END;
  DROP TRIGGER b3_forced_alert_failure ON public.owner_alerts;
  PERFORM pg_temp.assert_v18(failed, 'owner-job insert failure must fail the refund transaction');
  PERFORM pg_temp.assert_v18(
    NOT EXISTS (SELECT 1 FROM public.refund_operations WHERE id = op)
    AND NOT EXISTS (SELECT 1 FROM public.refund_line_outcomes WHERE refund_operation_id = op)
    AND NOT EXISTS (SELECT 1 FROM public.payment_events WHERE refund_operation_id = op)
    AND NOT EXISTS (SELECT 1 FROM public.owner_alerts WHERE entity_ref = 'refund:' || op::text)
    AND NOT EXISTS (SELECT 1 FROM public.inventory_movements WHERE idempotency_key LIKE 'refund:' || op || ':%')
    AND (SELECT sum(remaining_weight_kg) FROM public.inventory_batches WHERE product_id = p) = before_kg
    AND (SELECT count(*) FROM public.audit_logs WHERE target_id = o_alert) = refund_count,
    'owner-job failure must roll back refund rows, money, stock and audit'
  );

  r := public.refund_order_v18(
    op, o_alert,
    jsonb_build_array(jsonb_build_object('order_item_id', i_alert, 'quantity', 2.5)),
    jsonb_build_array(jsonb_build_object('order_item_id', i_alert, 'disposition', 'returned_restockable')),
    'large refund alert fault probe'
  );
  PERFORM pg_temp.assert_v18(
    (r->>'total_amount_pence')::integer = 2500
    AND (r->>'owner_alert_id')::uuid IS NOT NULL
    AND (SELECT count(*) = 1 FROM public.owner_alerts
         WHERE branch_id = b AND kind = 'refund_above_threshold'
           AND entity_ref = 'refund:' || op::text AND severity = 'warning'),
    'successful threshold refund must atomically create one operation-scoped owner job'
  );
  r := public.refund_order_v18(
    op, o_alert,
    jsonb_build_array(jsonb_build_object('order_item_id', i_alert, 'quantity', 2.5)),
    jsonb_build_array(jsonb_build_object('order_item_id', i_alert, 'disposition', 'returned_restockable')),
    'large refund alert fault probe'
  );
  PERFORM pg_temp.assert_v18(
    (r->>'replayed')::boolean
    AND (SELECT count(*) = 1 FROM public.owner_alerts
         WHERE branch_id = b AND kind = 'refund_above_threshold' AND entity_ref = 'refund:' || op::text),
    'refund replay must retain, not duplicate, its transactional owner job'
  );

  -- A2 count lines remain whole throughout refund selection and mutation.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_each, b, 'B3-EACH', 'incoming', current_date, 12, 'b3-each-order', true);
  INSERT INTO public.order_items(id, branch_id, order_id, product_id, product_name_snapshot, quantity, unit_type, unit_price_snapshot, line_total)
  VALUES (i_each, b, o_each, p_each, 'B3 each product', 3, 'each', 4, 12);
  PERFORM public.transition_order_status(o_each, 'prepping', NULL);
  PERFORM public.transition_order_status(o_each, 'ready', NULL);
  PERFORM public.collect_order_with_tender(o_each, 'card', 'b3-each-tender', NULL);
  failed := false;
  BEGIN
    PERFORM public.refund_order_v18(
      'b3000000-0000-4000-8000-000000000413', o_each,
      jsonb_build_array(jsonb_build_object('order_item_id', i_each, 'quantity', 0.5)),
      jsonb_build_array(jsonb_build_object('order_item_id', i_each, 'disposition', 'customer_kept')),
      'fractional count probe'
    );
  EXCEPTION WHEN OTHERS THEN failed := SQLERRM ILIKE '%whole counts%'; END;
  PERFORM pg_temp.assert_v18(
    failed
    AND NOT EXISTS (SELECT 1 FROM public.refund_operations WHERE id = 'b3000000-0000-4000-8000-000000000413')
    AND NOT EXISTS (SELECT 1 FROM public.payment_events WHERE refund_operation_id = 'b3000000-0000-4000-8000-000000000413'),
    'fractional each refund must fail without refund facts'
  );
  r := public.refund_order_v18(
    'b3000000-0000-4000-8000-000000000414', o_each,
    jsonb_build_array(jsonb_build_object('order_item_id', i_each, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('order_item_id', i_each, 'disposition', 'customer_kept')),
    'whole count probe'
  );
  PERFORM pg_temp.assert_v18(
    (r->>'total_amount_pence')::integer = 400
    AND NOT EXISTS (SELECT 1 FROM public.inventory_movements WHERE order_id = o_each),
    'whole each refund must succeed without inventing kg movement'
  );
  PERFORM pg_temp.assert_v18(
    EXISTS (
      SELECT 1
      FROM public.get_branch_effective_order_lines_v18(b, now() - interval '1 day') e
      WHERE e.order_id = o_each
        AND e.source_order_item_id = i_each
        AND e.effective_quantity = 3
        AND e.line_total_pence = 1200
        AND e.refunded_quantity = 1
        AND e.refunded_amount_pence = 400
        AND e.returned_quantity = 0
        AND e.stock_returned_kg = 0
    )
    AND EXISTS (
      SELECT 1
      FROM public.get_branch_effective_order_lines_v18(b, now() - interval '1 day') e
      WHERE e.order_id = o_alert
        AND e.source_order_item_id = i_alert
        AND e.refunded_quantity = 2.5
        AND e.refunded_amount_pence = 2500
        AND e.returned_quantity = 2.5
        AND e.stock_returned_kg = 2.5
    ),
    'canonical branch projection must join folded lines to refund money and stock outcomes'
  );

  -- The immutable receipt may legitimately exceed the audit metadata cap. A
  -- 30-line discarded return keeps the full receipt in refund tables while the
  -- audit stores only a bounded summary/counts.
  INSERT INTO public.orders(id, branch_id, order_ref, status, pickup_date, subtotal, idempotency_key, is_test)
  VALUES (o_large, b, 'B3-CAPACITY', 'incoming', current_date, 0.30, 'b3-capacity-order', true);
  INSERT INTO public.order_items(
    id, branch_id, order_id, product_id, product_name_snapshot,
    quantity, unit_type, unit_price_snapshot, line_total
  )
  SELECT
    gen_random_uuid(), b, o_large, p_large,
    'B3 capacity product with deliberately long repeated receipt text ' || g::text,
    0.001, 'kg', 10, 0.01
  FROM generate_series(1, 30) g;
  PERFORM public.transition_order_status(o_large, 'prepping', NULL);
  PERFORM public.transition_order_status(o_large, 'ready', NULL);
  PERFORM public.collect_order_with_tender(o_large, 'card', 'b3-capacity-tender', NULL);
  SELECT
    jsonb_agg(jsonb_build_object('order_item_id', id, 'quantity', 0.001) ORDER BY id),
    jsonb_agg(jsonb_build_object('order_item_id', id, 'disposition', 'returned_discarded') ORDER BY id)
  INTO large_lines, large_dispositions
  FROM public.order_items WHERE order_id = o_large;
  r := public.refund_order_v18(
    'b3000000-0000-4000-8000-000000000420', o_large,
    large_lines, large_dispositions,
    repeat('capacity audit boundary ', 20)
  );
  PERFORM pg_temp.assert_v18(
    (SELECT count(*) = 30 FROM public.refund_line_outcomes WHERE order_id = o_large)
    AND (SELECT count(*) = 30 FROM public.inventory_waste_events
         WHERE refund_operation_id = 'b3000000-0000-4000-8000-000000000420')
    AND (SELECT length(receipt::text) > 8192 FROM public.refund_operations
         WHERE id = 'b3000000-0000-4000-8000-000000000420')
    AND (SELECT length(metadata::text) < 8192 FROM public.audit_logs
         WHERE event_type = 'order_refunded' AND target_id = o_large),
    'large valid refund must persist its full receipt with bounded audit metadata'
  );

  -- Staff cannot call either preview or mutation; a user from another branch
  -- is denied before any append-only, money, audit or stock fact is written.
  SELECT sum(remaining_weight_kg) INTO before_kg FROM public.inventory_batches WHERE product_id = p;
  SELECT count(*) INTO refund_count FROM public.audit_logs WHERE target_id = o_fault;
  PERFORM set_config('request.jwt.claim.sub', staff_id::text, true);
  failed := false;
  BEGIN
    PERFORM public.preview_refund_order_v18(
      o_round,
      jsonb_build_array(jsonb_build_object('order_item_id', i_round, 'quantity', 0.001))
    );
  EXCEPTION WHEN insufficient_privilege THEN failed := true; WHEN OTHERS THEN failed := SQLSTATE = '42501'; END;
  PERFORM pg_temp.assert_v18(failed, 'staff role must be blocked from refund preview');

  failed := false;
  BEGIN
    PERFORM public.refund_order_v18(
      'b3000000-0000-4000-8000-000000000410', o_fault,
      jsonb_build_array(jsonb_build_object('order_item_id', i_fault, 'quantity', 0.1)),
      jsonb_build_array(jsonb_build_object('order_item_id', i_fault, 'disposition', 'returned_restockable')),
      'staff authority probe'
    );
  EXCEPTION WHEN insufficient_privilege THEN failed := true; WHEN OTHERS THEN failed := SQLSTATE = '42501'; END;
  PERFORM pg_temp.assert_v18(failed, 'same-branch staff must be blocked from refund mutation');

  PERFORM set_config('request.jwt.claim.sub', cross_branch_staff_id::text, true);
  failed := false;
  BEGIN
    PERFORM public.refund_order_v18(
      'b3000000-0000-4000-8000-000000000411', o_fault,
      jsonb_build_array(jsonb_build_object('order_item_id', i_fault, 'quantity', 0.1)),
      jsonb_build_array(jsonb_build_object('order_item_id', i_fault, 'disposition', 'returned_restockable')),
      'cross branch authority probe'
    );
  EXCEPTION WHEN insufficient_privilege THEN failed := true; WHEN OTHERS THEN failed := SQLSTATE = '42501'; END;
  PERFORM pg_temp.assert_v18(failed, 'cross-branch user must be blocked from refund mutation');
  PERFORM pg_temp.assert_v18(
    NOT EXISTS (
      SELECT 1 FROM public.refund_operations
      WHERE id IN (
        'b3000000-0000-4000-8000-000000000410'::uuid,
        'b3000000-0000-4000-8000-000000000411'::uuid
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.refund_line_outcomes
      WHERE refund_operation_id IN (
        'b3000000-0000-4000-8000-000000000410'::uuid,
        'b3000000-0000-4000-8000-000000000411'::uuid
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_events
      WHERE refund_operation_id IN (
        'b3000000-0000-4000-8000-000000000410'::uuid,
        'b3000000-0000-4000-8000-000000000411'::uuid
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.inventory_reversal_groups
      WHERE refund_operation_id IN (
        'b3000000-0000-4000-8000-000000000410'::uuid,
        'b3000000-0000-4000-8000-000000000411'::uuid
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.inventory_waste_events
      WHERE refund_operation_id IN (
        'b3000000-0000-4000-8000-000000000410'::uuid,
        'b3000000-0000-4000-8000-000000000411'::uuid
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.inventory_movements
      WHERE idempotency_key LIKE 'refund:b3000000-0000-4000-8000-000000000410:%'
         OR idempotency_key LIKE 'refund:b3000000-0000-4000-8000-000000000411:%'
    )
    AND (SELECT sum(remaining_weight_kg) FROM public.inventory_batches WHERE product_id = p) = before_kg
    AND (SELECT count(*) FROM public.audit_logs WHERE target_id = o_fault) = refund_count,
    'denied refund calls must write no operation, line, money, stock, waste or audit facts'
  );
END;
$$;

ROLLBACK;
\echo 'V18 refund truth DB battery passed'

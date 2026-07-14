-- V18 prerequisite hardening: atomic Operator Serve creation and run fencing.
--
-- Header, server-priced items, status progression, tender, depletion, required
-- owner job/audit and the exact workflow-run completion are one transaction.
-- The existing collect_order_with_tender function remains the authoritative
-- final-hop implementation, but it is composed inside this transaction.

ALTER TABLE public.operator_workflow_runs
  ADD COLUMN IF NOT EXISTS completion_fingerprint text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_receipt jsonb;

ALTER TABLE public.operator_workflow_runs
  DROP CONSTRAINT IF EXISTS operator_workflow_runs_completion_receipt_object,
  ADD CONSTRAINT operator_workflow_runs_completion_receipt_object CHECK (
    completion_receipt IS NULL OR jsonb_typeof(completion_receipt) = 'object'
  );

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY branch_id, kind, entity_ref
           ORDER BY created_at, id
         ) AS ordinal
  FROM public.owner_alerts
  WHERE kind = 'operator_sale_check_needed' AND resolved_at IS NULL
)
UPDATE public.owner_alerts a
SET resolved_at = now(),
    resolution_note = coalesce(a.resolution_note, 'Duplicate sale-check job consolidated during V18 migration.')
FROM ranked r
WHERE a.id = r.id AND r.ordinal > 1;

CREATE UNIQUE INDEX IF NOT EXISTS owner_alerts_operator_sale_check_open_uniq
  ON public.owner_alerts(branch_id, kind, entity_ref)
  WHERE kind = 'operator_sale_check_needed' AND resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public.operator_serve_order_fingerprint_v18(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'operator-serve-v18:' || encode(extensions.digest(
    jsonb_build_object(
      'payment_method', o.payment_method,
      'lines', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'product_id', oi.product_id::text,
            'name', CASE WHEN oi.product_id IS NULL THEN oi.product_name_snapshot ELSE NULL END,
            'quantity_milli', round(oi.quantity * 1000)::bigint,
            'custom_total_pence', CASE
              WHEN oi.product_id IS NULL THEN round(oi.line_total * 100)::integer
              ELSE NULL
            END
          ) ORDER BY
            coalesce(oi.product_id::text, ''),
            CASE WHEN oi.product_id IS NULL THEN oi.product_name_snapshot ELSE '' END,
            round(oi.quantity * 1000)::bigint,
            CASE WHEN oi.product_id IS NULL THEN round(oi.line_total * 100)::integer ELSE -1 END
        )
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      ),
        '[]'::jsonb
      )
    )::text,
    'sha256'
  ), 'hex')
  FROM public.orders o
  WHERE o.id = p_order_id;
$$;

REVOKE ALL ON FUNCTION public.operator_serve_order_fingerprint_v18(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_operator_sale_check_alert_v18(
  p_branch_id uuid,
  p_actor uuid,
  p_order_id uuid,
  p_order_ref text,
  p_run_id uuid,
  p_entity_ref text,
  p_summary text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alert_id uuid;
BEGIN
  INSERT INTO public.owner_alerts(branch_id, severity, kind, summary, entity_ref, created_by)
  VALUES (
    p_branch_id, 'warning', 'operator_sale_check_needed', p_summary, p_entity_ref, p_actor
  )
  ON CONFLICT (branch_id, kind, entity_ref)
    WHERE kind = 'operator_sale_check_needed' AND resolved_at IS NULL
  DO NOTHING
  RETURNING id INTO v_alert_id;

  IF v_alert_id IS NOT NULL THEN
    PERFORM public.emit_audit_log(
      'inventory_reconciliation_issue', 'owner_alert', v_alert_id, p_branch_id,
      jsonb_build_object(
        'kind', 'operator_sale_check_needed',
        'summary', p_summary,
        'operator_id', p_actor,
        'order_id', p_order_id,
        'order_ref', p_order_ref,
        'run_id', p_run_id
      )
    );
    RETURN v_alert_id;
  END IF;

  SELECT id INTO v_alert_id
  FROM public.owner_alerts
  WHERE branch_id = p_branch_id
    AND kind = 'operator_sale_check_needed'
    AND entity_ref = p_entity_ref
    AND resolved_at IS NULL;
  IF v_alert_id IS NULL THEN
    RAISE EXCEPTION 'Required owner sale-check job could not be recorded.' USING ERRCODE = '23514';
  END IF;
  RETURN v_alert_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_operator_sale_check_alert_v18(uuid, uuid, uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_operator_serve_review_v18(
  p_run_id uuid,
  p_branch_id uuid,
  p_actor uuid,
  p_fingerprint text,
  p_order_id uuid,
  p_order_ref text,
  p_order_status text,
  p_subtotal numeric,
  p_alert_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt jsonb;
  v_rows integer;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_actor
     OR p_run_id IS NULL
     OR p_branch_id IS NULL
     OR p_order_id IS NULL
     OR p_alert_id IS NULL
     OR nullif(btrim(coalesce(p_fingerprint, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Owner-review completion identity is invalid.' USING ERRCODE = '42501';
  END IF;

  v_receipt := jsonb_build_object(
    'outcome', 'owner_review',
    'message', 'This sale needs owner review. Do not enter it again.',
    'order_id', p_order_id,
    'order_ref', p_order_ref,
    'status', p_order_status,
    'subtotal', p_subtotal,
    'needs_check', true,
    'owner_alert_id', p_alert_id,
    'request_fingerprint', p_fingerprint,
    'replayed', true
  );

  UPDATE public.operator_workflow_runs
  SET status = 'completed',
      steps = coalesce(steps, '{}'::jsonb) || jsonb_build_object(
        'orderId', p_order_id,
        'orderRef', p_order_ref,
        'ownerReview', true
      ),
      result_ref = 'order:' || p_order_id::text,
      completion_fingerprint = p_fingerprint,
      completed_at = now(),
      completion_receipt = v_receipt,
      updated_at = now()
  WHERE id = p_run_id
    AND branch_id = p_branch_id
    AND operator_id = p_actor
    AND workflow = 'serve'
    AND status = 'in_progress';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Serve run changed before owner-review completion.' USING ERRCODE = '40001';
  END IF;

  PERFORM public.emit_audit_log(
    'ops_session_completed', 'operator_workflow_run', p_run_id, p_branch_id,
    jsonb_build_object(
      'workflow', 'serve',
      'order_id', p_order_id,
      'order_ref', p_order_ref,
      'owner_review', true,
      'owner_alert_id', p_alert_id
    )
  );

  RETURN v_receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_operator_serve_review_v18(
  uuid, uuid, uuid, text, uuid, text, text, numeric, uuid
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_operator_serve_order_v18(
  p_run_id uuid,
  p_lines jsonb,
  p_payment_method text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_run public.operator_workflow_runs%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_branch_id uuid;
  v_business_date date;
  v_order_ref text;
  v_order_id uuid;
  v_key text;
  v_fingerprint text;
  v_fingerprint_lines jsonb;
  v_normalized_lines jsonb;
  v_resolved_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_product_id uuid;
  v_name text;
  v_unit_type text;
  v_quantity numeric;
  v_custom_total_pence integer;
  v_unit_price numeric(10,2);
  v_line_total numeric(10,2);
  v_subtotal numeric(10,2) := 0;
  v_needs_check boolean := false;
  v_replayed boolean := false;
  v_item_count integer;
  v_receipt jsonb;
  v_rows integer;
  v_alert_id uuid;
  v_order_request_fingerprint text;
  v_sale_count integer;
  v_sale_pence integer;
  v_matching_sale_count integer;
  v_depletion_count integer;
  v_initial_event_count integer;
  v_created_audit_count integer;
  v_legacy_order boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '28000';
  END IF;
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'Serve run id is required.' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'card') THEN
    RAISE EXCEPTION 'Choose cash or card.' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Choose between 1 and 12 sale lines.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x WHERE jsonb_typeof(x) <> 'object') THEN
    RAISE EXCEPTION 'Every sale line must be an object.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_actor FOR SHARE;
  IF v_profile.id IS NULL OR NOT coalesce(v_profile.is_active, false)
     OR v_profile.branch_id IS NULL
     OR v_profile.role NOT IN ('manager', 'owner') THEN
    RAISE EXCEPTION 'Not authorised to record a shop sale.' USING ERRCODE = '42501';
  END IF;
  v_branch_id := v_profile.branch_id;
  v_key := 'operator-serve:' || p_run_id::text;

  -- Normalize request intent before fingerprinting. Catalogue names/prices are
  -- deliberately excluded: product id + quantity is the request; live product
  -- rows are the pricing authority. Custom line name/total remain request data.
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id', product_id,
      'name', CASE WHEN product_id IS NULL THEN coalesce(name, 'Other') ELSE NULL END,
      'quantity', quantity,
      'custom_total_pence', CASE WHEN product_id IS NULL THEN custom_total_pence ELSE NULL END
    ) ORDER BY ordinal
  )
  INTO v_normalized_lines
  FROM (
    SELECT
      x.ordinality AS ordinal,
      CASE
        WHEN nullif(btrim(coalesce(x.value->>'product_id', '')), '') IS NULL THEN NULL
        ELSE (x.value->>'product_id')::uuid
      END AS product_id,
      nullif(btrim(coalesce(x.value->>'name', '')), '') AS name,
      (x.value->>'quantity')::numeric AS quantity,
      CASE
        WHEN nullif(btrim(coalesce(x.value->>'custom_total_pence', '')), '') IS NULL THEN NULL
        ELSE (x.value->>'custom_total_pence')::integer
      END AS custom_total_pence
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS x(value, ordinality)
  ) normalized;

  IF v_normalized_lines IS NULL THEN
    RAISE EXCEPTION 'Sale lines could not be read.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_normalized_lines) x
    WHERE (x->>'quantity')::numeric <= 0
       OR scale((x->>'quantity')::numeric) > 3
  ) THEN
    RAISE EXCEPTION 'Sale quantities must be positive with at most three decimals.'
      USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'product_id', x->>'product_id',
    'name', x->>'name',
    'quantity_milli', round((x->>'quantity')::numeric * 1000)::bigint,
    'custom_total_pence', nullif(x->>'custom_total_pence', '')::integer
  ) ORDER BY
    coalesce(x->>'product_id', ''),
    coalesce(x->>'name', ''),
    round((x->>'quantity')::numeric * 1000)::bigint,
    coalesce(nullif(x->>'custom_total_pence', '')::integer, -1),
    ordinality)
  INTO v_fingerprint_lines
  FROM jsonb_array_elements(v_normalized_lines) WITH ORDINALITY AS lines(x, ordinality);
  v_fingerprint := 'operator-serve-v18:' || encode(
    extensions.digest(
      jsonb_build_object('payment_method', p_payment_method, 'lines', v_fingerprint_lines)::text,
      'sha256'
    ),
    'hex'
  );

  -- One run identity is the serialization/fencing point, including when no
  -- draft row exists yet. A second connection waits, then receives replay.
  PERFORM pg_advisory_xact_lock(hashtextextended('operator-run:' || p_run_id::text, 0));
  SELECT * INTO v_run FROM public.operator_workflow_runs WHERE id = p_run_id FOR UPDATE;

  IF v_run.id IS NOT NULL THEN
    IF v_run.branch_id <> v_branch_id OR v_run.operator_id <> v_actor OR v_run.workflow <> 'serve' THEN
      RAISE EXCEPTION 'This serve run belongs to another operator or workflow.' USING ERRCODE = '42501';
    END IF;
    IF v_run.status = 'abandoned' THEN
      RAISE EXCEPTION 'This serve run was replaced by Start fresh. Use the current run.'
        USING ERRCODE = '55000';
    END IF;
    IF v_run.completion_fingerprint IS NOT NULL
       AND v_run.completion_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'This serve run was already saved with different details.'
        USING ERRCODE = '22023';
    END IF;
    IF v_run.status = 'completed' THEN
      IF v_run.result_ref IS NULL OR v_run.result_ref !~
         '^order:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Completed serve run has no valid order result.' USING ERRCODE = '23514';
      END IF;
      v_order_id := replace(v_run.result_ref, 'order:', '')::uuid;
      SELECT * INTO v_order
      FROM public.orders
      WHERE id = v_order_id AND branch_id = v_branch_id AND idempotency_key = v_key;
      IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'Completed serve run does not match its order.' USING ERRCODE = '23514';
      END IF;
      IF v_run.completion_receipt->>'outcome' = 'owner_review' THEN
        RETURN v_run.completion_receipt || jsonb_build_object('replayed', true);
      END IF;
      IF v_run.completion_fingerprint IS NULL THEN
        IF v_order.idempotency_fingerprint IS DISTINCT FROM v_key THEN
          RAISE EXCEPTION 'Completed legacy serve run does not match its order.' USING ERRCODE = '23514';
        END IF;
        v_order_request_fingerprint := public.operator_serve_order_fingerprint_v18(v_order_id);
        IF v_order_request_fingerprint IS DISTINCT FROM v_fingerprint THEN
          RAISE EXCEPTION 'This serve run was already saved with different details.' USING ERRCODE = '22023';
        END IF;
        SELECT count(*), coalesce(sum(pe.amount_pence), 0)::integer,
               count(*) FILTER (WHERE pe.method = v_order.payment_method)
        INTO v_sale_count, v_sale_pence, v_matching_sale_count
        FROM public.payment_events pe
        WHERE pe.order_id = v_order_id AND pe.direction = 'sale';
        SELECT count(*) INTO v_item_count FROM public.order_items WHERE order_id = v_order_id;
        SELECT count(*) INTO v_depletion_count
        FROM public.order_inventory_depletions d
        WHERE d.order_id = v_order_id AND d.source_event = 'SALE_COLLECT';
        SELECT count(*) INTO v_initial_event_count
        FROM public.order_status_events ose
        WHERE ose.order_id = v_order_id
          AND ose.branch_id = v_branch_id
          AND ose.status = 'incoming';
        SELECT count(*) INTO v_created_audit_count
        FROM public.audit_logs al
        WHERE al.branch_id = v_branch_id
          AND al.event_type = 'order_created'
          AND al.target_type = 'order'
          AND al.target_id = v_order_id;
        IF v_order.status <> 'collected'
           OR v_item_count = 0
           OR v_sale_count <> 1
           OR v_matching_sale_count <> 1
           OR v_sale_pence <> round(v_order.subtotal * 100)::integer
           OR v_depletion_count <> 1
           OR v_initial_event_count <> 1
           OR v_created_audit_count <> 1 THEN
          v_alert_id := public.ensure_operator_sale_check_alert_v18(
            v_branch_id, v_actor, v_order_id, v_order.order_ref, p_run_id,
            v_order_id::text || ':repair',
            'A shop sale saved before the upgrade needs owner review.'
          );
          RETURN jsonb_build_object(
            'outcome', 'owner_review',
            'message', 'This sale needs owner review. Do not enter it again.',
            'order_id', v_order_id,
            'order_ref', v_order.order_ref,
            'status', v_order.status,
            'subtotal', v_order.subtotal,
            'needs_check', true,
            'owner_alert_id', v_alert_id,
            'replayed', true
          );
        END IF;
      ELSIF v_order.idempotency_fingerprint IS DISTINCT FROM v_fingerprint THEN
        RAISE EXCEPTION 'Completed serve run does not match its order.' USING ERRCODE = '23514';
      END IF;
      v_replayed := true;
    END IF;
  ELSE
    INSERT INTO public.operator_workflow_runs(
      id, branch_id, operator_id, workflow, status, steps, completion_fingerprint
    ) VALUES (
      p_run_id, v_branch_id, v_actor, 'serve', 'in_progress',
      jsonb_build_object('lines', v_normalized_lines, 'payKind', p_payment_method),
      v_fingerprint
    )
    RETURNING * INTO v_run;
  END IF;

  IF NOT v_replayed THEN
    -- A row under this key can only be legacy/inconsistent because this RPC
    -- creates order + completed run atomically. Never append another item set.
    SELECT * INTO v_order FROM public.orders WHERE idempotency_key = v_key FOR UPDATE;
    IF v_order.id IS NOT NULL THEN
      IF v_order.branch_id <> v_branch_id THEN
        RAISE EXCEPTION 'This serve run was already saved with different details.'
          USING ERRCODE = '22023';
      END IF;
      SELECT count(*) INTO v_item_count FROM public.order_items WHERE order_id = v_order.id;
      IF v_item_count = 0 THEN
        v_alert_id := public.ensure_operator_sale_check_alert_v18(
          v_branch_id, v_actor, v_order.id, v_order.order_ref, p_run_id,
          v_order.id::text || ':repair',
          'A shop sale did not save cleanly and needs owner review.'
        );
        RETURN public.complete_operator_serve_review_v18(
          p_run_id, v_branch_id, v_actor, v_fingerprint,
          v_order.id, v_order.order_ref, v_order.status, v_order.subtotal, v_alert_id
        );
      END IF;
      IF v_order.idempotency_fingerprint = v_key THEN
        v_order_request_fingerprint := public.operator_serve_order_fingerprint_v18(v_order.id);
        IF v_order_request_fingerprint IS DISTINCT FROM v_fingerprint THEN
          RAISE EXCEPTION 'This serve run was already saved with different details.'
            USING ERRCODE = '22023';
        END IF;
        v_legacy_order := true;
      ELSIF v_order.idempotency_fingerprint IS DISTINCT FROM v_fingerprint THEN
        RAISE EXCEPTION 'This serve run was already saved with different details.'
          USING ERRCODE = '22023';
      END IF;

      SELECT count(*), coalesce(sum(pe.amount_pence), 0)::integer,
             count(*) FILTER (WHERE pe.method = v_order.payment_method)
      INTO v_sale_count, v_sale_pence, v_matching_sale_count
      FROM public.payment_events pe
      WHERE pe.order_id = v_order.id AND pe.direction = 'sale';
      SELECT count(*) INTO v_depletion_count
      FROM public.order_inventory_depletions d
      WHERE d.order_id = v_order.id AND d.source_event = 'SALE_COLLECT';
      SELECT count(*) INTO v_initial_event_count
      FROM public.order_status_events ose
      WHERE ose.order_id = v_order.id
        AND ose.branch_id = v_branch_id
        AND ose.status = 'incoming';
      SELECT count(*) INTO v_created_audit_count
      FROM public.audit_logs al
      WHERE al.branch_id = v_branch_id
        AND al.event_type = 'order_created'
        AND al.target_type = 'order'
        AND al.target_id = v_order.id;
      IF v_order.status NOT IN ('incoming', 'prepping', 'ready', 'collected') OR (
        v_order.status = 'collected'
        AND (
          v_sale_count <> 1
          OR v_matching_sale_count <> 1
          OR v_sale_pence <> round(v_order.subtotal * 100)::integer
          OR v_depletion_count <> 1
        )
      ) OR (
        v_order.status <> 'collected'
        AND (
          v_sale_count <> 0
          OR v_depletion_count <> 0
        )
      ) OR v_initial_event_count <> 1
        OR v_created_audit_count <> 1
      THEN
        v_alert_id := public.ensure_operator_sale_check_alert_v18(
          v_branch_id, v_actor, v_order.id, v_order.order_ref, p_run_id,
          v_order.id::text || ':repair',
          'A shop sale has inconsistent saved facts and needs owner review.'
        );
        RETURN public.complete_operator_serve_review_v18(
          p_run_id, v_branch_id, v_actor, v_fingerprint,
          v_order.id, v_order.order_ref, v_order.status, v_order.subtotal, v_alert_id
        );
      END IF;
      IF v_legacy_order THEN
        UPDATE public.orders
        SET idempotency_fingerprint = v_fingerprint,
            updated_at = now()
        WHERE id = v_order.id AND idempotency_fingerprint = v_key;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
          RAISE EXCEPTION 'Legacy shop sale changed during recovery.' USING ERRCODE = '40001';
        END IF;
        v_order.idempotency_fingerprint := v_fingerprint;
      END IF;
      v_order_id := v_order.id;
    ELSE
      -- Resolve every line against locked catalogue state. The caller never
      -- supplies a catalogue price or unit type.
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_normalized_lines)
      LOOP
        v_product_id := nullif(v_line->>'product_id', '')::uuid;
        v_quantity := (v_line->>'quantity')::numeric;
        v_custom_total_pence := nullif(v_line->>'custom_total_pence', '')::integer;

        IF v_quantity IS NULL OR v_quantity <= 0 THEN
          RAISE EXCEPTION 'Sale quantities must be positive.' USING ERRCODE = '22023';
        END IF;

        IF v_product_id IS NOT NULL THEN
          SELECT * INTO v_product
          FROM public.products
          WHERE id = v_product_id AND branch_id = v_branch_id
          FOR SHARE;
          IF v_product.id IS NULL OR NOT coalesce(v_product.is_available, false)
             OR coalesce(v_product.stock_status, 'out_of_stock') = 'out_of_stock' THEN
            RAISE EXCEPTION 'That item is no longer available.' USING ERRCODE = '22023';
          END IF;
          IF v_product.unit_type = 'kg' THEN
            IF v_quantity > 50 OR scale(v_quantity) > 3 THEN
              RAISE EXCEPTION 'Enter a valid weight up to 50kg with at most three decimals.'
                USING ERRCODE = '22023';
            END IF;
          ELSIF v_product.unit_type IN ('each', 'box') THEN
            IF v_quantity > 99 OR v_quantity <> trunc(v_quantity) THEN
              RAISE EXCEPTION 'Enter a whole number from 1 to 99.' USING ERRCODE = '22023';
            END IF;
          ELSE
            RAISE EXCEPTION 'That item has an unsupported unit.' USING ERRCODE = '22023';
          END IF;
          v_name := v_product.name;
          v_unit_type := v_product.unit_type;
          v_unit_price := v_product.price_per_unit;
          v_line_total := round(v_quantity * v_unit_price, 2);
        ELSE
          v_name := coalesce(nullif(btrim(v_line->>'name'), ''), 'Other');
          IF length(v_name) > 80 THEN
            RAISE EXCEPTION 'Other item name is too long.' USING ERRCODE = '22023';
          END IF;
          IF v_quantity > 50 OR scale(v_quantity) > 3 THEN
            RAISE EXCEPTION 'Enter a valid weight up to 50kg with at most three decimals.'
              USING ERRCODE = '22023';
          END IF;
          IF v_custom_total_pence IS NULL OR v_custom_total_pence NOT BETWEEN 1 AND 100000 THEN
            RAISE EXCEPTION 'Enter a price up to GBP 1000 for that item.' USING ERRCODE = '22023';
          END IF;
          v_unit_type := 'kg';
          v_line_total := v_custom_total_pence::numeric / 100;
          v_unit_price := round(v_line_total / v_quantity, 2);
          v_needs_check := true;
        END IF;

        v_subtotal := v_subtotal + v_line_total;
        v_resolved_lines := v_resolved_lines || jsonb_build_object(
          'product_id', v_product_id,
          'name', v_name,
          'quantity', v_quantity,
          'unit_type', v_unit_type,
          'unit_price', v_unit_price,
          'line_total', v_line_total,
          'needs_check', v_product_id IS NULL
        );
      END LOOP;

      IF v_subtotal <= 0 THEN
        RAISE EXCEPTION 'Sale total must be positive.' USING ERRCODE = '22023';
      END IF;
      v_business_date := public.branch_business_date(v_branch_id, now());
      v_order_ref := public.next_order_ref(v_branch_id, v_business_date);

      INSERT INTO public.orders(
        branch_id, order_ref, customer_name, customer_phone, status, pickup_date,
        subtotal, payment_method, notes, idempotency_key, idempotency_fingerprint, is_test
      ) VALUES (
        v_branch_id, v_order_ref, NULL, NULL, 'incoming', v_business_date,
        v_subtotal, p_payment_method,
        CASE WHEN v_needs_check THEN 'Owner check needed.' ELSE NULL END,
        v_key, v_fingerprint, false
      )
      RETURNING * INTO v_order;
      v_order_id := v_order.id;

      INSERT INTO public.order_items(
        branch_id, order_id, product_id, product_name_snapshot, quantity,
        unit_type, unit_price_snapshot, line_total, staff_notes
      )
      SELECT
        v_branch_id, v_order_id,
        nullif(x->>'product_id', '')::uuid,
        x->>'name',
        (x->>'quantity')::numeric,
        x->>'unit_type',
        (x->>'unit_price')::numeric,
        (x->>'line_total')::numeric,
        CASE WHEN (x->>'needs_check')::boolean THEN 'Owner check needed.' ELSE NULL END
      FROM jsonb_array_elements(v_resolved_lines) x;

      INSERT INTO public.order_status_events(branch_id, order_id, status, actor_id, note)
      VALUES (v_branch_id, v_order_id, 'incoming', v_actor, 'Shop sale.');

      PERFORM public.emit_audit_log(
        'order_created', 'order', v_order_id, v_branch_id,
        jsonb_build_object(
          'order_ref', v_order.order_ref,
          'subtotal', v_subtotal,
          'source', 'operator_serve',
          'run_id', p_run_id,
          'line_count', jsonb_array_length(v_resolved_lines)
        )
      );
    END IF;

    IF jsonb_array_length(v_resolved_lines) = 0 THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'product_id', oi.product_id,
        'name', oi.product_name_snapshot,
        'quantity', oi.quantity,
        'unit_type', oi.unit_type,
        'unit_price', oi.unit_price_snapshot,
        'line_total', oi.line_total,
        'needs_check', oi.staff_notes IS NOT NULL
      ) ORDER BY oi.created_at, oi.id), '[]'::jsonb)
      INTO v_resolved_lines
      FROM public.order_items oi WHERE oi.order_id = v_order_id;
      v_needs_check := EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = v_order_id AND oi.staff_notes IS NOT NULL
      );
    END IF;

    -- Compose the existing status machine and tender/depletion final hop inside
    -- this transaction. Any refusal below rolls back the header/items/audits.
    SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
    IF v_order.status = 'incoming' THEN
      PERFORM public.transition_order_status(v_order_id, 'prepping', 'Shop sale.');
      SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
    END IF;
    IF v_order.status = 'prepping' THEN
      PERFORM public.transition_order_status(v_order_id, 'ready', 'Shop sale.');
      SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
    END IF;
    IF v_order.status = 'ready' THEN
      PERFORM public.collect_order_with_tender(
        v_order_id,
        p_payment_method,
        'operator-serve:' || p_run_id::text || ':tender',
        'Shop sale.'
      );
      SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
    END IF;
    IF v_order.status <> 'collected' THEN
      RAISE EXCEPTION 'Shop sale could not reach collected state.' USING ERRCODE = '55000';
    END IF;

    IF v_needs_check THEN
      v_alert_id := public.ensure_operator_sale_check_alert_v18(
        v_branch_id, v_actor, v_order_id, v_order.order_ref, p_run_id,
        v_order_id::text || ':check', 'Shop sale needs owner check.'
      );
    END IF;

    v_receipt := jsonb_build_object(
      'order_id', v_order_id,
      'order_ref', v_order.order_ref,
      'status', v_order.status,
      'subtotal', v_order.subtotal,
      'needs_check', v_needs_check,
      'owner_alert_id', v_alert_id,
      'lines', v_resolved_lines,
      'request_fingerprint', v_fingerprint
    );

    UPDATE public.operator_workflow_runs
    SET status = 'completed',
        steps = jsonb_build_object(
          'lines', v_normalized_lines,
          'payKind', p_payment_method,
          'orderId', v_order_id,
          'orderRef', v_order.order_ref,
          'needsCheck', v_needs_check
        ),
        result_ref = 'order:' || v_order_id::text,
        completion_fingerprint = v_fingerprint,
        completed_at = now(),
        completion_receipt = v_receipt,
        updated_at = now()
    WHERE id = p_run_id
      AND branch_id = v_branch_id
      AND operator_id = v_actor
      AND workflow = 'serve'
      AND status = 'in_progress';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Serve run changed before completion.' USING ERRCODE = '40001';
    END IF;

    PERFORM public.emit_audit_log(
      'ops_session_completed', 'operator_workflow_run', p_run_id, v_branch_id,
      jsonb_build_object(
        'workflow', 'serve',
        'order_id', v_order_id,
        'order_ref', v_order.order_ref,
        'line_count', jsonb_array_length(v_resolved_lines),
        'needs_check', v_needs_check
      )
    );
  END IF;

  -- A completed replay returns the immutable, fully collected result.
  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'product_id', oi.product_id,
    'name', oi.product_name_snapshot,
    'quantity', oi.quantity,
    'unit_type', oi.unit_type,
    'unit_price', oi.unit_price_snapshot,
    'line_total', oi.line_total,
    'needs_check', oi.staff_notes IS NOT NULL
  ) ORDER BY oi.created_at, oi.id), '[]'::jsonb)
  INTO v_resolved_lines
  FROM public.order_items oi WHERE oi.order_id = v_order_id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_ref', v_order.order_ref,
    'status', v_order.status,
    'subtotal', v_order.subtotal,
    'needs_check', EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.order_id = v_order.id AND oi.staff_notes IS NOT NULL
    ),
    'lines', v_resolved_lines,
    'request_fingerprint', v_fingerprint,
    'replayed', v_replayed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_operator_serve_order_v18(uuid, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_operator_serve_order_v18(uuid, jsonb, text)
  TO authenticated, service_role;

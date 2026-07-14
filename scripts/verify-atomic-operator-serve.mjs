import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const container = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
const branchId = "00000000-0000-4000-8000-000000000001";
const operatorClaim = `(SELECT id::text FROM public.profiles WHERE email = 'operator@ptm.test' AND is_active LIMIT 1)`;
const ids = Object.fromEntries(
  [
    "kgProduct",
    "eachProduct",
    "unavailableProduct",
    "kgBatch",
    "run",
    "abandonedRun",
    "fractionalRun",
    "unavailableRun",
    "badCustomRun",
    "customRefundOperation",
    "legacyCompletedRun",
    "legacyCompletedOrder",
    "legacyCompletedItem",
    "legacyPartialRun",
    "legacyPartialOrder",
    "legacyPartialItem",
    "legacyBrokenRun",
    "legacyBrokenOrder",
    "legacyBrokenItem",
    "legacyHeaderRun",
    "legacyHeaderOrder",
  ].map((name) => [name, randomUUID()]),
);
const suffix = ids.run.slice(0, 8);
const orderKey = `operator-serve:${ids.run}`;
const requestLines = `[
  {"product_id":"${ids.kgProduct}","quantity":1.125},
  {"product_id":"${ids.eachProduct}","quantity":2},
  {"product_id":null,"name":"Special trim","quantity":3,"custom_total_pence":1000}
]`;
const equivalentScaleLines = `[
  {"product_id":"${ids.kgProduct}","quantity":1.125},
  {"product_id":"${ids.eachProduct}","quantity":2.000},
  {"product_id":null,"name":"Special trim","quantity":3.000,"custom_total_pence":1000}
]`;
const legacyCompletedLines = `[{"product_id":"${ids.eachProduct}","quantity":2}]`;
const legacyPartialLines = `[{"product_id":"${ids.eachProduct}","quantity":1}]`;
const legacyBrokenLines = `[{"product_id":"${ids.eachProduct}","quantity":1}]`;
const legacyHeaderLines = `[{"product_id":"${ids.eachProduct}","quantity":2}]`;

function psqlArgs() {
  return ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-tA"];
}

function runPsql(sql, label) {
  const result = spawnSync("docker", psqlArgs(), { input: sql, encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${label} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function runPsqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", psqlArgs(), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(sql);
  });
}

function assert(condition, message, details = "") {
  if (!condition) throw new Error(`${message}${details ? `\n${details}` : ""}`);
}

function expectPsqlFailure(sql, pattern, label) {
  const result = spawnSync("docker", psqlArgs(), { input: sql, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert((result.status ?? 0) !== 0, `${label} unexpectedly succeeded`, output);
  assert(pattern.test(output), `${label} returned the wrong refusal`, output);
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  runPsql(
    `
DO $$
BEGIN
  IF ${operatorClaim} IS NULL THEN
    RAISE EXCEPTION 'Seeded operator@ptm.test is required; run pnpm seed:dev first.';
  END IF;
END;
$$;

INSERT INTO public.products(
  id, branch_id, name, slug, unit_type, inventory_policy,
  price_per_unit, is_available, stock_status
) VALUES
  ('${ids.kgProduct}', '${branchId}', 'Atomic kg ${suffix}', 'atomic-kg-${suffix}',
   'kg', 'kg_batch', 12.34, true, 'in_stock'),
  ('${ids.eachProduct}', '${branchId}', 'Atomic each ${suffix}', 'atomic-each-${suffix}',
   'each', 'untracked_manual', 3.25, true, 'in_stock'),
  ('${ids.unavailableProduct}', '${branchId}', 'Atomic unavailable ${suffix}', 'atomic-unavailable-${suffix}',
   'each', 'untracked_manual', 1, true, 'out_of_stock');

INSERT INTO public.inventory_batches(
  id, product_id, branch_id, received_date, expiry_date,
  received_weight_kg, remaining_weight_kg, cost_per_kg
) VALUES (
  '${ids.kgBatch}', '${ids.kgProduct}', '${branchId}', current_date,
  current_date + 5, 10, 10, 5
);

INSERT INTO public.operator_workflow_runs(id, branch_id, operator_id, workflow, status, steps)
VALUES
  ('${ids.run}', '${branchId}', (${operatorClaim})::uuid, 'serve', 'in_progress', '{}'::jsonb),
  ('${ids.abandonedRun}', '${branchId}', (${operatorClaim})::uuid, 'serve', 'abandoned', '{}'::jsonb),
  ('${ids.fractionalRun}', '${branchId}', (${operatorClaim})::uuid, 'serve', 'in_progress', '{}'::jsonb),
  ('${ids.unavailableRun}', '${branchId}', (${operatorClaim})::uuid, 'serve', 'in_progress', '{}'::jsonb),
  ('${ids.badCustomRun}', '${branchId}', (${operatorClaim})::uuid, 'serve', 'in_progress', '{}'::jsonb);

SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);

INSERT INTO public.orders(
  id, branch_id, order_ref, status, pickup_date, subtotal, payment_method,
  idempotency_key, idempotency_fingerprint, is_test
) VALUES
  (
    '${ids.legacyCompletedOrder}', '${branchId}', 'AT-LC-${suffix}', 'incoming', current_date,
    6.50, 'cash', 'operator-serve:${ids.legacyCompletedRun}',
    'operator-serve:${ids.legacyCompletedRun}', true
  ),
  (
    '${ids.legacyPartialOrder}', '${branchId}', 'AT-LP-${suffix}', 'incoming', current_date,
    3.25, 'cash', 'operator-serve:${ids.legacyPartialRun}',
    'operator-serve:${ids.legacyPartialRun}', true
  ),
  (
    '${ids.legacyBrokenOrder}', '${branchId}', 'AT-LB-${suffix}', 'incoming', current_date,
    3.25, 'cash', 'operator-serve:${ids.legacyBrokenRun}',
    'operator-serve:${ids.legacyBrokenRun}', true
  ),
  (
    '${ids.legacyHeaderOrder}', '${branchId}', 'AT-LH-${suffix}', 'incoming', current_date,
    6.50, 'cash', 'operator-serve:${ids.legacyHeaderRun}',
    'operator-serve:${ids.legacyHeaderRun}', true
  );

INSERT INTO public.order_items(
  id, branch_id, order_id, product_id, product_name_snapshot, quantity,
  unit_type, unit_price_snapshot, line_total
) VALUES
  (
    '${ids.legacyCompletedItem}', '${branchId}', '${ids.legacyCompletedOrder}',
    '${ids.eachProduct}', 'Atomic each ${suffix}', 2, 'each', 3.25, 6.50
  ),
  (
    '${ids.legacyPartialItem}', '${branchId}', '${ids.legacyPartialOrder}',
    '${ids.eachProduct}', 'Atomic each ${suffix}', 1, 'each', 3.25, 3.25
  ),
  (
    '${ids.legacyBrokenItem}', '${branchId}', '${ids.legacyBrokenOrder}',
    '${ids.eachProduct}', 'Atomic each ${suffix}', 1, 'each', 3.25, 3.25
  );

INSERT INTO public.order_status_events(branch_id, order_id, status, actor_id, note)
VALUES
  ('${branchId}', '${ids.legacyCompletedOrder}', 'incoming', (${operatorClaim})::uuid, 'Shop sale.'),
  ('${branchId}', '${ids.legacyPartialOrder}', 'incoming', (${operatorClaim})::uuid, 'Shop sale.');

SELECT public.emit_audit_log(
  'order_created', 'order', '${ids.legacyCompletedOrder}', '${branchId}',
  jsonb_build_object('source', 'legacy_operator_serve', 'run_id', '${ids.legacyCompletedRun}')
);
SELECT public.emit_audit_log(
  'order_created', 'order', '${ids.legacyPartialOrder}', '${branchId}',
  jsonb_build_object('source', 'legacy_operator_serve', 'run_id', '${ids.legacyPartialRun}')
);

SELECT public.transition_order_status('${ids.legacyCompletedOrder}', 'prepping', 'Legacy fixture.');
SELECT public.transition_order_status('${ids.legacyCompletedOrder}', 'ready', 'Legacy fixture.');
SELECT public.collect_order_with_tender(
  '${ids.legacyCompletedOrder}', 'cash', 'legacy-completed:${ids.legacyCompletedRun}', 'Legacy fixture.'
);
SELECT public.transition_order_status('${ids.legacyPartialOrder}', 'prepping', 'Legacy fixture.');
SELECT public.transition_order_status('${ids.legacyPartialOrder}', 'ready', 'Legacy fixture.');

INSERT INTO public.operator_workflow_runs(
  id, branch_id, operator_id, workflow, status, steps, result_ref
) VALUES
  (
    '${ids.legacyCompletedRun}', '${branchId}', (${operatorClaim})::uuid, 'serve', 'completed',
    '{}'::jsonb, 'order:${ids.legacyCompletedOrder}'
  ),
  (
    '${ids.legacyPartialRun}', '${branchId}', (${operatorClaim})::uuid, 'serve', 'in_progress',
    '{}'::jsonb, NULL
  ),
  (
    '${ids.legacyBrokenRun}', '${branchId}', (${operatorClaim})::uuid, 'serve', 'in_progress',
    '{}'::jsonb, NULL
  ),
  (
    '${ids.legacyHeaderRun}', '${branchId}', (${operatorClaim})::uuid, 'serve', 'in_progress',
    '{}'::jsonb, NULL
  );
`,
    "atomic serve fixture setup",
  );

  const first = runPsqlAsync(`
BEGIN;
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.run}', $json$${requestLines}$json$::jsonb, 'card'
);
SELECT pg_sleep(1.25);
COMMIT;
`);
  await sleep(250);
  const second = runPsqlAsync(`
BEGIN;
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.run}', $json$${requestLines}$json$::jsonb, 'card'
);
COMMIT;
`);
  const [winner, replay] = await Promise.all([first, second]);
  assert(winner.status === 0, "first atomic serve connection failed", `${winner.stdout}${winner.stderr}`);
  assert(replay.status === 0, "second atomic serve connection failed", `${replay.stdout}${replay.stderr}`);
  assert(/"replayed"\s*:\s*false/i.test(winner.stdout), "first connection was not the creator", winner.stdout);
  assert(/"replayed"\s*:\s*true/i.test(replay.stdout), "second connection did not replay", replay.stdout);

  runPsql(
    `
DO $$
DECLARE
  o public.orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.orders WHERE idempotency_key = '${orderKey}';
  IF o.id IS NULL
     OR o.subtotal <> 30.38
     OR o.status <> 'collected'
     OR o.payment_method <> 'card'
     OR o.idempotency_fingerprint IS NULL
     OR (SELECT count(*) FROM public.orders WHERE idempotency_key = '${orderKey}') <> 1
     OR (SELECT count(*) FROM public.order_items WHERE order_id = o.id) <> 3
     OR NOT EXISTS (
       SELECT 1 FROM public.order_items
       WHERE order_id = o.id AND product_id = '${ids.kgProduct}'
         AND quantity = 1.125 AND unit_type = 'kg'
         AND unit_price_snapshot = 12.34 AND line_total = 13.88
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.order_items
       WHERE order_id = o.id AND product_id = '${ids.eachProduct}'
         AND quantity = 2 AND quantity = trunc(quantity) AND unit_type = 'each'
         AND unit_price_snapshot = 3.25 AND line_total = 6.50
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.order_items
       WHERE order_id = o.id AND product_id IS NULL AND product_name_snapshot = 'Special trim'
         AND quantity = 3 AND unit_type = 'kg'
         AND unit_price_snapshot = 3.33 AND line_total = 10
         AND staff_notes IS NOT NULL
     )
     OR (SELECT count(*) FROM public.order_status_events WHERE order_id = o.id AND status = 'incoming') <> 1
     OR (SELECT count(*) FROM public.audit_logs WHERE target_id = o.id AND event_type = 'order_created') <> 1
     OR (SELECT count(*) FROM public.audit_logs WHERE target_id = '${ids.run}' AND event_type = 'ops_session_completed') <> 1
     OR (SELECT count(*) FROM public.payment_events WHERE order_id = o.id AND direction = 'sale') <> 1
     OR (SELECT amount_pence FROM public.payment_events WHERE order_id = o.id AND direction = 'sale') <> 3038
     OR (SELECT count(*) FROM public.inventory_movements
         WHERE order_id = o.id AND source_event = 'SALE_COLLECT') <> 1
     OR (SELECT coalesce(sum(abs(m.delta_kg)), 0)
         FROM public.inventory_movements m
         JOIN public.inventory_batches b ON b.id = m.batch_id
         WHERE m.order_id = o.id AND m.source_event = 'SALE_COLLECT'
           AND b.product_id = '${ids.kgProduct}') <> 1.125
     OR EXISTS (
       SELECT 1 FROM public.inventory_movements m
       JOIN public.order_items oi ON oi.id = m.order_item_id
       WHERE m.order_id = o.id AND m.source_event = 'SALE_COLLECT'
         AND oi.product_id = '${ids.eachProduct}'
     )
     OR NOT (SELECT amendment_seq = 0 AND total_required_kg = 1.125 AND total_depleted_kg = 1.125
             FROM public.order_inventory_depletions WHERE order_id = o.id)
     OR (SELECT count(*) FROM public.order_inventory_line_depletions WHERE order_id = o.id) <> 3
     OR (SELECT remaining_weight_kg FROM public.inventory_batches WHERE id = '${ids.kgBatch}') <> 8.875
     OR (SELECT count(*) FROM public.owner_alerts
         WHERE branch_id = '${branchId}' AND kind = 'operator_sale_check_needed'
           AND entity_ref = o.id::text || ':check') <> 1
     OR (SELECT count(*) FROM public.audit_logs a
         JOIN public.owner_alerts oa ON oa.id = a.target_id
         WHERE oa.entity_ref = o.id::text || ':check'
           AND a.event_type = 'inventory_reconciliation_issue') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.operator_workflow_runs r
       WHERE r.id = '${ids.run}' AND r.status = 'completed'
         AND r.result_ref = 'order:' || o.id::text
         AND r.completion_fingerprint = o.idempotency_fingerprint
         AND r.completed_at IS NOT NULL
         AND r.completion_receipt->>'order_id' = o.id::text
         AND (r.completion_receipt->>'subtotal')::numeric = 30.38
         AND r.completion_receipt->>'status' = 'collected'
         AND r.completion_receipt->>'owner_alert_id' IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'atomic creation did not leave exactly one complete server-priced graph';
  END IF;
END;
$$;
`,
    "atomic serve creation assertions",
  );

  expectPsqlFailure(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.run}',
  $json$[{"product_id":"${ids.kgProduct}","quantity":1.126}]$json$::jsonb,
  'card'
);
`,
    /different details/i,
    "changed-payload replay",
  );
  expectPsqlFailure(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.abandonedRun}', $json$${requestLines}$json$::jsonb, 'card'
);
`,
    /start fresh|replaced/i,
    "abandoned-run replay",
  );
  expectPsqlFailure(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.fractionalRun}',
  $json$[{"product_id":"${ids.eachProduct}","quantity":1.5}]$json$::jsonb,
  'cash'
);
`,
    /whole number/i,
    "fractional each sale",
  );
  expectPsqlFailure(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.unavailableRun}',
  $json$[{"product_id":"${ids.unavailableProduct}","quantity":1}]$json$::jsonb,
  'cash'
);
`,
    /no longer available/i,
    "out-of-stock sale",
  );
  expectPsqlFailure(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.badCustomRun}',
  $json$[{"product_id":null,"name":"Other","quantity":1,"custom_total_pence":0}]$json$::jsonb,
  'cash'
);
`,
    /price/i,
    "invalid custom-price sale",
  );

  const scaleReplay = runPsql(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.run}', $json$${equivalentScaleLines}$json$::jsonb, 'card'
);
`,
    "equivalent numeric-scale replay",
  );
  assert(/"replayed"\s*:\s*true/i.test(scaleReplay), "equivalent numeric scale was not replayed", scaleReplay);

  const legacyCompletedReplay = runPsql(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.legacyCompletedRun}', $json$${legacyCompletedLines}$json$::jsonb, 'cash'
);
`,
    "completed legacy serve replay",
  );
  assert(/"replayed"\s*:\s*true/i.test(legacyCompletedReplay), "completed legacy serve did not replay", legacyCompletedReplay);
  assert(/"status"\s*:\s*"collected"/i.test(legacyCompletedReplay), "completed legacy replay lost collected state", legacyCompletedReplay);
  expectPsqlFailure(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.legacyCompletedRun}',
  $json$[{"product_id":"${ids.eachProduct}","quantity":3}]$json$::jsonb,
  'cash'
);
`,
    /different details/i,
    "changed completed-legacy replay",
  );

  const legacyPartialRecovery = runPsql(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.legacyPartialRun}', $json$${legacyPartialLines}$json$::jsonb, 'cash'
);
`,
    "partial legacy serve recovery",
  );
  assert(/"replayed"\s*:\s*false/i.test(legacyPartialRecovery), "partial legacy serve was not recovered as the creator", legacyPartialRecovery);
  assert(/"status"\s*:\s*"collected"/i.test(legacyPartialRecovery), "partial legacy serve did not reach collected", legacyPartialRecovery);
  const legacyPartialReplay = runPsql(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.legacyPartialRun}', $json$${legacyPartialLines}$json$::jsonb, 'cash'
);
`,
    "recovered legacy serve replay",
  );
  assert(/"replayed"\s*:\s*true/i.test(legacyPartialReplay), "recovered legacy serve did not replay", legacyPartialReplay);

  const brokenLegacyReview = runPsql(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.legacyBrokenRun}', $json$${legacyBrokenLines}$json$::jsonb, 'cash'
);
`,
    "legacy serve missing-creation-facts review",
  );
  assert(/"outcome"\s*:\s*"owner_review"/i.test(brokenLegacyReview), "legacy sale missing creation facts was not escalated", brokenLegacyReview);
  assert(/do not enter it again/i.test(brokenLegacyReview), "legacy escalation omitted the duplicate-entry warning", brokenLegacyReview);
  const brokenLegacyReplay = runPsql(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.legacyBrokenRun}', $json$${legacyBrokenLines}$json$::jsonb, 'cash'
);
`,
    "legacy serve owner-review replay",
  );
  assert(/"outcome"\s*:\s*"owner_review"/i.test(brokenLegacyReplay), "legacy owner-review receipt was not stable", brokenLegacyReplay);

  const headerOnlyReview = runPsql(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.legacyHeaderRun}', $json$${legacyHeaderLines}$json$::jsonb, 'cash'
);
`,
    "legacy header-only serve review",
  );
  assert(/"outcome"\s*:\s*"owner_review"/i.test(headerOnlyReview), "legacy header-only sale was not escalated", headerOnlyReview);

  runPsql(
    `
DO $$
BEGIN
  IF (SELECT count(*) FROM public.payment_events
      WHERE order_id = '${ids.legacyCompletedOrder}' AND direction = 'sale') <> 1
     OR (SELECT count(*) FROM public.order_inventory_depletions
         WHERE order_id = '${ids.legacyCompletedOrder}' AND source_event = 'SALE_COLLECT') <> 1
     OR (SELECT count(*) FROM public.order_status_events
         WHERE order_id = '${ids.legacyCompletedOrder}' AND status = 'incoming') <> 1
     OR (SELECT count(*) FROM public.audit_logs
         WHERE target_id = '${ids.legacyCompletedOrder}' AND event_type = 'order_created') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.operator_workflow_runs
       WHERE id = '${ids.legacyCompletedRun}' AND status = 'completed'
         AND completion_fingerprint IS NULL AND completion_receipt IS NULL
         AND result_ref = 'order:${ids.legacyCompletedOrder}'
     )
     OR (SELECT status FROM public.orders WHERE id = '${ids.legacyPartialOrder}') <> 'collected'
     OR (SELECT count(*) FROM public.payment_events
         WHERE order_id = '${ids.legacyPartialOrder}' AND direction = 'sale' AND method = 'cash') <> 1
     OR (SELECT count(*) FROM public.order_inventory_depletions
         WHERE order_id = '${ids.legacyPartialOrder}' AND source_event = 'SALE_COLLECT') <> 1
     OR (SELECT count(*) FROM public.order_status_events
         WHERE order_id = '${ids.legacyPartialOrder}' AND status = 'incoming') <> 1
     OR (SELECT count(*) FROM public.audit_logs
         WHERE target_id = '${ids.legacyPartialOrder}' AND event_type = 'order_created') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.operator_workflow_runs r
       JOIN public.orders o ON o.id = '${ids.legacyPartialOrder}'
       WHERE r.id = '${ids.legacyPartialRun}' AND r.status = 'completed'
         AND r.result_ref = 'order:${ids.legacyPartialOrder}'
         AND r.completion_fingerprint = o.idempotency_fingerprint
         AND r.completion_receipt->>'status' = 'collected'
     )
     OR EXISTS (
       SELECT 1 FROM public.payment_events
       WHERE order_id IN ('${ids.legacyBrokenOrder}', '${ids.legacyHeaderOrder}')
     )
     OR EXISTS (
       SELECT 1 FROM public.order_inventory_depletions
       WHERE order_id IN ('${ids.legacyBrokenOrder}', '${ids.legacyHeaderOrder}')
     )
     OR (SELECT count(*) FROM public.owner_alerts
         WHERE kind = 'operator_sale_check_needed'
           AND entity_ref = '${ids.legacyBrokenOrder}:repair' AND resolved_at IS NULL) <> 1
     OR (SELECT count(*) FROM public.owner_alerts
         WHERE kind = 'operator_sale_check_needed'
           AND entity_ref = '${ids.legacyHeaderOrder}:repair' AND resolved_at IS NULL) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.operator_workflow_runs
       WHERE id = '${ids.legacyBrokenRun}' AND status = 'completed'
         AND result_ref = 'order:${ids.legacyBrokenOrder}'
         AND completion_fingerprint IS NOT NULL
         AND completion_receipt->>'outcome' = 'owner_review'
         AND completion_receipt->>'owner_alert_id' IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.operator_workflow_runs
       WHERE id = '${ids.legacyHeaderRun}' AND status = 'completed'
         AND result_ref = 'order:${ids.legacyHeaderOrder}'
         AND completion_fingerprint IS NOT NULL
         AND completion_receipt->>'outcome' = 'owner_review'
         AND completion_receipt->>'owner_alert_id' IS NOT NULL
     )
     OR (SELECT count(*) FROM public.audit_logs
         WHERE target_id = '${ids.legacyBrokenRun}' AND event_type = 'ops_session_completed') <> 1
     OR (SELECT count(*) FROM public.audit_logs
         WHERE target_id = '${ids.legacyHeaderRun}' AND event_type = 'ops_session_completed') <> 1 THEN
    RAISE EXCEPTION 'legacy serve recovery did not preserve or terminalize the exact operation graph';
  END IF;
END;
$$;
`,
    "legacy serve recovery assertions",
  );

  // Repricing after completion cannot mutate or invalidate the saved request;
  // a matching replay returns the immutable order snapshots.
  runPsql(`UPDATE public.products SET price_per_unit = 99 WHERE id = '${ids.kgProduct}';`, "catalogue repricing probe");
  const repricedReplay = runPsql(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.run}', $json$${requestLines}$json$::jsonb, 'card'
);
`,
    "post-repricing replay",
  );
  assert(/"replayed"\s*:\s*true/i.test(repricedReplay), "post-repricing call did not replay", repricedReplay);
  assert(/"subtotal"\s*:\s*30\.38/i.test(repricedReplay), "post-repricing replay changed saved money", repricedReplay);

  const finalReplay = runPsql(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.create_operator_serve_order_v18(
  '${ids.run}', $json$${requestLines}$json$::jsonb, 'card'
);
`,
    "collected-order replay",
  );
  assert(/"replayed"\s*:\s*true/i.test(finalReplay), "collected order did not replay", finalReplay);
  assert(/"status"\s*:\s*"collected"/i.test(finalReplay), "replay did not return current order status", finalReplay);

  runPsql(
    `
SELECT set_config('request.jwt.claim.sub', ${operatorClaim}, false);
SELECT public.refund_order_v18(
  '${ids.customRefundOperation}',
  (SELECT id FROM public.orders WHERE idempotency_key = '${orderKey}'),
  jsonb_build_array(jsonb_build_object(
    'order_item_id', (
      SELECT oi.id FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.idempotency_key = '${orderKey}' AND oi.product_id IS NULL
    ),
    'quantity', 3
  )),
  jsonb_build_array(jsonb_build_object(
    'order_item_id', (
      SELECT oi.id FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.idempotency_key = '${orderKey}' AND oi.product_id IS NULL
    ),
    'disposition', 'customer_kept'
  )),
  'non-divisible custom total probe'
);
DO $$
DECLARE
  oid uuid := (SELECT id FROM public.orders WHERE idempotency_key = '${orderKey}');
BEGIN
  IF (SELECT total_amount_pence FROM public.refund_operations WHERE id = '${ids.customRefundOperation}') <> 1000
     OR (SELECT amount_pence FROM public.refund_line_outcomes
         WHERE refund_operation_id = '${ids.customRefundOperation}') <> 1000
     OR (SELECT count(*) FROM public.payment_events WHERE order_id = oid AND direction = 'refund') <> 1
     OR (SELECT amount_pence FROM public.payment_events
         WHERE order_id = oid AND direction = 'refund') <> 1000
     OR (SELECT count(*) FROM public.owner_alerts
         WHERE kind = 'operator_sale_check_needed' AND entity_ref = oid::text || ':check') <> 1 THEN
    RAISE EXCEPTION 'full custom-line refund did not preserve exact persisted GBP10 total';
  END IF;
END;
$$;
`,
    "non-divisible custom-line refund assertions",
  );

  runPsql(
    `
DO $$
BEGIN
  IF (SELECT count(*) FROM public.orders WHERE idempotency_key = '${orderKey}') <> 1
     OR (SELECT count(*) FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
         WHERE o.idempotency_key = '${orderKey}') <> 3
     OR EXISTS (
       SELECT 1 FROM public.orders
       WHERE idempotency_key IN (
         'operator-serve:${ids.abandonedRun}',
         'operator-serve:${ids.fractionalRun}',
         'operator-serve:${ids.unavailableRun}',
         'operator-serve:${ids.badCustomRun}'
       )
     )
     OR EXISTS (
       SELECT 1 FROM public.operator_workflow_runs
       WHERE id IN ('${ids.fractionalRun}', '${ids.unavailableRun}', '${ids.badCustomRun}')
         AND (status <> 'in_progress' OR completion_fingerprint IS NOT NULL OR result_ref IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'replay/refusal probes changed the atomic business graph';
  END IF;
END;
$$;
`,
    "atomic serve refusal integrity assertions",
  );

  console.log("V18 atomic operator serve two-connection battery passed");
} finally {
  runPsql(
    `
BEGIN;
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE cleanup_atomic_serve_orders ON COMMIT DROP AS
SELECT id FROM public.orders
WHERE idempotency_key IN (
  '${orderKey}',
  'operator-serve:${ids.abandonedRun}',
  'operator-serve:${ids.fractionalRun}',
  'operator-serve:${ids.unavailableRun}',
  'operator-serve:${ids.badCustomRun}',
  'operator-serve:${ids.legacyCompletedRun}',
  'operator-serve:${ids.legacyPartialRun}',
  'operator-serve:${ids.legacyBrokenRun}',
  'operator-serve:${ids.legacyHeaderRun}'
);
DELETE FROM public.audit_logs
WHERE target_id IN (SELECT id FROM cleanup_atomic_serve_orders)
   OR target_id IN (
     SELECT oa.id FROM public.owner_alerts oa
     WHERE EXISTS (
       SELECT 1 FROM cleanup_atomic_serve_orders o
       WHERE oa.entity_ref LIKE o.id::text || ':%'
     )
   )
   OR target_id IN (
     '${ids.run}'::uuid, '${ids.abandonedRun}'::uuid, '${ids.fractionalRun}'::uuid,
     '${ids.unavailableRun}'::uuid, '${ids.badCustomRun}'::uuid,
     '${ids.legacyCompletedRun}'::uuid, '${ids.legacyPartialRun}'::uuid,
     '${ids.legacyBrokenRun}'::uuid, '${ids.legacyHeaderRun}'::uuid
   );
DELETE FROM public.owner_alerts oa
WHERE EXISTS (
  SELECT 1 FROM cleanup_atomic_serve_orders o
  WHERE oa.entity_ref LIKE o.id::text || ':%'
);
DELETE FROM public.inventory_waste_events
WHERE order_item_id IN (
  SELECT id FROM public.order_items WHERE order_id IN (SELECT id FROM cleanup_atomic_serve_orders)
);
DELETE FROM public.inventory_movements WHERE order_id IN (SELECT id FROM cleanup_atomic_serve_orders);
DELETE FROM public.inventory_reversal_groups WHERE order_id IN (SELECT id FROM cleanup_atomic_serve_orders);
DELETE FROM public.refund_line_outcomes WHERE order_id IN (SELECT id FROM cleanup_atomic_serve_orders);
DELETE FROM public.payment_events WHERE order_id IN (SELECT id FROM cleanup_atomic_serve_orders);
DELETE FROM public.refund_operations WHERE order_id IN (SELECT id FROM cleanup_atomic_serve_orders);
DELETE FROM public.order_inventory_line_depletions WHERE order_id IN (SELECT id FROM cleanup_atomic_serve_orders);
DELETE FROM public.order_inventory_depletions WHERE order_id IN (SELECT id FROM cleanup_atomic_serve_orders);
DELETE FROM public.order_status_events WHERE order_id IN (SELECT id FROM cleanup_atomic_serve_orders);
DELETE FROM public.order_amendments WHERE order_id IN (SELECT id FROM cleanup_atomic_serve_orders);
DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM cleanup_atomic_serve_orders);
DELETE FROM public.orders WHERE id IN (SELECT id FROM cleanup_atomic_serve_orders);
DELETE FROM public.operator_workflow_runs
WHERE id IN (
  '${ids.run}'::uuid, '${ids.abandonedRun}'::uuid, '${ids.fractionalRun}'::uuid,
  '${ids.unavailableRun}'::uuid, '${ids.badCustomRun}'::uuid,
  '${ids.legacyCompletedRun}'::uuid, '${ids.legacyPartialRun}'::uuid,
  '${ids.legacyBrokenRun}'::uuid, '${ids.legacyHeaderRun}'::uuid
);
DELETE FROM public.inventory_batches WHERE id = '${ids.kgBatch}';
DELETE FROM public.products
WHERE id IN ('${ids.kgProduct}'::uuid, '${ids.eachProduct}'::uuid, '${ids.unavailableProduct}'::uuid);
COMMIT;
`,
    "atomic serve fixture cleanup",
  );
}

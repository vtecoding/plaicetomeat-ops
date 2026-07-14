import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const container = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
const branchId = "00000000-0000-4000-8000-000000000001";
const managerClaim = `(SELECT id::text FROM public.profiles WHERE email = 'manager@ptm.test' AND is_active LIMIT 1)`;
const ids = Object.fromEntries(
  [
    "amendProduct",
    "amendBatch",
    "amendOrder",
    "amendItem",
    "refundProduct",
    "refundBatch",
    "refundOrder",
    "refundItem",
    "refundOperationOne",
    "refundOperationTwo",
  ].map((name) => [name, randomUUID()]),
);
const suffix = ids.amendOrder.slice(0, 8);

function psqlArgs() {
  return ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
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

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
runPsql(
  `
BEGIN;
DO $$
BEGIN
  IF ${managerClaim} IS NULL THEN
    RAISE EXCEPTION 'Seeded manager@ptm.test is required; run pnpm seed:dev first.';
  END IF;
END;
$$;

INSERT INTO public.products(
  id, branch_id, name, slug, unit_type, inventory_policy,
  price_per_unit, is_available, stock_status
) VALUES
  ('${ids.amendProduct}', '${branchId}', 'V18 amend race ${suffix}', 'v18-amend-race-${suffix}',
   'kg', 'kg_batch', 10, true, 'in_stock'),
  ('${ids.refundProduct}', '${branchId}', 'V18 refund race ${suffix}', 'v18-refund-race-${suffix}',
   'kg', 'kg_batch', 10, true, 'in_stock');

INSERT INTO public.inventory_batches(
  id, product_id, branch_id, received_date, expiry_date,
  received_weight_kg, remaining_weight_kg, cost_per_kg
) VALUES
  ('${ids.amendBatch}', '${ids.amendProduct}', '${branchId}', current_date, current_date + 5, 5, 5, 5),
  ('${ids.refundBatch}', '${ids.refundProduct}', '${branchId}', current_date, current_date + 5, 5, 5, 5);

INSERT INTO public.orders(
  id, branch_id, order_ref, customer_name, customer_phone, status,
  pickup_date, subtotal, idempotency_key, is_test
) VALUES
  ('${ids.amendOrder}', '${branchId}', 'V18-A-${suffix}', 'V18 race', '07000000000',
   'incoming', current_date, 10, 'v18-amend-race-${ids.amendOrder}', true),
  ('${ids.refundOrder}', '${branchId}', 'V18-R-${suffix}', 'V18 race', '07000000000',
   'incoming', current_date, 10, 'v18-refund-race-${ids.refundOrder}', true);

INSERT INTO public.order_items(
  id, branch_id, order_id, product_id, product_name_snapshot,
  quantity, unit_type, unit_price_snapshot, line_total
) VALUES
  ('${ids.amendItem}', '${branchId}', '${ids.amendOrder}', '${ids.amendProduct}',
   'V18 amend race', 1, 'kg', 10, 10),
  ('${ids.refundItem}', '${branchId}', '${ids.refundOrder}', '${ids.refundProduct}',
   'V18 refund race', 1, 'kg', 10, 10);

SELECT set_config('request.jwt.claim.sub', ${managerClaim}, true);
SELECT public.transition_order_status('${ids.amendOrder}', 'prepping', NULL);
SELECT public.transition_order_status('${ids.amendOrder}', 'ready', NULL);
SELECT public.transition_order_status('${ids.refundOrder}', 'prepping', NULL);
SELECT public.transition_order_status('${ids.refundOrder}', 'ready', NULL);
SELECT public.collect_order_with_tender('${ids.refundOrder}', 'cash', 'v18-refund-race-sale-${ids.refundOrder}', NULL);
COMMIT;
`,
  "race fixture setup",
);

// Connection one keeps the amendment transaction open after the RPC returns.
// Connection two therefore overlaps the same order/version and must fail cleanly.
const amendConnection = runPsqlAsync(`
BEGIN;
SELECT set_config('request.jwt.claim.sub', ${managerClaim}, true);
SELECT public.amend_order_item_v18(
  '${ids.amendOrder}', '${ids.amendItem}', 'weight_adjust', 1.250, NULL,
  'two-connection race', 'v18-amend-race-op-${ids.amendOrder}', 0, true
);
SELECT pg_sleep(1.25);
COMMIT;
`);
await sleep(250);
const collectLoser = await runPsqlAsync(`
BEGIN;
SELECT set_config('request.jwt.claim.sub', ${managerClaim}, true);
SELECT public.collect_order_with_tender(
  '${ids.amendOrder}', 'card', 'v18-amend-race-tender-loser-${ids.amendOrder}', NULL
);
COMMIT;
`);
const amendWinner = await amendConnection;
assert(amendWinner.status === 0, "amend side of amend/collect race did not succeed", amendWinner.stderr);
assert(collectLoser.status !== 0, "both sides of amend/collect race succeeded");
assert(
  /being changed on another screen/i.test(`${collectLoser.stdout}${collectLoser.stderr}`),
  "amend/collect loser did not receive the clean concurrency error",
  `${collectLoser.stdout}${collectLoser.stderr}`,
);

runPsql(
  `
BEGIN;
DO $$
BEGIN
  IF (SELECT status FROM public.orders WHERE id = '${ids.amendOrder}') <> 'ready'
     OR (SELECT count(*) FROM public.order_amendments WHERE order_id = '${ids.amendOrder}') <> 1
     OR EXISTS (SELECT 1 FROM public.payment_events WHERE order_id = '${ids.amendOrder}')
     OR EXISTS (SELECT 1 FROM public.order_inventory_depletions WHERE order_id = '${ids.amendOrder}') THEN
    RAISE EXCEPTION 'amend/collect race left mixed tender or depletion facts';
  END IF;
END;
$$;
SELECT set_config('request.jwt.claim.sub', ${managerClaim}, true);
SELECT public.collect_order_with_tender(
  '${ids.amendOrder}', 'card', 'v18-amend-race-tender-retry-${ids.amendOrder}', NULL
);
DO $$
BEGIN
  IF (SELECT status FROM public.orders WHERE id = '${ids.amendOrder}') <> 'collected'
     OR (SELECT amount_pence FROM public.payment_events
         WHERE order_id = '${ids.amendOrder}' AND direction = 'sale') <> 1250
     OR NOT (SELECT amendment_seq = 1 AND total_required_kg = 1.250 AND total_depleted_kg = 1.250
             FROM public.order_inventory_depletions WHERE order_id = '${ids.amendOrder}')
     OR (SELECT coalesce(sum(abs(delta_kg)), 0) FROM public.inventory_movements
         WHERE order_id = '${ids.amendOrder}' AND source_event = 'SALE_COLLECT') <> 1.250 THEN
    RAISE EXCEPTION 'retry did not tender and deplete the same frozen amended version';
  END IF;
END;
$$;
COMMIT;
`,
  "amend/collect frozen-version assertions",
);

// The first refund keeps its order-row lock until commit. A second manager
// connection asks for the same remaining balance while that lock is held.
const firstRefund = runPsqlAsync(`
BEGIN;
SELECT set_config('request.jwt.claim.sub', ${managerClaim}, true);
SELECT public.refund_order_v18(
  '${ids.refundOperationOne}', '${ids.refundOrder}',
  '[{"order_item_id":"${ids.refundItem}","quantity":1}]'::jsonb,
  '[{"order_item_id":"${ids.refundItem}","disposition":"returned_restockable"}]'::jsonb,
  'two-connection refund race'
);
SELECT pg_sleep(1.25);
COMMIT;
`);
await sleep(250);
const secondRefund = runPsqlAsync(`
BEGIN;
SELECT set_config('request.jwt.claim.sub', ${managerClaim}, true);
SELECT public.refund_order_v18(
  '${ids.refundOperationTwo}', '${ids.refundOrder}',
  '[{"order_item_id":"${ids.refundItem}","quantity":1}]'::jsonb,
  '[{"order_item_id":"${ids.refundItem}","disposition":"returned_restockable"}]'::jsonb,
  'two-connection refund race'
);
COMMIT;
`);
const [refundWinner, refundLoser] = await Promise.all([firstRefund, secondRefund]);
assert(refundWinner.status === 0, "first side of refund race did not succeed", refundWinner.stderr);
assert(refundLoser.status !== 0, "both concurrent refunds succeeded");
assert(
  /already refunded|exceeds|remaining|quantity/i.test(`${refundLoser.stdout}${refundLoser.stderr}`),
  "refund loser did not receive a balance/quantity error",
  `${refundLoser.stdout}${refundLoser.stderr}`,
);

runPsql(
  `
DO $$
DECLARE
  original_movement uuid;
BEGIN
  SELECT id INTO original_movement
  FROM public.inventory_movements
  WHERE order_id = '${ids.refundOrder}' AND source_event = 'SALE_COLLECT';

  IF (SELECT coalesce(sum(amount_pence), 0) FROM public.payment_events
      WHERE order_id = '${ids.refundOrder}' AND direction = 'refund') <> 1000
     OR (SELECT count(*) FROM public.refund_operations WHERE order_id = '${ids.refundOrder}') <> 1
     OR (SELECT count(*) FROM public.refund_line_outcomes WHERE order_id = '${ids.refundOrder}') <> 1
     OR EXISTS (SELECT 1 FROM public.refund_operations WHERE id = '${ids.refundOperationTwo}')
     OR (SELECT remaining_weight_kg FROM public.inventory_batches WHERE id = '${ids.refundBatch}') <> 5
     OR (SELECT coalesce(sum(quantity_kg), 0) FROM public.inventory_movements
         WHERE reversal_of_movement_id = original_movement) <> 1 THEN
    RAISE EXCEPTION 'concurrent refund race exceeded tender or left partial stock facts';
  END IF;
END;
$$;
`,
  "refund race assertions",
);

console.log("V18 two-connection order-correction concurrency battery passed");
} finally {
  // This gate commits fixtures so independent connections can overlap them.
  // Always remove the exact random graph, even when an assertion fails, so a
  // repeated local/release run cannot leave active catalogue or stock rows.
  runPsql(
    `
SET session_replication_role = replica;
DELETE FROM public.audit_logs
WHERE target_id IN (
  '${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid,
  '${ids.refundOperationOne}'::uuid, '${ids.refundOperationTwo}'::uuid
)
OR target_id IN (
  SELECT id FROM public.owner_alerts
  WHERE entity_ref IN ('refund:${ids.refundOperationOne}', 'refund:${ids.refundOperationTwo}')
     OR entity_ref LIKE '${ids.amendOrder}:%'
     OR entity_ref LIKE '${ids.refundOrder}:%'
);
DELETE FROM public.owner_alerts
WHERE entity_ref IN ('refund:${ids.refundOperationOne}', 'refund:${ids.refundOperationTwo}')
   OR entity_ref LIKE '${ids.amendOrder}:%'
   OR entity_ref LIKE '${ids.refundOrder}:%';
DELETE FROM public.inventory_waste_events
WHERE order_item_id IN ('${ids.amendItem}'::uuid, '${ids.refundItem}'::uuid)
   OR refund_operation_id IN ('${ids.refundOperationOne}'::uuid, '${ids.refundOperationTwo}'::uuid);
DELETE FROM public.inventory_movements
WHERE order_id IN ('${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid)
   OR batch_id IN ('${ids.amendBatch}'::uuid, '${ids.refundBatch}'::uuid);
DELETE FROM public.inventory_reversal_groups
WHERE order_id IN ('${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid)
   OR refund_operation_id IN ('${ids.refundOperationOne}'::uuid, '${ids.refundOperationTwo}'::uuid);
DELETE FROM public.refund_line_outcomes
WHERE order_id IN ('${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid);
DELETE FROM public.payment_events
WHERE order_id IN ('${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid);
DELETE FROM public.refund_operations
WHERE order_id IN ('${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid)
   OR id IN ('${ids.refundOperationOne}'::uuid, '${ids.refundOperationTwo}'::uuid);
DELETE FROM public.order_inventory_line_depletions
WHERE order_id IN ('${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid);
DELETE FROM public.order_inventory_depletions
WHERE order_id IN ('${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid);
DELETE FROM public.order_status_events
WHERE order_id IN ('${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid);
DELETE FROM public.order_amendments
WHERE order_id IN ('${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid);
DELETE FROM public.order_items
WHERE order_id IN ('${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid);
DELETE FROM public.orders
WHERE id IN ('${ids.amendOrder}'::uuid, '${ids.refundOrder}'::uuid);
DELETE FROM public.inventory_batches
WHERE id IN ('${ids.amendBatch}'::uuid, '${ids.refundBatch}'::uuid);
DELETE FROM public.products
WHERE id IN ('${ids.amendProduct}'::uuid, '${ids.refundProduct}'::uuid);
SET session_replication_role = origin;
`,
    "race fixture cleanup",
  );
}

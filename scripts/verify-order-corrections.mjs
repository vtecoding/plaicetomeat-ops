import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const b3 = read("supabase/migrations/202607141600_v18_refunds.sql");
const b4 = read("supabase/migrations/202607141700_v18_order_amendments.sql");
const action = read("src/app/actions/order-corrections.ts");
const orders = read("src/lib/server/orders.ts");
const publicRead = read("supabase/migrations/202607141700_v18_order_amendments.sql");

const failures = [];
function requireContract(ok, message) {
  if (!ok) failures.push(message);
}

const refundSignature = b3.match(/refund_order_v18\s*\(([\s\S]*?)\)\s*RETURNS jsonb/i)?.[1] ?? "";
requireContract(!/p_method/i.test(refundSignature), "refund_order_v18 must not accept a method");
requireContract(/direction\s*=\s*'sale'[\s\S]*GROUP BY method/i.test(b3), "refund method must derive from sale events");
requireContract(/remaining per-method tender balance/i.test(b3), "per-method net refundable cap missing");
requireContract(/reversal_of_movement_id = v_original\.id/i.test(b3), "exact original allocation reversal missing");
requireContract(/REFUND_LINE_REVERSAL/.test(b3) && /REFUND_RETURN_WASTE/.test(b3), "discard must be reversal plus waste");
requireContract(/customer_kept/.test(b3), "customer-kept no-movement disposition missing");
requireContract(/refund_operations_append_only/.test(b3), "refund operation append-only guard missing");
requireContract(/FOR UPDATE/.test(b3), "refund order row lock missing");
requireContract(/calculate_refund_v18/.test(b3) && /preview_refund_order_v18/.test(b3), "preview/mutation calculator parity missing");
requireContract(/v_remaining_line_pence/.test(b3) && /v_prior_amount/.test(b3), "split-rounding line-pence cap missing");
requireContract(/unit_type IN \('each', 'box'\)[\s\S]*trunc\(v_line\.quantity\)/.test(b3), "count refunds must be whole quantities");
requireContract(/INSERT INTO public\.owner_alerts[\s\S]*refund_above_threshold/.test(b3), "refund alert must be written in the RPC transaction");
requireContract(/owner_alerts_refund_operation_uniq/.test(b3), "refund alert must be operation-idempotent");
requireContract(/request_fingerprint/.test(b3) && /different details/.test(b3), "refund replay must reject changed payloads");
requireContract(/line_total_pence::numeric[\s\S]*depletion_cap_quantity[\s\S]*effective_quantity/.test(b3), "refund money must prorate exact persisted line total");
requireContract(/Expired returned stock/.test(b3), "expired returns must not be restocked for sale");

requireContract(/get_effective_order_lines_v18/.test(b4), "authoritative SQL fold missing");
requireContract(/WITH RECURSIVE states/i.test(b4), "fold must be ordered recursive composition");
requireContract(/UNIQUE \(order_id, sequence\)/.test(b4), "deterministic order sequence missing");
requireContract(/p_expected_seq/.test(b4) && /40001/.test(b4), "optimistic sequence guard missing");
requireContract(/a\.kind = 'remove'/.test(b4), "remove-then-adjust terminal guard missing");
requireContract(/v_target\.stock_status[\s\S]*'out_of_stock'/.test(b4), "out-of-stock substitutes must be rejected");
requireContract(/unit_type IN \('each', 'box'\)[\s\S]*trunc\(v_new_quantity\)/.test(b4), "count amendments must leave whole quantities");
requireContract(/inventory_policy <> 'kg_batch'/.test(b4), "A2 untracked_manual isolation regressed");
requireContract(/amendment_seq/.test(b4) && /v_depletion_seq IS DISTINCT FROM v_frozen_seq/.test(b4), "collection version freeze missing");
requireContract(/get_effective_order_lines_v18\(p_order_id, v_frozen_seq\)/.test(b4), "depletion/tender must consume frozen fold");
requireContract(/order_inventory_line_depletions/.test(b4) && /is_weight_tracked/.test(b4), "zero-allocation tracked lines need a durable refund cap");
requireContract(/request_fingerprint/.test(b4) && /different details/.test(b4), "amendment replay must reject changed payloads");
requireContract(/get_effective_order_lines_v18\(v_order\.id, NULL\)/.test(publicRead), "customer status must consume SQL fold");
requireContract(/get_effective_order_lines_v18/.test(orders) && !/order_items\s*\(/.test(orders), "manager reads must use SQL fold, not nested snapshots");

requireContract(!/createOwnerAlert/.test(action), "refund alert must not be a fragile post-commit server action");
requireContract(/resolveBranchScopedAccess\("manager"/.test(action), "refund server action manager gate missing");

if (failures.length) {
  console.error("V18 order-correction guard failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("V18 order-correction contracts verified.");

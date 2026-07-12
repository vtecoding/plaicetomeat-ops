// PTM-OBS-004 regression — an oversell shortfall must raise an owner_alert.
//
// Proves that when a collected order depletes more stock than is on hand, the
// resulting shortfall (order_inventory_depletions.completed_with_shortfall) raises
// an unresolved 'warning' owner_alert (kind inventory_shortfall) that the owner
// actually sees — closing the silent-failure gap — while never producing negative
// stock. Also proves the controlled state machine still works.
//
// Run: node scripts/verify-shortfall-owner-alert.mjs   (local Supabase up + seeded)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BRANCH = "00000000-0000-4000-8000-000000000001";
const CHICKEN_CATEGORY = "00000000-0000-4000-8000-000000000101";
const MANAGER_EMAIL = "manager@ptm.test";
const MANAGER_PASSWORD = "PlaiceTest123!";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE in .env.local");
  process.exit(2);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const uniq = () => Math.random().toString(36).slice(2, 10);
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? "  ::  " + detail : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  ::  " + detail : ""}`); }
}

async function main() {
  const manager = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signErr } = await manager.auth.signInWithPassword({ email: MANAGER_EMAIL, password: MANAGER_PASSWORD });
  if (signErr) throw new Error(`manager sign-in failed: ${signErr.message}`);

  // Product + a deliberately SMALL batch (2kg on hand).
  const productId = crypto.randomUUID();
  const slug = `shortfall-${uniq()}`;
  await admin.from("products").insert({
    id: productId, branch_id: BRANCH, category_id: CHICKEN_CATEGORY, name: `Shortfall ${slug}`,
    slug, unit_type: "kg", price_per_unit: 10, is_available: true, stock_status: "in_stock",
  });
  const batchId = crypto.randomUUID();
  const today = new Date();
  await admin.from("inventory_batches").insert({
    id: batchId, branch_id: BRANCH, product_id: productId,
    received_date: today.toISOString().slice(0, 10),
    expiry_date: new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10),
    received_weight_kg: 2, remaining_weight_kg: 2, cost_per_kg: 4,
  });

  // Order for 5kg (more than the 2kg on hand) → oversell on collect.
  const orderId = crypto.randomUUID();
  const { data: refData } = await admin.rpc("next_order_ref", { target_branch_id: BRANCH, target_date: today.toISOString().slice(0, 10) });
  await admin.from("orders").insert({
    id: orderId, branch_id: BRANCH, order_ref: String(refData ?? `SF-${uniq()}`),
    status: "incoming", pickup_date: today.toISOString().slice(0, 10), subtotal: 50,
    idempotency_key: `shortfall-${uniq()}`, idempotency_fingerprint: `shortfall-${uniq()}`, is_test: true,
  });
  await admin.from("order_items").insert({
    branch_id: BRANCH, order_id: orderId, product_id: productId,
    product_name_snapshot: "Shortfall probe", quantity: 5, unit_type: "kg", unit_price_snapshot: 10, line_total: 50,
  });

  // Collect through the controlled state machine (fires depletion + the shortfall trigger).
  for (const next of ["prepping", "ready", "collected"]) {
    const { error } = await manager.rpc("transition_order_status", { p_order_id: orderId, p_next_status: next, p_note: "shortfall probe" });
    if (error) throw new Error(`transition ${next}: ${error.message}`);
  }

  const { data: dep } = await admin.from("order_inventory_depletions").select("status,shortfall_kg").eq("order_id", orderId).maybeSingle();
  check("depletion recorded a shortfall", dep?.status === "completed_with_shortfall" && Number(dep?.shortfall_kg) === 3, `status=${dep?.status} shortfall=${dep?.shortfall_kg}`);

  const { data: batch } = await admin.from("inventory_batches").select("remaining_weight_kg").eq("id", batchId).single();
  check("no negative stock (floored at 0)", Number(batch.remaining_weight_kg) === 0, `remaining=${batch.remaining_weight_kg}`);

  const { data: alerts } = await admin
    .from("owner_alerts")
    .select("id,severity,kind,summary,resolved_at")
    .eq("branch_id", BRANCH)
    .eq("kind", "inventory_shortfall")
    .eq("entity_ref", `order:${orderId}`)
    .is("resolved_at", null);
  check("shortfall raises an unresolved owner_alert", (alerts?.length ?? 0) === 1, `count=${alerts?.length ?? 0}`);
  check("owner_alert is a 'warning'", alerts?.[0]?.severity === "warning", `severity=${alerts?.[0]?.severity}`);
  check("owner_alert summary is plain-English + names the shortfall", /short/i.test(alerts?.[0]?.summary ?? ""), alerts?.[0]?.summary ?? "");

  // cleanup
  await admin.from("owner_alerts").delete().eq("entity_ref", `order:${orderId}`);
  await admin.from("orders").delete().eq("id", orderId);
  await admin.from("inventory_batches").delete().eq("id", batchId);
  await admin.from("products").delete().eq("id", productId);

  console.log("");
  console.log(`Shortfall owner-alert guard: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });

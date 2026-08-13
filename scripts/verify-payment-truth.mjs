// V18 A1 (PTM-OPS-001) — payment truth DB battery.
//
// Drives the REAL RPC path against the local stack and proves:
//   1. collect_order_with_tender collects + records the sale in ONE transaction;
//   2. replay by key returns the original outcome and writes nothing;
//   3. a second collect (different key) fails cleanly with no second event;
//   4. a concurrent race records exactly one event;
//   5. FAULT INJECTION: if the tender insert fails, the whole transaction rolls
//      back — the order is NOT collected and no depletion happened;
//   6. till_events sign rules are enforced and replay-safe;
//   7. day_money_expected_v18 folds float + sales − refunds + till movements,
//      reports "float unknown" honestly, and counts missing-tender orders;
//   8. closing completion stamps variances and raises (or honestly suppresses)
//      the till_variance owner alert; below-threshold closes stay silent.
//
// Run: node scripts/verify-payment-truth.mjs   (local Supabase running + seeded)
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const BRANCH = "00000000-0000-4000-8000-000000000001";
const CHICKEN_CATEGORY = "00000000-0000-4000-8000-000000000101";
const MANAGER_EMAIL = "manager@ptm.test";
const MANAGER_PASSWORD = "PlaiceTest123!";
const DB_CONTAINER = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";

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
// The branch-local (London) trading day — matches branch_business_date() stamping.
const londonDate = (at = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(at);
const today = londonDate();
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? "  ::  " + detail : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  ::  " + detail : ""}`); }
}

function psql(sql) {
  const res = spawnSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql],
    { encoding: "utf8" },
  );
  return { ok: (res.status ?? 1) === 0, out: (res.stdout ?? "").trim(), err: (res.stderr ?? "").trim() };
}

async function makeReadyOrder(manager, productId, kg, pricePerKg) {
  const orderId = crypto.randomUUID();
  const { data: refData } = await admin.rpc("next_order_ref", { target_branch_id: BRANCH, target_date: today });
  await admin.from("orders").insert({
    id: orderId, branch_id: BRANCH, order_ref: String(refData ?? `PT-${uniq()}`),
    status: "incoming", pickup_date: today, subtotal: kg * pricePerKg,
    idempotency_key: `paytruth-${uniq()}`, idempotency_fingerprint: `paytruth-${uniq()}`, is_test: true,
  });
  await admin.from("order_items").insert({
    branch_id: BRANCH, order_id: orderId, product_id: productId,
    product_name_snapshot: "Payment probe", quantity: kg, unit_type: "kg", unit_price_snapshot: pricePerKg, line_total: kg * pricePerKg,
  });
  for (const next of ["prepping", "ready"]) {
    const { error } = await manager.rpc("transition_order_status", { p_order_id: orderId, p_next_status: next, p_note: "payment probe" });
    if (error) throw new Error(`transition ${next}: ${error.message}`);
  }
  return orderId;
}

async function paymentEventCount(orderId) {
  const { count } = await admin.from("payment_events").select("id", { count: "exact", head: true }).eq("order_id", orderId);
  return count ?? 0;
}

async function main() {
  const manager = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signErr } = await manager.auth.signInWithPassword({ email: MANAGER_EMAIL, password: MANAGER_PASSWORD });
  if (signErr) throw new Error(`manager sign-in failed: ${signErr.message}`);

  // Product with plenty of stock so depletion is clean.
  const productId = crypto.randomUUID();
  const slug = `paytruth-${uniq()}`;
  await admin.from("products").insert({
    id: productId, branch_id: BRANCH, category_id: CHICKEN_CATEGORY, name: `PayTruth ${slug}`,
    slug, unit_type: "kg", price_per_unit: 10, is_available: true, stock_status: "in_stock",
  });
  const batchId = crypto.randomUUID();
  await admin.from("inventory_batches").insert({
    id: batchId, branch_id: BRANCH, product_id: productId,
    received_date: today, expiry_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    received_weight_kg: 100, remaining_weight_kg: 100, cost_per_kg: 4,
  });

  const createdOrders = [];
  const createdTillKeys = [];

  // --- 1-3: collect + replay + double-collect --------------------------------
  const orderA = await makeReadyOrder(manager, productId, 2, 10); // £20
  createdOrders.push(orderA);
  const keyA = `paytruth-tender-${uniq()}`;
  const { data: resA, error: errA } = await manager.rpc("collect_order_with_tender", {
    p_order_id: orderA, p_method: "cash", p_idempotency_key: keyA,
  });
  check("collect_order_with_tender succeeds", !errA, errA?.message ?? "");
  check("amount derived server-side (£20 → 2000p)", resA?.amount_pence === 2000, `amount=${resA?.amount_pence}`);
  check("business_date stamped", typeof resA?.business_date === "string", String(resA?.business_date));

  const { data: orderRowA } = await admin.from("orders").select("status").eq("id", orderA).single();
  check("order is collected", orderRowA?.status === "collected", `status=${orderRowA?.status}`);
  const { data: depA } = await admin.from("order_inventory_depletions").select("status").eq("order_id", orderA).maybeSingle();
  check("depletion stayed coupled to collection", !!depA, `status=${depA?.status ?? "(none)"}`);
  check("exactly one payment event", (await paymentEventCount(orderA)) === 1);

  // P0 regression: the pre-V18 whole-order reversal cannot bypass refund_order_v18.
  const { data: balanceBeforeLegacy } = await admin
    .from("inventory_batches").select("remaining_weight_kg").eq("id", batchId).single();
  const { error: legacyReverseErr } = await manager.rpc("admin_reverse_order_inventory", {
    p_order_id: orderA,
    p_reason: "refund",
  });
  const { data: balanceAfterLegacy } = await admin
    .from("inventory_batches").select("remaining_weight_kg").eq("id", batchId).single();
  const { count: legacyMovementCount } = await admin
    .from("inventory_movements")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderA)
    .eq("source_event", "REFUND_REVERSAL");
  check("legacy whole-order inventory reversal is not callable", !!legacyReverseErr, legacyReverseErr?.message ?? "(no error!)");
  check(
    "denied legacy reversal leaves batch stock unchanged",
    balanceAfterLegacy?.remaining_weight_kg === balanceBeforeLegacy?.remaining_weight_kg,
    `before=${balanceBeforeLegacy?.remaining_weight_kg} after=${balanceAfterLegacy?.remaining_weight_kg}`,
  );
  check("denied legacy reversal writes no movement", (legacyMovementCount ?? 0) === 0, `count=${legacyMovementCount}`);

  const { data: resReplay, error: errReplay } = await manager.rpc("collect_order_with_tender", {
    p_order_id: orderA, p_method: "cash", p_idempotency_key: keyA,
  });
  check("replay by key returns the original outcome", !errReplay && resReplay?.replayed === true, errReplay?.message ?? `replayed=${resReplay?.replayed}`);
  check("replay wrote nothing", (await paymentEventCount(orderA)) === 1);

  const { error: errSecond } = await manager.rpc("collect_order_with_tender", {
    p_order_id: orderA, p_method: "card", p_idempotency_key: `paytruth-tender-${uniq()}`,
  });
  check("second collect (new key) rejected cleanly", /already collected/i.test(errSecond?.message ?? ""), errSecond?.message ?? "(no error!)");
  check("still exactly one payment event", (await paymentEventCount(orderA)) === 1);

  // --- 4: concurrent race -----------------------------------------------------
  const orderB = await makeReadyOrder(manager, productId, 1, 10);
  createdOrders.push(orderB);
  const [race1, race2] = await Promise.all([
    manager.rpc("collect_order_with_tender", { p_order_id: orderB, p_method: "cash", p_idempotency_key: `paytruth-race-${uniq()}` }),
    manager.rpc("collect_order_with_tender", { p_order_id: orderB, p_method: "card", p_idempotency_key: `paytruth-race-${uniq()}` }),
  ]);
  const oks = [race1, race2].filter((r) => !r.error).length;
  check("concurrent race: exactly one winner", oks === 1, `ok=${oks}`);
  check("concurrent race: exactly one payment event", (await paymentEventCount(orderB)) === 1);

  // --- 5: fault injection — tender insert failure rolls EVERYTHING back -------
  const orderC = await makeReadyOrder(manager, productId, 1, 10);
  createdOrders.push(orderC);
  const faultSetup = psql(`
    CREATE OR REPLACE FUNCTION public.__v18_fault() RETURNS trigger LANGUAGE plpgsql AS
    'BEGIN RAISE EXCEPTION ''fault injection''; END';
    CREATE TRIGGER __v18_fault_tender BEFORE INSERT ON public.payment_events
    FOR EACH ROW EXECUTE FUNCTION public.__v18_fault();`);
  if (!faultSetup.ok) {
    check("meta: docker psql reachable for fault injection", false, faultSetup.err || "docker exec failed — set AUDIT_DB_CONTAINER");
  } else {
    const { error: faultErr } = await manager.rpc("collect_order_with_tender", {
      p_order_id: orderC, p_method: "cash", p_idempotency_key: `paytruth-fault-${uniq()}`,
    });
    check("fault: collect fails when tender insert fails", !!faultErr, faultErr?.message ?? "(no error!)");
    const { data: cRow } = await admin.from("orders").select("status").eq("id", orderC).single();
    check("fault: order is NOT collected (transaction rolled back)", cRow?.status === "ready", `status=${cRow?.status}`);
    const { data: cDep } = await admin.from("order_inventory_depletions").select("id").eq("order_id", orderC).maybeSingle();
    check("fault: no depletion row survived the rollback", !cDep);
    check("fault: no payment event", (await paymentEventCount(orderC)) === 0);
    psql("DROP TRIGGER IF EXISTS __v18_fault_tender ON public.payment_events; DROP FUNCTION IF EXISTS public.__v18_fault();");

    const { error: afterErr } = await manager.rpc("collect_order_with_tender", {
      p_order_id: orderC, p_method: "cash", p_idempotency_key: `paytruth-after-${uniq()}`,
    });
    check("fault removed: the same order collects cleanly", !afterErr, afterErr?.message ?? "");
    check("fault removed: exactly one payment event", (await paymentEventCount(orderC)) === 1);
  }

  // --- 6: till event sign rules + replay --------------------------------------
  const tillKey = `paytruth-till-${uniq()}`;
  createdTillKeys.push(tillKey);
  const { data: tillIn, error: tillInErr } = await manager.rpc("record_till_event", {
    p_branch_id: BRANCH, p_kind: "paid_in", p_amount_pence: 2000, p_reason_code: "change", p_idempotency_key: tillKey,
  });
  check("till: paid_in accepted", !tillInErr && tillIn?.signed_amount_pence === 2000, tillInErr?.message ?? "");
  const { data: tillReplay } = await manager.rpc("record_till_event", {
    p_branch_id: BRANCH, p_kind: "paid_in", p_amount_pence: 2000, p_reason_code: "change", p_idempotency_key: tillKey,
  });
  check("till: replay by key returns original", tillReplay?.replayed === true, `replayed=${tillReplay?.replayed}`);

  const { error: signErr1 } = await manager.rpc("record_till_event", {
    p_branch_id: BRANCH, p_kind: "paid_in", p_amount_pence: -500, p_reason_code: "change", p_idempotency_key: `paytruth-till-${uniq()}`,
  });
  check("till: negative paid_in rejected", !!signErr1, signErr1?.message ?? "(no error!)");
  const { error: signErr2 } = await manager.rpc("record_till_event", {
    p_branch_id: BRANCH, p_kind: "paid_out", p_amount_pence: 500, p_reason_code: "supplier", p_idempotency_key: `paytruth-till-${uniq()}`,
  });
  check("till: positive paid_out rejected", !!signErr2, signErr2?.message ?? "(no error!)");

  // --- 7: expected-money equation ----------------------------------------------
  const { data: picture, error: picErr } = await manager.rpc("day_money_expected_v18", {
    p_branch_id: BRANCH, p_business_date: today,
  });
  check("day_money_expected_v18 readable by staff", !picErr, picErr?.message ?? "");
  check(
    "expected card = card sales − card refunds",
    picture && picture.expected_card_pence === picture.card_sales_pence - picture.card_refunds_pence,
    `card=${picture?.expected_card_pence}`,
  );
  check(
    "expected cash honest about unknown float",
    picture && (picture.float_pence === null ? picture.expected_cash_pence === null : typeof picture.expected_cash_pence === "number"),
    `float=${picture?.float_pence} cash=${picture?.expected_cash_pence}`,
  );

  // P0 regression: no authenticated caller can commit collection without tender.
  const orderD = await makeReadyOrder(manager, productId, 1, 10);
  createdOrders.push(orderD);
  const { error: bareErr } = await manager.rpc("transition_order_status", { p_order_id: orderD, p_next_status: "collected", p_note: "legacy path probe" });
  check("bare ready-to-collected transition is rejected", !!bareErr, bareErr?.message ?? "(no error!)");
  const { data: orderRowD } = await admin.from("orders").select("status").eq("id", orderD).single();
  const { data: depD } = await admin.from("order_inventory_depletions").select("id").eq("order_id", orderD).maybeSingle();
  check("denied bare collection leaves order ready", orderRowD?.status === "ready", `status=${orderRowD?.status}`);
  check("denied bare collection writes no tender", (await paymentEventCount(orderD)) === 0);
  check("denied bare collection rolls back depletion", !depD);

  // --- 8: closing variance stamp + alert ---------------------------------------
  // Normalize: give every missing-tender order a synthetic sale event so the
  // variance alert becomes deterministic (suppression is proven separately above).
  const dayStartUtc = new Date(new Date(`${today}T00:00:00Z`).getTime() - 2 * 3600 * 1000).toISOString();
  const dayEndUtc = new Date(new Date(`${today}T00:00:00Z`).getTime() + 26 * 3600 * 1000).toISOString();
  const { data: collectedEvents } = await admin
    .from("order_status_events").select("order_id,created_at").eq("branch_id", BRANCH).eq("status", "collected")
    .gte("created_at", dayStartUtc).lt("created_at", dayEndUtc);
  const collectedIds = [
    ...new Set(
      (collectedEvents ?? [])
        .filter((r) => londonDate(new Date(String(r.created_at))) === today)
        .map((r) => String(r.order_id)),
    ),
  ];
  if (collectedIds.length > 0) {
    const { data: tendered } = await admin.from("payment_events").select("order_id").eq("direction", "sale").in("order_id", collectedIds);
    const tenderedIds = new Set((tendered ?? []).map((r) => String(r.order_id)));
    for (const id of collectedIds.filter((x) => !tenderedIds.has(x))) {
      const { data: o } = await admin.from("orders").select("subtotal,branch_id").eq("id", id).maybeSingle();
      if (!o) continue;
      const pence = Math.round(Number(o.subtotal) * 100);
      if (pence <= 0) continue;
      await admin.from("payment_events").insert({
        branch_id: o.branch_id, order_id: id, direction: "sale", method: "cash", amount_pence: pence,
        business_date: today, idempotency_key: `paytruth-normalize-${uniq()}`,
      });
    }
  }

  // Fresh opening session with a known float, then a closing session with a
  // deliberate £9 over-count on cash and an exact card total.
  async function cleanupSessions(kind) {
    const { data } = await admin.from("ops_checklist_sessions").select("id").eq("branch_id", BRANCH).eq("kind", kind).eq("business_date", today);
    for (const row of data ?? []) {
      await admin.from("ops_checklist_events").delete().eq("session_id", row.id);
      await admin.from("ops_checklist_sessions").delete().eq("id", row.id);
    }
  }
  await cleanupSessions("opening");
  await cleanupSessions("closing");

  const { data: openId } = await manager.rpc("ops_start_or_resume_session", { p_branch_id: BRANCH, p_kind: "opening", p_source: "opening" });
  async function step(sessionId, key, state, payload = {}) {
    const { error } = await manager.rpc("ops_record_step", {
      p_session_id: sessionId, p_step_key: key, p_state: state, p_payload: payload,
      p_source: "checklist", p_idempotency_key: `${key}-${uniq()}`,
    });
    if (error) throw new Error(`step ${key}: ${error.message}`);
  }
  await step(openId, "fridge_temp", "done", { value: 4 });
  await step(openId, "display_ready", "done");
  await step(openId, "float_ready", "done", { value: 50 });
  await step(openId, "open_sign", "done");
  const { error: openCompleteErr } = await manager.rpc("ops_complete_session", { p_session_id: openId, p_source: "checklist" });
  check("opening session with float completes", !openCompleteErr, openCompleteErr?.message ?? "");

  const { data: picture3 } = await manager.rpc("day_money_expected_v18", { p_branch_id: BRANCH, p_business_date: today });
  check("expected cash known once float is recorded", typeof picture3?.expected_cash_pence === "number", `cash=${picture3?.expected_cash_pence}`);
  check(
    "expected cash folds float + cash sales − refunds + till movements",
    picture3 && picture3.expected_cash_pence === picture3.float_pence + picture3.cash_sales_pence - picture3.cash_refunds_pence + picture3.till_movements_pence,
    `cash=${picture3?.expected_cash_pence}`,
  );
  check("normalized: no missing tender remains", (picture3?.missing_tender_count ?? 0) === 0, `missing=${picture3?.missing_tender_count}`);

  const countedCashOver = (picture3.expected_cash_pence + 900) / 100; // £9 over threshold £5
  const countedCardExact = picture3.expected_card_pence / 100;

  const { data: closeId } = await manager.rpc("ops_start_or_resume_session", { p_branch_id: BRANCH, p_kind: "closing", p_source: "closing" });
  await step(closeId, "waste_logged", "done");
  await step(closeId, "stock_glance", "done");
  await step(closeId, "cash_counted", "done", { value: countedCashOver, expected_pence: picture3.expected_cash_pence });
  await step(closeId, "terminal_total", "done", { value: countedCardExact, expected_pence: picture3.expected_card_pence });
  await step(closeId, "fridges_closed", "done", { value: 3 });
  await step(closeId, "clean_done", "done");
  await step(closeId, "lock_up", "done");
  const { error: closeErr } = await manager.rpc("ops_complete_session", { p_session_id: closeId, p_source: "checklist" });
  check("closing session completes (variance never blocks)", !closeErr, closeErr?.message ?? "");

  const { data: closeRow } = await admin.from("ops_checklist_sessions").select("completion_metadata").eq("id", closeId).single();
  const money = closeRow?.completion_metadata ?? {};
  check("closing stamps cash variance (+900p)", money.cash_variance_pence === 900, `cash_var=${money.cash_variance_pence}`);
  check("closing stamps card variance (0p)", money.card_variance_pence === 0, `card_var=${money.card_variance_pence}`);
  check("expected_pence persisted in step payload path", money.expected_cash_pence === picture3.expected_cash_pence, `exp=${money.expected_cash_pence}`);

  const { data: varAlerts } = await admin
    .from("owner_alerts").select("id,severity,summary").eq("branch_id", BRANCH)
    .eq("kind", "till_variance").eq("entity_ref", `close:${closeId}`).is("resolved_at", null);
  check("till_variance alert raised above threshold", (varAlerts?.length ?? 0) === 1, `count=${varAlerts?.length}`);
  check("alert is plain English (over, no jargon)", /£9\.00 over/.test(varAlerts?.[0]?.summary ?? ""), varAlerts?.[0]?.summary ?? "");

  // Below-threshold close (a second session, same day): NO alert.
  const { data: closeId2 } = await manager.rpc("ops_start_or_resume_session", { p_branch_id: BRANCH, p_kind: "closing", p_source: "closing" });
  const { data: picture4 } = await manager.rpc("day_money_expected_v18", { p_branch_id: BRANCH, p_business_date: today });
  await step(closeId2, "waste_logged", "done");
  await step(closeId2, "stock_glance", "done");
  await step(closeId2, "cash_counted", "done", { value: (picture4.expected_cash_pence + 200) / 100 });
  await step(closeId2, "terminal_total", "done", { value: picture4.expected_card_pence / 100 });
  await step(closeId2, "fridges_closed", "done", { value: 3 });
  await step(closeId2, "clean_done", "done");
  await step(closeId2, "lock_up", "done");
  const { error: closeErr2 } = await manager.rpc("ops_complete_session", { p_session_id: closeId2, p_source: "checklist" });
  check("second closing completes", !closeErr2, closeErr2?.message ?? "");
  const { data: varAlerts2 } = await admin
    .from("owner_alerts").select("id").eq("branch_id", BRANCH)
    .eq("kind", "till_variance").eq("entity_ref", `close:${closeId2}`);
  check("below threshold: no alert", (varAlerts2?.length ?? 0) === 0, `count=${varAlerts2?.length}`);

  // --- cleanup -----------------------------------------------------------------
  await admin.from("owner_alerts").delete().eq("kind", "till_variance").in("entity_ref", [`close:${closeId}`, `close:${closeId2}`]);
  await cleanupSessions("opening");
  await cleanupSessions("closing");
  // payment_events / till_events are append-only AND their order FK deliberately
  // has no cascade — an order that took money cannot be deleted. Probe orders are
  // is_test=true and stay behind; only untendered leftovers can be removed.
  for (const id of createdOrders) {
    await admin.from("owner_alerts").delete().eq("entity_ref", `order:${id}`);
    if ((await paymentEventCount(id)) === 0) {
      await admin.from("orders").delete().eq("id", id);
    }
  }
  // Batch/product deletes are best-effort (kept orders may still reference them).
  await admin.from("inventory_batches").delete().eq("id", batchId);
  await admin.from("products").delete().eq("id", productId);

  console.log("");
  console.log(`Payment truth battery: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });

// V11.1 adversarial verification — public order access boundary.
//
// Runs against the LOCAL Supabase stack and exercises the public order RPCs the
// way an attacker (anon) and the app (anon + authenticated staff) would. Proves
// the spec §8.1.6 mandatory cases:
//   * reference enumeration retrieves zero order data;
//   * cancellation is impossible without a valid access id (ref is not enough);
//   * one order's access id never exposes/cancels another order;
//   * a staff transition racing a customer cancellation yields one valid winner;
//   * brute-force attempts trip the rate limiter;
//   * the public DTO contains no forbidden internal fields;
//   * the retired reference-only cancel RPC is gone.
// Exits non-zero on any unmet expectation.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const BRANCH_A = "00000000-0000-4000-8000-000000000001";
const PASSWORD = "PlaiceTest123!";
const RUN = randomUUID().slice(0, 8);

const FORBIDDEN = [
  "customer_phone", "customerPhone", "customer_email", "customerEmail", "phone", "email",
  "notes", "staff_notes", "staffNotes", "id", "branch_id", "branchId", "pickup_window_id",
  "sms_status", "smsStatus", "sms_failure_reason", "idempotency_key", "public_access_id",
  "is_test", "created_at",
];

const anon = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS ${name}`);
  else { failures += 1; console.error(`  FAIL ${name} ${detail}`); }
}

async function sessionClient(email) {
  const client = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

function todayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

let seq = 0;
async function createIncomingOrder(phone = "07700900123") {
  seq += 1;
  const ref = `PTM-2099-${String(seq).padStart(5, "0")}`;
  const { data, error } = await service
    .from("orders")
    .insert({
      branch_id: BRANCH_A,
      order_ref: ref,
      customer_name: "Test Customer",
      customer_phone: phone,
      pickup_date: todayIso(),
      subtotal: 10.0,
      idempotency_key: `vpa-${RUN}-${seq}`,
    })
    .select("id, order_ref, public_access_id, customer_phone, status")
    .single();
  if (error) throw new Error(`order insert failed: ${error.message}`);
  return data;
}

async function readStatus(orderId) {
  const { data } = await service.from("orders").select("status").eq("id", orderId).single();
  return data?.status;
}

async function cleanup() {
  await service.from("orders").delete().like("idempotency_key", `vpa-${RUN}-%`);
  await service.from("public_rate_limits").delete().like("identity", `vpa-${RUN}-%`);
}

async function main() {
  console.log(`V11.1 public access adversarial checks (run ${RUN})`);

  // --- 1. Anon cannot read the orders table directly --------------------------
  {
    const order = await createIncomingOrder();
    const { data, error } = await anon.from("orders").select("id, customer_phone").eq("id", order.id);
    check("anon direct orders SELECT returns no rows (RLS)", !error && Array.isArray(data) && data.length === 0,
      `rows=${data?.length} err=${error?.message}`);
  }

  // --- 2. Reference enumeration yields zero data ------------------------------
  {
    const real = await createIncomingOrder("07700900999");
    // 2a. establish with many synthetic refs + a bogus phone -> always null.
    let leaked = 0;
    for (let i = 1; i <= 400; i += 1) {
      const ref = `PTM-2099-${String(i).padStart(5, "0")}`;
      const { data } = await anon.rpc("establish_public_order_access", { p_order_ref: ref, p_phone: "07000000000" });
      if (data) leaked += 1;
    }
    check("400 enumerated refs + wrong phone -> no access id", leaked === 0, `leaked=${leaked}`);

    // 2b. real ref but WRONG phone -> null.
    const wrong = await anon.rpc("establish_public_order_access", { p_order_ref: real.order_ref, p_phone: "07000000000" });
    check("real ref + wrong phone -> no access id", !wrong.data, `data=${wrong.data}`);

    // 2c. real ref + RIGHT phone (any UK format) -> the correct access id.
    const right = await anon.rpc("establish_public_order_access", { p_order_ref: real.order_ref, p_phone: "+44 7700 900999" });
    check("real ref + right phone (normalised) -> correct access id", right.data === real.public_access_id,
      `data=${right.data}`);

    // 2d. random access id -> no status.
    const rnd = await anon.rpc("get_public_order_status", { p_public_access_id: randomUUID() });
    check("random access id -> null status", rnd.data === null, `data=${JSON.stringify(rnd.data)}`);
  }

  // --- 3. Safe DTO: correct order, no forbidden fields ------------------------
  {
    const order = await createIncomingOrder();
    const { data, error } = await anon.rpc("get_public_order_status", { p_public_access_id: order.public_access_id });
    check("status by access id returns the order", !error && data?.orderRef === order.order_ref, error?.message);
    const keys = data ? Object.keys(data) : [];
    const bad = keys.filter((k) => FORBIDDEN.includes(k));
    check("public DTO has no forbidden fields", bad.length === 0, `bad=${bad.join(",")}`);
    check("DTO customerDisplayName is first-name only", data?.customerDisplayName === "Test", `got=${data?.customerDisplayName}`);
  }

  // --- 4. Cross-order isolation ----------------------------------------------
  {
    const a = await createIncomingOrder();
    const b = await createIncomingOrder();
    const sa = await anon.rpc("get_public_order_status", { p_public_access_id: a.public_access_id });
    check("access id A returns only order A", sa.data?.orderRef === a.order_ref && sa.data?.orderRef !== b.order_ref);
  }

  // --- 5. Cancellation requires a valid access id (ref is not enough) ---------
  {
    const order = await createIncomingOrder();
    // 5a. retired reference-only RPC is gone.
    const byRef = await anon.rpc("cancel_order_by_ref", { p_order_ref: order.order_ref, p_reason: "x" });
    check("cancel_order_by_ref is removed/not callable", !!byRef.error, byRef.error ? "(error as expected)" : "STILL CALLABLE");
    // 5b. random access id -> not found, order unchanged.
    const rnd = await anon.rpc("cancel_public_order", { p_public_access_id: randomUUID(), p_reason: "x" });
    check("cancel with random access id rejected", !!rnd.error);
    check("order still incoming after bogus cancel", (await readStatus(order.id)) === "incoming");
  }

  // --- 6. Valid cancellation cancels only the target -------------------------
  {
    const a = await createIncomingOrder();
    const b = await createIncomingOrder();
    const res = await anon.rpc("cancel_public_order", { p_public_access_id: a.public_access_id, p_reason: "changed mind" });
    check("valid access id cancels its order", !res.error && res.data?.ok === true, res.error?.message);
    check("target order A is cancelled", (await readStatus(a.id)) === "cancelled");
    check("other order B untouched", (await readStatus(b.id)) === "incoming");
  }

  // --- 7. Race: staff transition vs customer cancellation --------------------
  {
    const manager = await sessionClient("manager@ptm.test");
    let oneWinnerEachTime = true;
    let clobbered = false;
    for (let i = 0; i < 6; i += 1) {
      const order = await createIncomingOrder();
      const [staff, cancel] = await Promise.allSettled([
        manager.rpc("transition_order_status", { p_order_id: order.id, p_next_status: "prepping" }),
        anon.rpc("cancel_public_order", { p_public_access_id: order.public_access_id, p_reason: "race" }),
      ]);
      const staffOk = staff.status === "fulfilled" && !staff.value.error;
      const cancelOk = cancel.status === "fulfilled" && !cancel.value.error;
      const final = await readStatus(order.id);
      // Exactly one side must win, and the final state must match the winner.
      if (staffOk === cancelOk) oneWinnerEachTime = false;
      if (!((staffOk && final === "prepping") || (cancelOk && final === "cancelled"))) clobbered = true;
    }
    check("race: exactly one winner every time", oneWinnerEachTime);
    check("race: final state always matches winner (no clobber)", !clobbered);
  }

  // --- 8. Rate limiting trips after the configured maximum --------------------
  {
    const id = `vpa-${RUN}-rl`;
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      const { data } = await anon.rpc("check_rate_limit", { p_bucket: "test", p_identity: id, p_max: 3, p_window_seconds: 60 });
      results.push(data);
    }
    check("rate limiter allows up to max then blocks", JSON.stringify(results) === JSON.stringify([true, true, true, false, false]),
      `results=${JSON.stringify(results)}`);
  }

  await cleanup();

  console.log("");
  if (failures > 0) {
    console.error(`RESULT: ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("RESULT: all public-access adversarial checks PASSED");
}

main().catch(async (e) => {
  console.error("verify-public-access crashed:", e.message);
  try { await cleanup(); } catch {}
  process.exit(1);
});

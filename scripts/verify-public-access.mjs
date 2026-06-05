// V11.1 adversarial verification — public order access boundary (sealed).
//
// Runs against the LOCAL Supabase stack as an attacker (anon) and as the trusted
// server (service_role, simulating the privileged module that runs AFTER session
// verification). Proves spec §8.1.6 plus the V11.1 sealing requirements:
//   * reference enumeration / anon mutation is impossible;
//   * cancel_public_order with a VALID access id but no session (anon) fails and
//     leaves the order unchanged;
//   * public_access_revoked_at and public_access_version are enforced;
//   * unknown-reference and wrong-phone establishment are indistinguishable;
//   * the safe DTO leaks no internal fields; cross-order isolation holds;
//   * a staff transition racing a cancellation yields one valid winner;
//   * rate limiting trips after the configured maximum.
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
    .select("id, order_ref, public_access_id, public_access_version, customer_phone, status")
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
  console.log(`V11.1 sealed public-access adversarial checks (run ${RUN})`);

  // --- 1. Anon cannot read the orders table directly --------------------------
  {
    const order = await createIncomingOrder();
    const { data, error } = await anon.from("orders").select("id, customer_phone").eq("id", order.id);
    check("anon direct orders SELECT returns no rows (RLS)", !error && Array.isArray(data) && data.length === 0,
      `rows=${data?.length} err=${error?.message}`);
  }

  // --- 2. Anon cannot invoke the mutation/establishment RPCs at all -----------
  {
    const order = await createIncomingOrder();
    const est = await anon.rpc("establish_public_order_access", { p_order_ref: order.order_ref, p_phone: order.customer_phone });
    check("anon establish_public_order_access is DENIED", !!est.error, est.error ? "(permission error)" : "CALLABLE!");

    // The key sealing test: a VALID access id with NO session (anon) cannot cancel.
    const can = await anon.rpc("cancel_public_order", { p_public_access_id: order.public_access_id, p_reason: "x", p_expected_version: order.public_access_version });
    check("anon cancel_public_order with VALID access id is DENIED", !!can.error, can.error ? "(permission error)" : "CALLABLE!");
    check("order unchanged after anon cancel attempt", (await readStatus(order.id)) === "incoming");

    // Status reads remain anon (the unguessable id is the credential).
    const rnd = await anon.rpc("get_public_order_status", { p_public_access_id: randomUUID() });
    check("anon status by random access id -> null", !rnd.error && rnd.data === null, `data=${JSON.stringify(rnd.data)} err=${rnd.error?.message}`);

    // The legacy reference-keyed reader must be gone (it leaked customer_name).
    const legacy = await anon.rpc("get_public_order", { target_order_ref: order.order_ref });
    check("legacy get_public_order(ref) is removed/uncallable by anon", !!legacy.error, legacy.error ? "(gone)" : "STILL LEAKS!");
  }

  // --- 3. Establishment correctness + unknown/wrong indistinguishable (server) -
  {
    const real = await createIncomingOrder("07700900999");
    const right = await service.rpc("establish_public_order_access", { p_order_ref: real.order_ref, p_phone: "+44 7700 900999" });
    check("server establish: real ref + right phone -> id+version",
      !right.error && right.data?.publicAccessId === real.public_access_id && right.data?.version === real.public_access_version,
      `data=${JSON.stringify(right.data)}`);

    const wrongPhone = await service.rpc("establish_public_order_access", { p_order_ref: real.order_ref, p_phone: "07000000000" });
    const unknownRef = await service.rpc("establish_public_order_access", { p_order_ref: "PTM-2099-99999", p_phone: "07700900999" });
    check("unknown-ref and wrong-phone establish results are identical (null)",
      wrongPhone.data === null && unknownRef.data === null && JSON.stringify(wrongPhone.data) === JSON.stringify(unknownRef.data),
      `wrongPhone=${JSON.stringify(wrongPhone.data)} unknownRef=${JSON.stringify(unknownRef.data)}`);
  }

  // --- 4. Safe DTO: correct order, no forbidden fields ------------------------
  {
    const order = await createIncomingOrder();
    const { data, error } = await anon.rpc("get_public_order_status", { p_public_access_id: order.public_access_id });
    check("status by access id returns the order", !error && data?.orderRef === order.order_ref, error?.message);
    const bad = (data ? Object.keys(data) : []).filter((k) => FORBIDDEN.includes(k));
    check("public DTO has no forbidden fields", bad.length === 0, `bad=${bad.join(",")}`);
    check("DTO customerDisplayName is first-name only", data?.customerDisplayName === "Test", `got=${data?.customerDisplayName}`);
  }

  // --- 5. Cross-order isolation ----------------------------------------------
  {
    const a = await createIncomingOrder();
    const b = await createIncomingOrder();
    const sa = await anon.rpc("get_public_order_status", { p_public_access_id: a.public_access_id });
    check("access id A returns only order A", sa.data?.orderRef === a.order_ref && sa.data?.orderRef !== b.order_ref);
  }

  // --- 6. Valid cancellation (server, correct version) cancels only target ----
  {
    const a = await createIncomingOrder();
    const b = await createIncomingOrder();
    const res = await service.rpc("cancel_public_order", { p_public_access_id: a.public_access_id, p_reason: "changed mind", p_expected_version: a.public_access_version });
    check("server cancel (correct version) cancels its order", !res.error && res.data?.ok === true, res.error?.message);
    check("target order A is cancelled", (await readStatus(a.id)) === "cancelled");
    check("other order B untouched", (await readStatus(b.id)) === "incoming");
  }

  // --- 7. public_access_version enforced --------------------------------------
  {
    const order = await createIncomingOrder();
    const wrongVer = await service.rpc("cancel_public_order", { p_public_access_id: order.public_access_id, p_reason: "x", p_expected_version: 999 });
    check("cancel with wrong expected_version is rejected", !!wrongVer.error, wrongVer.error ? "(rejected)" : "ACCEPTED!");
    check("order unchanged after version mismatch", (await readStatus(order.id)) === "incoming");
    const rightVer = await service.rpc("cancel_public_order", { p_public_access_id: order.public_access_id, p_reason: "x", p_expected_version: order.public_access_version });
    check("cancel with correct expected_version succeeds", !rightVer.error && rightVer.data?.ok === true, rightVer.error?.message);
  }

  // --- 8. public_access_revoked_at enforced on all paths ----------------------
  {
    const order = await createIncomingOrder("07700900777");
    await service.from("orders").update({ public_access_revoked_at: new Date().toISOString() }).eq("id", order.id);

    const status = await anon.rpc("get_public_order_status", { p_public_access_id: order.public_access_id });
    check("revoked: status returns null", !status.error && status.data === null, `data=${JSON.stringify(status.data)}`);

    const est = await service.rpc("establish_public_order_access", { p_order_ref: order.order_ref, p_phone: "07700900777" });
    check("revoked: establish returns null", est.data === null, `data=${JSON.stringify(est.data)}`);

    const can = await service.rpc("cancel_public_order", { p_public_access_id: order.public_access_id, p_reason: "x", p_expected_version: order.public_access_version });
    check("revoked: cancel is rejected (not found)", !!can.error, can.error ? "(rejected)" : "ACCEPTED!");
    check("revoked: order unchanged", (await readStatus(order.id)) === "incoming");
  }

  // --- 9. Race: staff transition vs customer cancellation --------------------
  {
    const manager = await sessionClient("manager@ptm.test");
    let oneWinnerEachTime = true;
    let clobbered = false;
    for (let i = 0; i < 6; i += 1) {
      const order = await createIncomingOrder();
      const [staff, cancel] = await Promise.allSettled([
        manager.rpc("transition_order_status", { p_order_id: order.id, p_next_status: "prepping" }),
        service.rpc("cancel_public_order", { p_public_access_id: order.public_access_id, p_reason: "race", p_expected_version: order.public_access_version }),
      ]);
      const staffOk = staff.status === "fulfilled" && !staff.value.error;
      const cancelOk = cancel.status === "fulfilled" && !cancel.value.error;
      const final = await readStatus(order.id);
      if (staffOk === cancelOk) oneWinnerEachTime = false;
      if (!((staffOk && final === "prepping") || (cancelOk && final === "cancelled"))) clobbered = true;
    }
    check("race: exactly one winner every time", oneWinnerEachTime);
    check("race: final state always matches winner (no clobber)", !clobbered);
  }

  // --- 10. Rate limiting trips after the configured maximum -------------------
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
  console.log("RESULT: all sealed public-access adversarial checks PASSED");
}

main().catch(async (e) => {
  console.error("verify-public-access crashed:", e.message);
  try { await cleanup(); } catch {}
  process.exit(1);
});

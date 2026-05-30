// Server-side rule verification for the counter ops path. Runs against the
// LOCAL Supabase stack and exercises the transition / note RPCs the way the
// app does (authenticated user sessions, RLS enforced). Exits non-zero on any
// unmet expectation.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const BRANCH_A = "00000000-0000-4000-8000-000000000001";
const PW = "00000000-0000-4000-8000-000000000302";
const PASSWORD = "PlaiceTest123!";

const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name} ${detail}`);
  }
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

async function makeOrder(status, key) {
  await service.from("orders").delete().eq("idempotency_key", key);
  const { data, error } = await service
    .from("orders")
    .insert({
      branch_id: BRANCH_A,
      order_ref: `PTM-2026-9${Math.floor(Math.random() * 90000 + 10000)}`,
      customer_name: "Verify Bot",
      customer_phone: "+447700900999",
      status,
      pickup_window_id: PW,
      pickup_date: todayIso(),
      subtotal: 9.99,
      idempotency_key: key,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function main() {
  const staffA = await sessionClient("staff@ptm.test");
  const staffB = await sessionClient("staff.b@ptm.test");
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });

  const orderReady = await makeOrder("ready", "verify-ready");
  const orderIncoming = await makeOrder("incoming", "verify-incoming");

  // 1. Invalid transition rejected (ready -> incoming).
  {
    const { error } = await staffA.rpc("transition_order_status", {
      p_order_id: orderReady,
      p_next_status: "incoming",
      p_note: null,
    });
    check("invalid transition rejected", !!error && /Invalid transition/.test(error.message), error?.message);
  }

  // 2. Unknown status rejected.
  {
    const { error } = await staffA.rpc("transition_order_status", {
      p_order_id: orderReady,
      p_next_status: "banana",
      p_note: null,
    });
    check("unknown status rejected", !!error, error?.message);
  }

  // 3. Cross-branch mutation rejected for branch-B staff (RLS hides the row).
  {
    const { error } = await staffB.rpc("transition_order_status", {
      p_order_id: orderIncoming,
      p_next_status: "prepping",
      p_note: null,
    });
    check("cross-branch mutation rejected", !!error, error?.message);
  }

  // 4. Unauthenticated mutation rejected.
  {
    const { error } = await anon.rpc("transition_order_status", {
      p_order_id: orderIncoming,
      p_next_status: "prepping",
      p_note: null,
    });
    check("unauthenticated mutation rejected", !!error, error?.message);
  }

  // 5. Valid transition succeeds AND writes event + audit rows.
  {
    const { error } = await staffA.rpc("transition_order_status", {
      p_order_id: orderReady,
      p_next_status: "collected",
      p_note: "Picked up.",
    });
    check("valid transition succeeds", !error, error?.message);

    const { count: eventCount } = await service
      .from("order_status_events")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderReady)
      .eq("status", "collected");
    check("order_status_events row written", (eventCount ?? 0) >= 1, `count=${eventCount}`);

    const { count: auditCount } = await service
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("target_id", orderReady)
      .eq("event_type", "order_status_changed");
    check("audit_logs row written", (auditCount ?? 0) >= 1, `count=${auditCount}`);
  }

  // 6. Note validation.
  {
    const empty = await staffA.rpc("add_order_note", { p_order_id: orderIncoming, p_note: "   " });
    check("empty note rejected", !!empty.error && /empty/i.test(empty.error.message), empty.error?.message);

    const long = await staffA.rpc("add_order_note", { p_order_id: orderIncoming, p_note: "x".repeat(1001) });
    check("overlong note rejected", !!long.error && /too long/i.test(long.error.message), long.error?.message);

    const unauth = await anon.rpc("add_order_note", { p_order_id: orderIncoming, p_note: "hi" });
    check("unauthenticated note rejected", !!unauth.error, unauth.error?.message);

    const ok = await staffA.rpc("add_order_note", { p_order_id: orderIncoming, p_note: "valid note" });
    check("valid note accepted", !ok.error, ok.error?.message);
  }

  // Cleanup.
  await service.from("orders").delete().in("idempotency_key", ["verify-ready", "verify-incoming"]);

  console.log(failures === 0 ? "\nALL OPS CHECKS PASSED" : `\n${failures} OPS CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-ops crashed:", error.message ?? error);
  process.exit(1);
});

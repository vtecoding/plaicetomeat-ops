// Phase 1 / F8 (T5) - Required compliance readings cannot be silently skipped.
//
// Drives the REAL authenticated ops-capture RPC path as a branch manager and
// proves: an opening checklist with the fridge temperature SKIPPED cannot be
// completed, but completing it after a valid reading succeeds.
//
// Run: node scripts/verify-required-compliance.mjs   (local Supabase running + seeded)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BRANCH = "00000000-0000-4000-8000-000000000001";
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

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? "  ::  " + detail : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? "  ::  " + detail : ""}`);
  }
};

const today = new Date().toISOString().slice(0, 10);

async function cleanupSession(kind) {
  const { data } = await admin
    .from("ops_checklist_sessions")
    .select("id")
    .eq("branch_id", BRANCH)
    .eq("kind", kind)
    .eq("business_date", today);
  for (const row of data ?? []) {
    await admin.from("ops_checklist_events").delete().eq("session_id", row.id);
    await admin.from("ops_checklist_sessions").delete().eq("id", row.id);
  }
}
const cleanupOpeningSession = () => cleanupSession("opening");

async function main() {
  const mgr = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signErr } = await mgr.auth.signInWithPassword({ email: MANAGER_EMAIL, password: MANAGER_PASSWORD });
  if (signErr) throw new Error(`manager sign-in failed: ${signErr.message}`);

  await cleanupOpeningSession();

  const { data: sessionId, error: startErr } = await mgr.rpc("ops_start_or_resume_session", {
    p_branch_id: BRANCH,
    p_kind: "opening",
    p_source: "opening",
  });
  if (startErr) throw new Error(`start failed: ${startErr.message}`);

  async function step(stepKey, state, value) {
    const payload = value == null ? {} : { value };
    const { error } = await mgr.rpc("ops_record_step", {
      p_session_id: sessionId,
      p_step_key: stepKey,
      p_state: state,
      p_payload: payload,
      p_source: "checklist",
      p_idempotency_key: `${stepKey}-${state}-${Math.random().toString(36).slice(2)}`,
    });
    return error;
  }

  // Complete every required step EXCEPT the fridge temperature, which we skip.
  await step("certs_visible", "done");
  await step("display_ready", "done");
  await step("open_sign", "done");
  await step("float_ready", "done", 100);
  const skipErr = await step("fridge_temp", "skipped");
  check("a required temperature step can be recorded as skipped", !skipErr, skipErr?.message ?? "");

  // With the temperature skipped, completion must be rejected.
  let { error: completeErr } = await mgr.rpc("ops_complete_session", { p_session_id: sessionId, p_source: "checklist" });
  check("completion BLOCKED while fridge temperature is skipped", !!completeErr, completeErr?.message ?? "(no error!)");

  // Session must still be in_progress (not falsely completed).
  let { data: s1 } = await admin.from("ops_checklist_sessions").select("status").eq("id", sessionId).single();
  check("session is not falsely completed", s1.status === "in_progress", `status=${s1.status}`);

  // Out-of-range value still rejected at record time.
  const oorErr = await step("fridge_temp", "done", 99);
  check("out-of-range temperature still rejected", !!oorErr, oorErr?.message ?? "(no error!)");

  // Now enter a real, in-range reading and complete.
  const goodErr = await step("fridge_temp", "done", 4);
  check("valid temperature reading accepted", !goodErr, goodErr?.message ?? "");

  ({ error: completeErr } = await mgr.rpc("ops_complete_session", { p_session_id: sessionId, p_source: "checklist" }));
  check("completion SUCCEEDS once temperature is recorded", !completeErr, completeErr?.message ?? "");

  let { data: s2 } = await admin.from("ops_checklist_sessions").select("status").eq("id", sessionId).single();
  check("session is completed after valid reading", s2.status === "completed", `status=${s2.status}`);

  await cleanupOpeningSession();

  // V18 A1: the closing money readings are required numerics too — the card
  // machine total (terminal_total) cannot be silently skipped.
  await cleanupSession("closing");
  const { data: closeId, error: closeStartErr } = await mgr.rpc("ops_start_or_resume_session", {
    p_branch_id: BRANCH,
    p_kind: "closing",
    p_source: "closing",
  });
  if (closeStartErr) throw new Error(`closing start failed: ${closeStartErr.message}`);

  async function closeStep(stepKey, state, value) {
    const payload = value == null ? {} : { value };
    const { error } = await mgr.rpc("ops_record_step", {
      p_session_id: closeId,
      p_step_key: stepKey,
      p_state: state,
      p_payload: payload,
      p_source: "checklist",
      p_idempotency_key: `${stepKey}-${state}-${Math.random().toString(36).slice(2)}`,
    });
    return error;
  }

  await closeStep("waste_logged", "done");
  await closeStep("stock_glance", "done");
  await closeStep("cash_counted", "done", 120);
  await closeStep("fridges_closed", "done", 3);
  await closeStep("clean_done", "done");
  await closeStep("lock_up", "done");
  const termSkipErr = await closeStep("terminal_total", "skipped");
  check("card machine total can be recorded as skipped", !termSkipErr, termSkipErr?.message ?? "");

  let { error: closeCompleteErr } = await mgr.rpc("ops_complete_session", { p_session_id: closeId, p_source: "checklist" });
  check("closing BLOCKED while card machine total is skipped", !!closeCompleteErr, closeCompleteErr?.message ?? "(no error!)");

  const termDoneErr = await closeStep("terminal_total", "done", 85);
  check("card machine total accepted", !termDoneErr, termDoneErr?.message ?? "");

  ({ error: closeCompleteErr } = await mgr.rpc("ops_complete_session", { p_session_id: closeId, p_source: "checklist" }));
  check("closing completes once card machine total is recorded", !closeCompleteErr, closeCompleteErr?.message ?? "");

  await admin.from("owner_alerts").delete().eq("kind", "till_variance").eq("entity_ref", `close:${closeId}`);
  await cleanupSession("closing");

  console.log("");
  console.log(`Required-compliance guard: ${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

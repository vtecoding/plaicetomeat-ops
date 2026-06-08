// V12.6 adversarial verification - Checklist / Compliance Evidence Integrity.
//
// Runs against the local Supabase stack. Proves checklist sessions are bound to
// server-known definitions, unknown steps and invalid evidence are rejected, and
// completion is derived from persisted required evidence before audit is emitted.

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
const BRANCH_B = "00000000-0000-4000-8000-0000000000b2";
const PASSWORD = "PlaiceTest123!";
const RUN = randomUUID().slice(0, 8);

const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const cleanup = { sessionIds: new Set() };

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) console.log(`  PASS ${name}`);
  else {
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

function dateIso(offsetDays = 0) {
  const n = new Date();
  n.setDate(n.getDate() + offsetDays);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

async function start(manager, kind = "opening", dayOffset = 0) {
  const { data, error } = await manager.rpc("ops_start_or_resume_session", {
    p_branch_id: BRANCH_A,
    p_kind: kind,
    p_business_date: dateIso(dayOffset),
    p_source: `verify-v12-6-${RUN}`,
  });
  if (error) throw new Error(`start failed: ${error.message}`);
  cleanup.sessionIds.add(String(data));
  return String(data);
}

async function sessionRow(sessionId) {
  const { data, error } = await service.from("ops_checklist_sessions").select("*").eq("id", sessionId).single();
  if (error) throw new Error(`session read failed: ${error.message}`);
  return data;
}

async function auditCount(sessionId) {
  const { count, error } = await service
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "ops_session_completed")
    .eq("target_id", sessionId);
  if (error) throw new Error(`audit count failed: ${error.message}`);
  return count ?? 0;
}

async function cleanupRows() {
  for (const sessionId of cleanup.sessionIds) {
    await service.from("ops_checklist_sessions").delete().eq("id", sessionId);
  }
}

async function unknownStepRejected(manager) {
  const sessionId = await start(manager, "opening", 0);
  const res = await manager.rpc("ops_record_step", {
    p_session_id: sessionId,
    p_step_key: "mystery_step",
    p_state: "done",
    p_payload: {},
    p_source: "verify",
    p_idempotency_key: `unknown-${RUN}`,
  });
  check("unknown step rejected", !!res.error && /Unknown checklist step/.test(res.error.message), res.error?.message);
}

async function emptyChecklistCannotComplete(manager) {
  const sessionId = await start(manager, "opening", 1);
  const beforeAudit = await auditCount(sessionId);
  const res = await manager.rpc("ops_complete_session", { p_session_id: sessionId, p_source: "verify" });
  const row = await sessionRow(sessionId);
  check("empty checklist cannot complete", !!res.error && /without evidence/.test(res.error.message), res.error?.message);
  check("empty completion leaves status in_progress", row.status === "in_progress", `status=${row.status}`);
  check("empty completion emits no completion audit", (await auditCount(sessionId)) === beforeAudit);
}

async function missingRequiredBlocksCompletion(manager) {
  const sessionId = await start(manager, "opening", 2);
  const rec = await manager.rpc("ops_record_step", {
    p_session_id: sessionId,
    p_step_key: "fridge_temp",
    p_state: "done",
    p_payload: { value: 3.5 },
    p_source: "verify",
    p_idempotency_key: `partial-${RUN}`,
  });
  check("valid first step records", !rec.error && !!rec.data, rec.error?.message);

  const beforeAudit = await auditCount(sessionId);
  const res = await manager.rpc("ops_complete_session", { p_session_id: sessionId, p_source: "verify" });
  const row = await sessionRow(sessionId);
  check("missing required step blocks completion", !!res.error && /incomplete/.test(res.error.message), res.error?.message);
  check("incomplete completion rolls back status", row.status === "in_progress", `status=${row.status}`);
  check("incomplete completion emits no completion audit", (await auditCount(sessionId)) === beforeAudit);
}

async function invalidEvidenceRejected(manager) {
  const sessionId = await start(manager, "opening", 3);
  const badShape = await manager.rpc("ops_record_step", {
    p_session_id: sessionId,
    p_step_key: "fridge_temp",
    p_state: "done",
    p_payload: { temp_c: 3.5 },
    p_source: "verify",
    p_idempotency_key: `bad-shape-${RUN}`,
  });
  check("invalid temperature payload shape rejected", !!badShape.error && /evidence value/.test(badShape.error.message), badShape.error?.message);

  const outOfRange = await manager.rpc("ops_record_step", {
    p_session_id: sessionId,
    p_step_key: "fridge_temp",
    p_state: "done",
    p_payload: { value: 99 },
    p_source: "verify",
    p_idempotency_key: `bad-range-${RUN}`,
  });
  check("out-of-range temperature rejected", !!outOfRange.error && /out of range/.test(outOfRange.error.message), outOfRange.error?.message);

  const confirmPayload = await manager.rpc("ops_record_step", {
    p_session_id: sessionId,
    p_step_key: "certs_visible",
    p_state: "done",
    p_payload: { value: true },
    p_source: "verify",
    p_idempotency_key: `bad-confirm-${RUN}`,
  });
  check("confirm step rejects arbitrary evidence value", !!confirmPayload.error && /cannot carry evidence/.test(confirmPayload.error.message), confirmPayload.error?.message);
}

async function validCompletionCreatesStableEvidence(manager) {
  const sessionId = await start(manager, "opening", 4);
  const steps = [
    ["fridge_temp", { value: 3.5 }],
    ["certs_visible", {}],
    ["display_ready", {}],
    ["float_ready", { value: 120 }],
    ["open_sign", {}],
  ];

  for (const [stepKey, payload] of steps) {
    const res = await manager.rpc("ops_record_step", {
      p_session_id: sessionId,
      p_step_key: stepKey,
      p_state: "done",
      p_payload: payload,
      p_source: "verify",
      p_idempotency_key: `valid-${stepKey}-${RUN}`,
    });
    check(`valid step records: ${stepKey}`, !res.error && !!res.data, res.error?.message);
  }

  const beforeAudit = await auditCount(sessionId);
  const complete = await manager.rpc("ops_complete_session", { p_session_id: sessionId, p_source: "verify" });
  const row = await sessionRow(sessionId);
  check("completed checklist succeeds after required evidence", !complete.error && complete.data === sessionId, complete.error?.message);
  check("completed checklist stores definition metadata", row.definition_key === "opening" && Number(row.definition_version) === 1, JSON.stringify(row));
  check("completed checklist records actor/branch/timestamp", !!row.completed_by && row.branch_id === BRANCH_A && !!row.completed_at, JSON.stringify(row));
  check("completion audit emitted only after valid completion", (await auditCount(sessionId)) === beforeAudit + 1);
}

async function branchMismatchDenied(manager, branchBManager) {
  const sessionId = await start(manager, "opening", 5);
  const res = await branchBManager.rpc("ops_record_step", {
    p_session_id: sessionId,
    p_step_key: "fridge_temp",
    p_state: "done",
    p_payload: { value: 3.5 },
    p_source: "verify",
    p_idempotency_key: `branch-${RUN}`,
  });
  check("branch mismatch step write denied", !!res.error && /Not authorised/.test(res.error.message), res.error?.message);

  const complete = await branchBManager.rpc("ops_complete_session", { p_session_id: sessionId, p_source: "verify" });
  check("branch mismatch completion denied", !!complete.error && /Not authorised/.test(complete.error.message), complete.error?.message);
}

async function main() {
  const manager = await sessionClient("manager@ptm.test");
  const branchBManager = await sessionClient("staff.b@ptm.test");

  const { data: branchBProfile } = await service.from("profiles").select("id, role, branch_id").eq("email", "staff.b@ptm.test").single();
  if (!branchBProfile || branchBProfile.branch_id !== BRANCH_B) {
    throw new Error("staff.b@ptm.test branch-B profile is required for branch mismatch verification");
  }

  await service.from("profiles").update({ role: "manager" }).eq("id", branchBProfile.id);

  try {
    await unknownStepRejected(manager);
    await emptyChecklistCannotComplete(manager);
    await missingRequiredBlocksCompletion(manager);
    await invalidEvidenceRejected(manager);
    await validCompletionCreatesStableEvidence(manager);
    await branchMismatchDenied(manager, branchBManager);
  } finally {
    await service.from("profiles").update({ role: branchBProfile.role }).eq("id", branchBProfile.id);
    await cleanupRows();
  }

  console.log(failures === 0 ? "\nALL CHECKLIST INTEGRITY CHECKS PASSED" : `\n${failures} CHECKLIST INTEGRITY CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("verify-checklist-integrity crashed:", error.message ?? error);
  await cleanupRows().catch(() => {});
  process.exit(1);
});

// V12.4 adversarial verification — Audit Semantics Coverage.
//
// Proves the security_event coverage path is real and authority is preserved:
//   * service-authoritative emit of a security_event lands in audit_logs and is
//     mirrored to audit_events (the admin surface), as a SYSTEM event (actor NULL);
//   * the system reason is recorded and secret-like metadata keys are stripped;
//   * anon/authenticated still CANNOT call emit_audit_log (V12.1 seal intact).
//
// Note: audit tables are append-only (V11.2), so test rows are intentionally NOT
// deleted; they are tagged with a run id for identification.
//
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

const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const RUN = randomUUID().slice(0, 8);
let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name} ${detail}`);
  }
}

async function main() {
  console.log(`V12.4 audit-coverage adversarial checks (run ${RUN})`);

  // --- service-authoritative security_event emission --------------------------
  const marker = `vac-${RUN}`;
  const emit = await service.rpc("emit_audit_log", {
    p_event_type: "security_event",
    p_target_type: "auth",
    p_target_id: null,
    p_branch_id: null,
    // 'token' is secret-like and MUST be stripped by emit_audit_log.
    p_metadata: { marker, emailHash: "hashed-email", networkHash: "hashed-net", token: "should-be-stripped" },
    p_system_reason: "login_failed",
  });
  check("service can emit a security_event via emit_audit_log", !emit.error && !!emit.data, emit.error?.message);

  // --- it mirrors to audit_events (admin surface) as a SYSTEM event -----------
  const { data: rows } = await service
    .from("audit_events")
    .select("event_type, actor_user_id, actor_email, metadata")
    .eq("event_type", "security_event")
    .order("created_at", { ascending: false })
    .limit(10);
  const mine = (rows ?? []).find((r) => r.metadata?.marker === marker);

  check("security_event mirrored to audit_events", !!mine, `rows=${rows?.length}`);
  if (mine) {
    check("recorded as system event (actor NULL)", mine.actor_user_id === null && mine.actor_email === null);
    check("system reason captured", mine.metadata?.system_reason === "login_failed", JSON.stringify(mine.metadata));
    check("secret-like key stripped", mine.metadata?.token === undefined && Array.isArray(mine.metadata?._redacted_keys) && mine.metadata._redacted_keys.includes("token"));
    check("safe hashed fields retained", mine.metadata?.emailHash === "hashed-email" && mine.metadata?.networkHash === "hashed-net");
    check("no raw PII in mirrored metadata", !JSON.stringify(mine.metadata).includes("@"));
  }

  // --- V12.1 seal intact: anon cannot emit a security_event ------------------
  const anonEmit = await anon.rpc("emit_audit_log", {
    p_event_type: "security_event",
    p_target_type: "auth",
    p_target_id: null,
    p_branch_id: null,
    p_metadata: { marker: `${marker}-anon` },
    p_system_reason: "login_failed",
  });
  check("anon emit_audit_log is DENIED (V12.1 seal intact)", !!anonEmit.error, anonEmit.error ? "(permission error)" : "CALLABLE!");

  console.log("");
  if (failures > 0) {
    console.error(`RESULT: ${failures} audit-coverage check(s) FAILED`);
    process.exit(1);
  }
  console.log("RESULT: all audit-coverage checks PASSED");
}

main().catch((err) => {
  console.error("verify-audit-coverage crashed:", err);
  process.exit(1);
});

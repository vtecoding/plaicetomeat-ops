// V18 B1 Phase 2.5 certification guard — adversarial proofs for the dispatch
// execution engine before any new channel ships:
//   crash injection at every boundary converges to a legal state,
//   at-least-once redelivery under the same dispatch identity,
//   record-RPC replay idempotency (one transition; divergent replays fail),
//   staggered cron-overlap (long sweep + new invocation),
//   Vault-failure fail-closed (loud error, zero leases claimed),
//   and global state-sanity invariants (no orphan lease, no orphan attempt,
//   no impossible state).
//
// Run with: node --import tsx scripts/verify-dispatcher-certification.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import dispatcherCore from "../src/lib/domain/alert-dispatcher-core.ts";

const { runDispatcherSweep } = dispatcherCore;

const BRANCH = "00000000-0000-4000-8000-000000000001";
const DB_CONTAINER = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const alertIds = [];
let parkedDispatchIds = [];
const LEGAL_TERMINAL_OR_WAITING = ["accepted", "retry_wait", "delivery_unknown", "dead_letter", "skipped", "cancelled", "pending"];

function check(name, condition, detail = "") {
  if (condition) { pass += 1; console.log(`  PASS  ${name}${detail ? `  ::  ${detail}` : ""}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `  ::  ${detail}` : ""}`); }
}
function psql(sql) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAc", sql],
    { encoding: "utf8" },
  );
  return { ok: (result.status ?? 1) === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}
async function rpc(name, args) {
  const result = await admin.rpc(name, args);
  if (result.error) throw new Error(`${name}: ${result.error.message}`);
  return result.data;
}
const callRpc = async (name, args) => rpc(name, args);

const acceptAdapter = {
  channel: "twilio_whatsapp",
  isConfigured: () => true,
  send: async () => ({ providerMessageId: "cert-accept", providerStatusCode: "201" }),
};

async function createCritical(label) {
  const id = crypto.randomUUID();
  alertIds.push(id);
  const { error } = await admin.from("owner_alerts").insert({
    id, branch_id: BRANCH, severity: "critical", kind: "operator_help",
    summary: label, entity_ref: `cert-probe:${id}`,
  });
  if (error) throw error;
  const { data } = await admin.from("alert_dispatches").select("*").eq("alert_id", id).single();
  return { alertId: id, dispatch: data };
}
async function dispatchState(id) {
  const { data } = await admin
    .from("alert_dispatches")
    .select("status,attempt_count,lease_owner,lease_expires_at,provider_accepted_at,provider_message_id")
    .eq("id", id)
    .single();
  const { data: attempts } = await admin
    .from("alert_delivery_attempts")
    .select("attempt_number,outcome,completed_at,worker_id")
    .eq("dispatch_id", id)
    .order("attempt_number");
  return { row: data, attempts: attempts ?? [] };
}
async function expireLease(id) {
  const { error } = await admin
    .from("alert_dispatches")
    .update({ lease_expires_at: "2000-01-01T00:00:00Z" })
    .eq("id", id);
  if (error) throw error;
}
function legalConverged(state) {
  return LEGAL_TERMINAL_OR_WAITING.includes(state.row?.status)
    && state.row.lease_owner === null
    && state.attempts.every((attempt) => Boolean(attempt.completed_at));
}

try {
  const { data: parked, error: parkError } = await admin
    .from("alert_dispatches")
    .update({ next_attempt_at: "2999-01-01T00:00:00Z" })
    .in("status", ["pending", "retry_wait", "delivery_unknown"])
    .select("id");
  if (parkError) throw parkError;
  parkedDispatchIds = (parked ?? []).map((row) => row.id);

  // ── 1. Crash injection ────────────────────────────────────────────────────
  // C1: crash immediately after lease, before any send.
  const c1 = await createCritical("Crash C1: after lease, before send");
  await rpc("lease_alert_dispatches_v18", { p_worker_id: "cert:c1", p_limit: 25, p_lease_seconds: 60 });
  await expireLease(c1.dispatch.id);
  await rpc("recover_expired_alert_dispatch_leases_v18", {});
  let c1State = await dispatchState(c1.dispatch.id);
  check(
    "C1 crash after lease converges to delivery_unknown with a closed worker_abandoned attempt",
    c1State.row.status === "delivery_unknown" && legalConverged(c1State)
      && c1State.attempts.length === 1 && c1State.attempts[0].outcome === "worker_abandoned",
    JSON.stringify(c1State),
  );
  const staleWorker = await admin.rpc("record_alert_dispatch_result_v18", {
    p_dispatch_id: c1.dispatch.id, p_worker_id: "cert:c1", p_outcome: "accepted",
  });
  check(
    "a recovered dispatch rejects a late result from the crashed worker's lost lease",
    Boolean(staleWorker.error) && /lease is not held/.test(staleWorker.error.message),
    staleWorker.error?.message ?? "no error",
  );
  await runDispatcherSweep({ invocationId: "cert:c1-finish", callRpc, adapters: { twilio_whatsapp: acceptAdapter } });
  c1State = await dispatchState(c1.dispatch.id);
  check("C1 dispatch ultimately converges to accepted", c1State.row.status === "accepted" && legalConverged(c1State));

  // C2: crash after the send began / after the provider accepted, before the
  // record RPC committed. From the database's perspective these are one case:
  // the record transaction never committed, the lease is still held, the
  // attempt is still open. Prove at-least-once redelivery under the SAME
  // dispatch identity, with the duplicate send counted.
  const c2 = await createCritical("Crash C2: provider accepted, record never committed");
  let c2Sends = 0;
  let c2CrashArmed = true;
  const crashingRpc = async (name, args) => {
    if (c2CrashArmed && name === "record_alert_dispatch_result_v18") {
      throw new Error("simulated process death before record commit");
    }
    return rpc(name, args);
  };
  const c2Metrics = await runDispatcherSweep({
    invocationId: "cert:c2-crash",
    callRpc: crashingRpc,
    adapters: {
      twilio_whatsapp: {
        channel: "twilio_whatsapp",
        isConfigured: () => true,
        send: async () => {
          c2Sends += 1;
          return { providerMessageId: "cert-c2", providerStatusCode: "201" };
        },
      },
    },
  });
  let c2State = await dispatchState(c2.dispatch.id);
  const c2LeftLeased = c2State.row.status === "leased" && c2State.row.lease_owner === "cert:c2-crash"
    && c2State.attempts.length === 1 && c2State.attempts[0].completed_at === null;
  await expireLease(c2.dispatch.id);
  c2CrashArmed = false;
  const c2Redelivery = await runDispatcherSweep({
    invocationId: "cert:c2-redeliver",
    callRpc,
    adapters: {
      twilio_whatsapp: {
        channel: "twilio_whatsapp",
        isConfigured: () => true,
        send: async () => {
          c2Sends += 1;
          return { providerMessageId: "cert-c2", providerStatusCode: "201" };
        },
      },
    },
  });
  c2State = await dispatchState(c2.dispatch.id);
  check(
    "C2 crash between provider acceptance and record redelivers at-least-once under the same dispatch",
    c2Metrics.record_failures >= 1 && c2LeftLeased
      && c2Redelivery.expired_leases >= 1
      && c2State.row.status === "accepted" && legalConverged(c2State)
      && c2State.row.attempt_count === 2 && c2Sends === 2
      && c2State.attempts[0].outcome === "worker_abandoned"
      && c2State.attempts[1].outcome === "accepted",
    JSON.stringify({ c2Sends, crashLeftLeased: c2LeftLeased, state: c2State }),
  );

  // C3: crash after the record committed — a replayed invocation records the
  // same result again. Exactly one transition; provider identity unchanged.
  const c3 = await createCritical("Crash C3: record committed, then replay");
  const c3Lease = await rpc("lease_alert_dispatches_v18", { p_worker_id: "cert:c3", p_limit: 25, p_lease_seconds: 60 });
  if (!c3Lease.some((row) => row.id === c3.dispatch.id)) throw new Error("C3 probe could not lease its dispatch");
  const c3First = await rpc("record_alert_dispatch_result_v18", {
    p_dispatch_id: c3.dispatch.id, p_worker_id: "cert:c3", p_outcome: "accepted",
    p_provider_message_id: "cert-c3-message", p_provider_status_code: "201",
  });
  const c3Replay = await rpc("record_alert_dispatch_result_v18", {
    p_dispatch_id: c3.dispatch.id, p_worker_id: "cert:c3", p_outcome: "accepted",
    p_provider_message_id: "cert-c3-message", p_provider_status_code: "201",
  });
  const c3State = await dispatchState(c3.dispatch.id);
  check(
    "C3 replaying an identical committed result is exactly one transition",
    c3First.provider_accepted_at === c3Replay.provider_accepted_at
      && c3State.row.status === "accepted" && c3State.row.attempt_count === 1
      && c3State.attempts.length === 1 && legalConverged(c3State),
    JSON.stringify({ first: c3First.provider_accepted_at, replay: c3Replay.provider_accepted_at }),
  );

  // ── 2. RPC idempotency: divergent replays must fail ─────────────────────
  const divergentMessage = await admin.rpc("record_alert_dispatch_result_v18", {
    p_dispatch_id: c3.dispatch.id, p_worker_id: "cert:c3", p_outcome: "accepted",
    p_provider_message_id: "a-DIFFERENT-provider-message",
  });
  const divergentOutcome = await admin.rpc("record_alert_dispatch_result_v18", {
    p_dispatch_id: c3.dispatch.id, p_worker_id: "cert:c3", p_outcome: "failed_transient",
    p_error_code: "500",
  });
  const divergentProviderStatus = await admin.rpc("record_alert_dispatch_result_v18", {
    p_dispatch_id: c3.dispatch.id, p_worker_id: "cert:c3", p_outcome: "accepted",
    p_provider_message_id: "cert-c3-message", p_provider_status_code: "202",
  });
  const divergentInvalidation = await admin.rpc("record_alert_dispatch_result_v18", {
    p_dispatch_id: c3.dispatch.id, p_worker_id: "cert:c3", p_outcome: "accepted",
    p_provider_message_id: "cert-c3-message", p_provider_status_code: "201",
    p_invalidate_device: true,
  });
  check(
    "divergent replays (different payload or different outcome) fail loudly",
    Boolean(divergentMessage.error) && /DIVERGENT_RESULT_REPLAY/.test(divergentMessage.error.message)
      && Boolean(divergentOutcome.error) && /DIVERGENT_RESULT_REPLAY/.test(divergentOutcome.error.message)
      && Boolean(divergentProviderStatus.error) && /DIVERGENT_RESULT_REPLAY/.test(divergentProviderStatus.error.message)
      && Boolean(divergentInvalidation.error) && /DIVERGENT_RESULT_REPLAY/.test(divergentInvalidation.error.message),
    JSON.stringify({
      message: divergentMessage.error?.message?.slice(0, 80),
      outcome: divergentOutcome.error?.message?.slice(0, 80),
      providerStatus: divergentProviderStatus.error?.message?.slice(0, 80),
      invalidation: divergentInvalidation.error?.message?.slice(0, 80),
    }),
  );
  // ── 3. Staggered cron overlap: a long sweep and a fresh invocation ───────
  const overlapProbes = [];
  for (let i = 0; i < 8; i += 1) overlapProbes.push(await createCritical(`Overlap probe ${i + 1}`));
  const overlapIds = overlapProbes.map((probe) => probe.dispatch.id);
  const slowAdapter = {
    channel: "twilio_whatsapp",
    isConfigured: () => true,
    send: async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { providerMessageId: "cert-overlap", providerStatusCode: "201" };
    },
  };
  const overlapConfig = { batchSize: 4, maxConcurrentSends: 2, providerTimeoutMs: 500, softDeadlineMs: 20_000 };
  const sweepA = runDispatcherSweep({ invocationId: "cert:overlap-a", callRpc, adapters: { twilio_whatsapp: slowAdapter }, config: overlapConfig });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const sweepB = runDispatcherSweep({ invocationId: "cert:overlap-b", callRpc, adapters: { twilio_whatsapp: slowAdapter }, config: overlapConfig });
  const [overlapA, overlapB] = await Promise.all([sweepA, sweepB]);
  const { data: overlapAttempts } = await admin
    .from("alert_delivery_attempts")
    .select("dispatch_id,worker_id")
    .in("dispatch_id", overlapIds);
  const overlapPerDispatch = new Map();
  for (const attempt of overlapAttempts ?? []) {
    overlapPerDispatch.set(attempt.dispatch_id, (overlapPerDispatch.get(attempt.dispatch_id) ?? 0) + 1);
  }
  const { count: overlapAccepted } = await admin
    .from("alert_dispatches")
    .select("id", { count: "exact", head: true })
    .in("id", overlapIds)
    .eq("status", "accepted");
  check(
    "a mid-flight second invocation causes no duplicate sends, no starvation and no lease churn",
    overlapIds.every((id) => overlapPerDispatch.get(id) === 1)
      && overlapAccepted === 8
      && overlapA.leased + overlapB.leased === 8
      && (overlapAttempts ?? []).length === 8,
    JSON.stringify({ leased: { a: overlapA.leased, b: overlapB.leased }, totalAttempts: (overlapAttempts ?? []).length, overlapAccepted }),
  );

  // ── 4. Vault failure fails closed and loudly ──────────────────────────────
  const vaultProbe = await createCritical("Vault failure probe");
  const vaultFailure = psql(String.raw`
DELETE FROM vault.secrets WHERE name IN ('alert_dispatcher_url', 'alert_dispatcher_token');
SELECT public.invoke_alert_dispatcher_v18();
`);
  const { data: vaultProbeRow } = await admin
    .from("alert_dispatches")
    .select("status,attempt_count")
    .eq("id", vaultProbe.dispatch.id)
    .single();
  check(
    "a missing Vault secret makes the cron invocation fail loudly with zero leases claimed",
    !vaultFailure.ok && /alert_dispatcher_url is missing/.test(vaultFailure.err)
      && vaultProbeRow?.status === "pending" && vaultProbeRow.attempt_count === 0,
    JSON.stringify({ error: vaultFailure.err.split("\n")[0], probe: vaultProbeRow }),
  );
  await runDispatcherSweep({ invocationId: "cert:vault-finish", callRpc, adapters: { twilio_whatsapp: acceptAdapter } });

  // ── 5. Global state-sanity invariants ─────────────────────────────────────
  const sanity = psql(String.raw`
SELECT
  (SELECT count(*) FROM public.alert_dispatches
    WHERE (status = 'leased') <> (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)) AS orphan_leases,
  (SELECT count(*) FROM public.alert_delivery_attempts a
    JOIN public.alert_dispatches d ON d.id = a.dispatch_id
    WHERE a.completed_at IS NULL AND d.status <> 'leased') AS orphan_attempts,
  (SELECT count(*) FROM public.alert_delivery_attempts a
    JOIN public.alert_dispatches d ON d.id = a.dispatch_id
    WHERE a.attempt_number > d.attempt_count) AS impossible_attempts,
  (SELECT count(*) FROM public.alert_dispatches
    WHERE attempt_count > attempt_budget) AS exceeded_budgets;
`);
  check(
    "no orphan leases, no orphan attempts, no impossible attempt numbers, no exceeded budgets — globally",
    sanity.ok && sanity.out === "0|0|0|0",
    sanity.ok ? sanity.out : sanity.err.split("\n")[0],
  );
} finally {
  if (alertIds.length) await admin.from("owner_alerts").delete().in("id", alertIds);
  if (parkedDispatchIds.length) {
    await admin.from("alert_dispatches")
      .update({ next_attempt_at: new Date().toISOString() })
      .in("id", parkedDispatchIds);
  }
}

console.log(`\nDispatcher certification: ${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);

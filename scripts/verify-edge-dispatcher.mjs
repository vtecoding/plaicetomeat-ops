// V18 B1 Phase 2 database guard — the Edge dispatcher sweep against the real
// Phase 1 outbox: health RPC, end-to-end lease→send→record, crash→lease
// recovery→redelivery, two concurrent invocations never processing the same
// dispatch, unsupported-channel skip, and the cron (un)schedule helpers.
//
// Run with: node --import tsx scripts/verify-edge-dispatcher.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import dispatcherCore from "../src/lib/domain/alert-dispatcher-core.ts";

const { runDispatcherSweep, CHANNEL_NOT_IMPLEMENTED } = dispatcherCore;

const BRANCH = "00000000-0000-4000-8000-000000000001";
const DB_CONTAINER = process.env.AUDIT_DB_CONTAINER ?? "supabase_db_plaicetomeat-ops";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const alertIds = [];
const directDispatchIds = [];
let parkedDispatchIds = [];

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
  send: async () => ({ providerMessageId: "stub-accept", providerStatusCode: "201" }),
};

async function createCritical(label) {
  const id = crypto.randomUUID();
  alertIds.push(id);
  const { error } = await admin.from("owner_alerts").insert({
    id, branch_id: BRANCH, severity: "critical", kind: "operator_help",
    summary: label, entity_ref: `edge-probe:${id}`,
  });
  if (error) throw error;
  const { data } = await admin.from("alert_dispatches").select("*").eq("alert_id", id).single();
  return { alertId: id, dispatch: data };
}

try {
  // Park any pre-existing eligible work so sweeps only see probe rows.
  const { data: parked, error: parkError } = await admin
    .from("alert_dispatches")
    .update({ next_attempt_at: "2999-01-01T00:00:00Z" })
    .in("status", ["pending", "retry_wait", "delivery_unknown"])
    .select("id");
  if (parkError) throw parkError;
  parkedDispatchIds = (parked ?? []).map((row) => row.id);

  // 1. Health RPC.
  const health = await rpc("alert_dispatcher_health_v18", {});
  check(
    "health RPC reports every dispatcher dependency present",
    health?.lease_rpc === true && health?.recovery_rpc === true
      && health?.record_rpc === true && health?.replay_rpc === true
      && Number(health?.registry_kinds) >= 30,
    JSON.stringify(health),
  );

  // 2. End-to-end sweep: lease → send → record → accepted.
  const single = await createCritical("Edge sweep end-to-end probe");
  const metrics = await runDispatcherSweep({
    invocationId: "edge:verify-e2e",
    callRpc,
    adapters: { twilio_whatsapp: acceptAdapter },
  });
  const { data: acceptedRow } = await admin
    .from("alert_dispatches")
    .select("status,provider_accepted_at,provider_message_id,lease_owner")
    .eq("id", single.dispatch.id)
    .single();
  const { data: e2eAttempt } = await admin
    .from("alert_delivery_attempts")
    .select("attempt_number,worker_id,outcome,completed_at")
    .eq("dispatch_id", single.dispatch.id)
    .single();
  check(
    "one sweep drives a pending dispatch to provider-accepted with a closed attempt",
    metrics.leased >= 1 && metrics.accepted >= 1 && metrics.processed >= 1
      && acceptedRow?.status === "accepted" && Boolean(acceptedRow.provider_accepted_at)
      && acceptedRow.provider_message_id === "stub-accept" && acceptedRow.lease_owner === null
      && e2eAttempt?.attempt_number === 1 && e2eAttempt.worker_id === "edge:verify-e2e"
      && e2eAttempt.outcome === "accepted" && Boolean(e2eAttempt.completed_at),
    JSON.stringify({ metrics: { leased: metrics.leased, accepted: metrics.accepted }, acceptedRow, e2eAttempt }),
  );
  check(
    "sweep metrics expose the budget",
    typeof metrics.duration_ms === "number" && typeof metrics.remaining_budget_ms === "number"
      && metrics.soft_deadline_hit === false && metrics.version?.startsWith("v18-b1"),
    JSON.stringify({ duration_ms: metrics.duration_ms, remaining_budget_ms: metrics.remaining_budget_ms, version: metrics.version }),
  );

  // 3. Crash → lease expiry → recovery → redelivery in one later sweep.
  const crashed = await createCritical("Edge crash-recovery probe");
  await rpc("lease_alert_dispatches_v18", { p_worker_id: "edge:verify-crashed", p_limit: 25, p_lease_seconds: 60 });
  const { data: leasedRow } = await admin
    .from("alert_dispatches").select("status,lease_owner").eq("id", crashed.dispatch.id).single();
  if (leasedRow?.status !== "leased") throw new Error(`crash probe expected leased, saw ${leasedRow?.status}`);
  const { error: expireError } = await admin
    .from("alert_dispatches")
    .update({ lease_expires_at: "2000-01-01T00:00:00Z" })
    .eq("id", crashed.dispatch.id);
  if (expireError) throw expireError;
  const recoveryMetrics = await runDispatcherSweep({
    invocationId: "edge:verify-recovery",
    callRpc,
    adapters: { twilio_whatsapp: acceptAdapter },
  });
  const { data: recoveredRow } = await admin
    .from("alert_dispatches").select("status,attempt_count").eq("id", crashed.dispatch.id).single();
  const { data: crashAttempts } = await admin
    .from("alert_delivery_attempts")
    .select("attempt_number,outcome")
    .eq("dispatch_id", crashed.dispatch.id)
    .order("attempt_number");
  check(
    "an abandoned lease is recovered and redelivered by the next sweep under the same dispatch",
    recoveryMetrics.expired_leases >= 1
      && recoveredRow?.status === "accepted" && recoveredRow.attempt_count === 2
      && crashAttempts?.length === 2
      && crashAttempts[0].outcome === "worker_abandoned" && crashAttempts[1].outcome === "accepted",
    JSON.stringify({ expired: recoveryMetrics.expired_leases, recoveredRow, crashAttempts }),
  );

  // 4. Two concurrent invocations never process the same dispatch.
  const contested = [];
  for (let i = 0; i < 6; i += 1) contested.push(await createCritical(`Edge concurrency probe ${i + 1}`));
  const slowAdapter = {
    channel: "twilio_whatsapp",
    isConfigured: () => true,
    send: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { providerMessageId: "stub-slow", providerStatusCode: "201" };
    },
  };
  const [left, right] = await Promise.all([
    runDispatcherSweep({
      invocationId: "edge:verify-left",
      callRpc,
      adapters: { twilio_whatsapp: slowAdapter },
      config: { batchSize: 3, maxConcurrentSends: 2 },
    }),
    runDispatcherSweep({
      invocationId: "edge:verify-right",
      callRpc,
      adapters: { twilio_whatsapp: slowAdapter },
      config: { batchSize: 3, maxConcurrentSends: 2 },
    }),
  ]);
  const contestedIds = contested.map((probe) => probe.dispatch.id);
  const { data: contestedAttempts } = await admin
    .from("alert_delivery_attempts")
    .select("dispatch_id,worker_id")
    .in("dispatch_id", contestedIds);
  const attemptsPerDispatch = new Map();
  for (const attempt of contestedAttempts ?? []) {
    const list = attemptsPerDispatch.get(attempt.dispatch_id) ?? [];
    list.push(attempt.worker_id);
    attemptsPerDispatch.set(attempt.dispatch_id, list);
  }
  const everyExactlyOnce = contestedIds.every((id) => (attemptsPerDispatch.get(id) ?? []).length === 1);
  const { count: contestedAccepted } = await admin
    .from("alert_dispatches")
    .select("id", { count: "exact", head: true })
    .in("id", contestedIds)
    .eq("status", "accepted");
  check(
    "two concurrent sweeps split the queue with no dispatch processed twice",
    everyExactlyOnce && contestedAccepted === 6 && left.leased + right.leased === 6,
    JSON.stringify({
      perDispatch: [...attemptsPerDispatch.values()],
      leased: { left: left.leased, right: right.leased },
      contestedAccepted,
    }),
  );

  // 5. Channels without a shipped adapter are skipped terminally-visibly.
  const unsupportedKey = `edge-probe-unsupported:${crypto.randomUUID()}`;
  const { data: pushDispatch, error: pushError } = await admin.from("alert_dispatches").insert({
    branch_id: BRANCH, kind: "daily_digest", channel: "fcm", target: "", status: "pending",
    dispatch_key: unsupportedKey, payload: { message: "unsupported-channel probe" },
    next_attempt_at: new Date().toISOString(), priority: 10,
  }).select("id").single();
  if (pushError) throw pushError;
  directDispatchIds.push(pushDispatch.id);
  await runDispatcherSweep({
    invocationId: "edge:verify-unsupported",
    callRpc,
    adapters: { twilio_whatsapp: acceptAdapter },
  });
  const { data: skippedRow } = await admin
    .from("alert_dispatches").select("status,last_error_code").eq("id", pushDispatch.id).single();
  check(
    "a channel without an adapter is skipped as CHANNEL_NOT_IMPLEMENTED (a replay candidate), never dead-lettered",
    skippedRow?.status === "skipped" && skippedRow.last_error_code === CHANNEL_NOT_IMPLEMENTED,
    JSON.stringify(skippedRow),
  );

  // 6. Cron helpers: fail closed without Vault secrets, then round-trip.
  const missingSecrets = psql("SELECT public.schedule_alert_dispatcher_v18();");
  check(
    "scheduling fails closed while the Vault secrets are missing",
    !missingSecrets.ok && /alert_dispatcher_url/.test(missingSecrets.err),
    missingSecrets.ok ? missingSecrets.out : missingSecrets.err.split("\n")[0],
  );
  const roundTrip = psql(String.raw`
SELECT vault.create_secret('http://127.0.0.1:54321/functions/v1/alert-dispatcher', 'alert_dispatcher_url');
SELECT vault.create_secret('verify-edge-dispatcher-token', 'alert_dispatcher_token');
SELECT public.schedule_alert_dispatcher_v18('30 seconds');
SELECT jobname || '|' || schedule || '|' || active FROM cron.job WHERE jobname = 'ptm-alert-dispatcher';
SELECT public.unschedule_alert_dispatcher_v18();
SELECT count(*) FROM cron.job WHERE jobname = 'ptm-alert-dispatcher';
DELETE FROM vault.secrets WHERE name IN ('alert_dispatcher_url', 'alert_dispatcher_token');
`);
  check(
    "cron schedule/unschedule round-trip registers and removes the 30-second job",
    roundTrip.ok
      && /ptm-alert-dispatcher\|30 seconds\|t/.test(roundTrip.out)
      && roundTrip.out.split(/\r?\n/).includes("0"),
    roundTrip.ok ? roundTrip.out.replace(/\r?\n/g, " / ") : roundTrip.err.split("\n")[0],
  );
} finally {
  if (directDispatchIds.length) await admin.from("alert_dispatches").delete().in("id", directDispatchIds);
  if (alertIds.length) await admin.from("owner_alerts").delete().in("id", alertIds);
  if (parkedDispatchIds.length) {
    await admin.from("alert_dispatches")
      .update({ next_attempt_at: new Date().toISOString() })
      .in("id", parkedDispatchIds);
  }
}

console.log(`\nEdge-dispatcher guard: ${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);

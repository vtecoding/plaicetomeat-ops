// V18 B1/B7 scheduled worker: scan certificate expiry, enqueue due daily
// digests, then lease and deliver a bounded outbox sweep.
import { existsSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import alertDispatch from "../src/lib/domain/alert-dispatch.ts";
import ownerAlertChannel from "../src/lib/domain/owner-alert-channel.ts";
import ownerDigest from "../src/lib/domain/owner-digest.ts";

const {
  boundDispatchBatch,
  fieldProofSucceeded,
  mergeAlertBranchSchedules,
  processClaimedAlertDispatches,
} = alertDispatch;
const {
  CHANNEL_DISABLED,
  OwnerAlertProviderError,
  localBusinessClock,
  ownerAlertChannelConfigured,
  ownerDigestInputFromSnapshot,
  resolveOwnerAlertChannel,
  sendOwnerAlertViaTwilio,
} = ownerAlertChannel;
const { buildOwnerDigest } = ownerDigest;

if (existsSync(new URL("../.env.local", import.meta.url))) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    if (!(key in process.env)) process.env[key] = line.slice(index + 1).trim();
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const supabase = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const channel = resolveOwnerAlertChannel(process.env);
let workerSchedules = [];

async function callRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function enqueueDueDigests(now = new Date()) {
  await callRpc("scan_not_opened_by_time_v18", { p_now: now.toISOString() });
  const { data: branches, error: branchError } = await supabase
    .from("branches")
    .select("id,timezone");
  if (branchError) throw new Error(`load branches for certificate scan: ${branchError.message}`);
  const { data: settings, error } = await supabase
    .from("branch_operator_settings")
    .select("branch_id,summary_time,owner_contact");
  if (error) throw new Error(`load digest settings: ${error.message}`);
  let enqueued = 0;

  workerSchedules = mergeAlertBranchSchedules(branches ?? [], settings ?? []);
  for (const schedule of workerSchedules) {
    const clock = localBusinessClock(now, schedule.timezone);
    await callRpc("scan_branch_certificate_expiry_alerts_v18", {
      p_branch_id: schedule.branchId,
      p_as_of: clock.businessDate,
    });
    const [hour = "19", minute = "00"] = schedule.summaryTime.split(":");
    const dueMinute = Number(hour) * 60 + Number(minute);
    if (clock.minuteOfDay < dueMinute) continue;

    const snapshot = await callRpc("owner_digest_snapshot_v18", {
      p_branch_id: schedule.branchId,
      p_business_date: clock.businessDate,
    });
    const message = buildOwnerDigest(ownerDigestInputFromSnapshot(snapshot));
    await callRpc("enqueue_owner_digest_dispatch_v18", {
      p_branch_id: schedule.branchId,
      p_business_date: clock.businessDate,
      p_target: schedule.ownerContact,
      p_payload: { message, business_date: clock.businessDate },
      p_provider_idempotency_key: null,
    });
    enqueued += 1;
  }
  return enqueued;
}

async function sweep() {
  await callRpc("finalize_ambiguous_alert_dispatches_v18", {});
  const rows = (await callRpc("claim_alert_dispatches_v18", {
    p_limit: boundDispatchBatch(Number(process.env.ALERT_DISPATCH_BATCH_SIZE ?? 10)),
  })) ?? [];
  return processClaimedAlertDispatches({
    rows,
    channelConfigured: ownerAlertChannelConfigured(channel),
    disabledReason: CHANNEL_DISABLED,
    begin: (dispatchId) => callRpc("begin_alert_dispatch_attempt_v18", { p_dispatch_id: dispatchId }).then(() => undefined),
    send: async (row) => {
      const message = typeof row.payload?.message === "string" ? row.payload.message : "";
      return sendOwnerAlertViaTwilio({
        config: channel,
        target: row.target,
        message: row.kind === "critical_alert" ? `Urgent from PlaiceToMeat\n${message}` : message,
        providerIdempotencyKey: row.provider_idempotency_key,
      });
    },
    record: (dispatchId, result) => callRpc("record_alert_dispatch_result_v18", {
      p_dispatch_id: dispatchId,
      p_status: result.status,
      p_last_error: result.lastError,
      p_provider_response: result.providerResponse,
      p_retryable: result.retryable,
      p_ambiguous: result.ambiguous,
    }).then(() => undefined),
    classifySendError: (error) => {
      const providerError = error instanceof OwnerAlertProviderError ? error : null;
      return {
        message: error instanceof Error ? error.message : "Provider send failed",
        retryable: providerError?.retryable ?? false,
        ambiguous: providerError?.ambiguous ?? true,
      };
    },
    onSkipped: (row) => console.warn(`OWNER_ALERT_DISPATCH_SKIPPED id=${row.id} reason=${CHANNEL_DISABLED}`),
    onFailed: (row, message) => console.error(`OWNER_ALERT_DISPATCH_FAILED id=${row.id} error=${message}`),
  });
}

async function recordWorkerHeartbeat(lastRunOk, totals, error = null) {
  if (workerSchedules.length === 0) return;
  const checkedAt = new Date().toISOString();
  const { error: heartbeatError } = await supabase.from("owner_alert_worker_status").upsert(
    workerSchedules.map((schedule) => ({
      branch_id: schedule.branchId,
      checked_at: checkedAt,
      channel_configured: ownerAlertChannelConfigured(channel),
      target_configured: Boolean(schedule.ownerContact.trim()),
      last_run_ok: lastRunOk,
      last_error: error == null ? null : String(error).slice(0, 1000),
      last_totals: totals ?? {},
      updated_at: checkedAt,
    })),
    { onConflict: "branch_id" },
  );
  if (heartbeatError) throw new Error(`record owner-alert worker heartbeat: ${heartbeatError.message}`);
}

try {
  const digests = await enqueueDueDigests();
  const totals = await sweep();
  await recordWorkerHeartbeat(true, totals);
  console.log(JSON.stringify({ digestCandidates: digests, ...totals }));

  if (process.env.OWNER_ALERT_FIELD_PROOF === "true" && !fieldProofSucceeded(totals)) {
    throw new Error(
      `Field proof requested but only ${totals.sent} of ${totals.claimed} claimed owner alerts were confirmed sent.`,
    );
  }
} catch (error) {
  try {
    await recordWorkerHeartbeat(false, null, error instanceof Error ? error.message : "Worker failed");
  } catch (heartbeatError) {
    console.error(heartbeatError);
  }
  throw error;
}

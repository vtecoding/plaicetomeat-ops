// V18 B1 Phase 2 — Edge Function dispatcher.
//
// Invoked by Supabase Cron every 30 seconds (and optionally by a pg_net
// database webhook as a fast path). Each invocation is one stateless sweep:
// recover expired leases → lease bounded batches → send with bounded
// concurrency → record outcomes → return metrics. All business rules live in
// the Phase 1 SQL RPCs and the shared domain modules; this file only wires
// the Deno runtime (auth, Supabase client, provider timeout, logging).
//
// Security: service-token only. The caller must present the service role key
// (or ALERT_DISPATCHER_TOKEN when set) as a Bearer token; anon and browser
// callers are rejected. verify_jwt stays off in config.toml because the token
// check here is stricter than "any valid project JWT".
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

import {
  DEFAULT_DISPATCHER_CONFIG,
  DISPATCHER_VERSION,
  runDispatcherSweep,
  type DispatchChannelAdapter,
} from "../../../src/lib/domain/alert-dispatcher-core.ts";
import type { LeasedAlertDispatch } from "../../../src/lib/domain/alert-dispatch.ts";
import {
  ownerAlertChannelConfigured,
  resolveOwnerAlertChannel,
  sendOwnerAlertViaTwilio,
} from "../../../src/lib/domain/owner-alert-channel.ts";
import { decryptNotificationSecret } from "../../../src/lib/notifications/secret-box.ts";
import {
  createWebPushChannelAdapter,
  resolveWebPushConfig,
  webPushConfigured,
} from "../../../src/lib/notifications/web-push-channel.ts";

const PROVIDER_TIMEOUT_MS = Number(Deno.env.get("ALERT_DISPATCH_PROVIDER_TIMEOUT_MS") ?? 8_000);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DISPATCH_TOKEN = Deno.env.get("ALERT_DISPATCHER_TOKEN") ?? SERVICE_ROLE_KEY;
const NOTIFICATION_ENCRYPTION_KEY = Deno.env.get("OWNER_NOTIFICATION_ENCRYPTION_KEY") ?? "";
const webPushConfig = resolveWebPushConfig({
  WEB_PUSH_VAPID_PUBLIC_KEY: Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY"),
  WEB_PUSH_VAPID_PRIVATE_KEY: Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY"),
  WEB_PUSH_SUBJECT: Deno.env.get("WEB_PUSH_SUBJECT"),
});

const channelEnv = resolveOwnerAlertChannel({
  OWNER_ALERT_CHANNEL_ENABLED: Deno.env.get("OWNER_ALERT_CHANNEL_ENABLED"),
  OWNER_ALERT_DUPLICATE_DELIVERY_ACCEPTED: Deno.env.get("OWNER_ALERT_DUPLICATE_DELIVERY_ACCEPTED"),
  TWILIO_ACCOUNT_SID: Deno.env.get("TWILIO_ACCOUNT_SID"),
  TWILIO_AUTH_TOKEN: Deno.env.get("TWILIO_AUTH_TOKEN"),
  TWILIO_OWNER_FROM: Deno.env.get("TWILIO_OWNER_FROM"),
  TWILIO_FROM_NUMBER: Deno.env.get("TWILIO_FROM_NUMBER"),
});

// Every provider request gets a hard timeout well inside the lease duration;
// an abort surfaces as a transport failure, which the adapter classifies as
// ambiguous — retryable under the same dispatch identity.
const timeoutFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });

const twilioAdapter: DispatchChannelAdapter = {
  channel: "twilio_whatsapp",
  isConfigured: (row: LeasedAlertDispatch) =>
    ownerAlertChannelConfigured(channelEnv) && Boolean(row.target.trim()),
  send: (row: LeasedAlertDispatch) => {
    const message = typeof row.payload?.message === "string" ? row.payload.message : "";
    return sendOwnerAlertViaTwilio({
      config: channelEnv,
      target: row.target,
      message: row.kind === "critical_alert" ? `Urgent from PlaiceToMeat\n${message}` : message,
      fetcher: timeoutFetch,
    });
  },
};

if (webPushConfigured(webPushConfig)) {
  webpush.setVapidDetails(webPushConfig.subject, webPushConfig.publicKey, webPushConfig.privateKey);
}

const webPushAdapter = createWebPushChannelAdapter({
  config: webPushConfig,
  loadSubscription: async (deviceId) => {
    if (!NOTIFICATION_ENCRYPTION_KEY) throw new Error("notification decryption unavailable");
    const { data, error } = await serviceClient().from("owner_notification_devices")
      .select("endpoint_ciphertext,auth_ciphertext,p256dh_ciphertext")
      .eq("id", deviceId).eq("channel", "web_push").single();
    if (error || !data?.endpoint_ciphertext || !data.auth_ciphertext || !data.p256dh_ciphertext) {
      throw new Error("stored subscription unavailable");
    }
    const [endpoint, auth, p256dh] = await Promise.all([
      decryptNotificationSecret(data.endpoint_ciphertext, NOTIFICATION_ENCRYPTION_KEY),
      decryptNotificationSecret(data.auth_ciphertext, NOTIFICATION_ENCRYPTION_KEY),
      decryptNotificationSecret(data.p256dh_ciphertext, NOTIFICATION_ENCRYPTION_KEY),
    ]);
    return { endpoint, keys: { auth, p256dh } };
  },
  sendNotification: async (subscription, payload) => {
    const result = await webpush.sendNotification(subscription, payload, { TTL: 300, urgency: "high" });
    return { statusCode: result.statusCode, headers: result.headers };
  },
});

const ADAPTERS: Record<string, DispatchChannelAdapter> = {
  twilio_whatsapp: twilioAdapter,
  web_push: webPushAdapter,
  // fcm / telegram / ntfy remain CHANNEL_NOT_IMPLEMENTED until later phases.
};

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  if (bytesA.length !== bytesB.length) return false;
  let diff = 0;
  for (let i = 0; i < bytesA.length; i += 1) diff |= bytesA[i] ^ bytesB[i];
  return diff === 0;
}

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token || !DISPATCH_TOKEN) return false;
  return timingSafeEqual(token, DISPATCH_TOKEN);
}

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function health(): Promise<Response> {
  const supabase = serviceClient();
  const checks: Record<string, unknown> = {
    version: DISPATCHER_VERSION,
    build: Deno.env.get("ALERT_DISPATCHER_BUILD") ?? Deno.env.get("DENO_DEPLOYMENT_ID") ?? null,
    database_reachable: false,
    lease_rpc: false,
    recovery_rpc: false,
    record_rpc: false,
    provider_configuration_loaded: ownerAlertChannelConfigured(channelEnv),
    registered_channels: Object.keys(ADAPTERS),
    web_push: {
      implemented: true,
      configured: webPushConfigured(webPushConfig) && Boolean(NOTIFICATION_ENCRYPTION_KEY),
      vapid_public_key_configured: Boolean(webPushConfig.publicKey),
      vapid_private_key_configured: Boolean(webPushConfig.privateKey),
      subject_configured: /^(mailto:|https:\/\/)/.test(webPushConfig.subject),
      decryption_configured: Boolean(NOTIFICATION_ENCRYPTION_KEY),
    },
  };
  try {
    const { error: dbError } = await supabase
      .from("alert_dispatches")
      .select("id", { count: "exact", head: true })
      .limit(1);
    checks.database_reachable = !dbError;
    const { data, error } = await supabase.rpc("alert_dispatcher_health_v18");
    if (!error && data) {
      const rpcHealth = data as Record<string, unknown>;
      checks.lease_rpc = rpcHealth.lease_rpc === true;
      checks.recovery_rpc = rpcHealth.recovery_rpc === true;
      checks.record_rpc = rpcHealth.record_rpc === true;
      checks.registry_kinds = rpcHealth.registry_kinds;
      checks.schema_version = rpcHealth.schema_version;
      checks.queue = rpcHealth.queue;
    }
    const { data: webPushHealth, error: webPushHealthError } = await supabase.rpc("web_push_health_v18");
    if (!webPushHealthError && webPushHealth) {
      checks.web_push = { ...(checks.web_push as Record<string, unknown>), ...(webPushHealth as Record<string, unknown>) };
    }
  } catch (error) {
    checks.error = error instanceof Error ? error.message : String(error);
  }
  const ready = checks.database_reachable === true
    && checks.lease_rpc === true
    && checks.recovery_rpc === true
    && checks.record_rpc === true;
  return Response.json({ ready, ...checks }, { status: ready ? 200 : 503 });
}

async function sweep(): Promise<Response> {
  const supabase = serviceClient();
  const invocationId = `edge:${crypto.randomUUID().slice(0, 8)}`;
  const metrics = await runDispatcherSweep({
    invocationId,
    callRpc: async (name, args) => {
      const { data, error } = await supabase.rpc(name, args);
      if (error) throw new Error(`${name}: ${error.message}`);
      return data;
    },
    adapters: ADAPTERS,
    config: {
      batchSize: Number(Deno.env.get("ALERT_DISPATCH_BATCH_SIZE") ?? DEFAULT_DISPATCHER_CONFIG.batchSize),
      maxConcurrentSends: Number(
        Deno.env.get("ALERT_DISPATCH_MAX_CONCURRENT_SENDS") ?? DEFAULT_DISPATCHER_CONFIG.maxConcurrentSends,
      ),
      softDeadlineMs: Number(
        Deno.env.get("ALERT_DISPATCH_SOFT_DEADLINE_MS") ?? DEFAULT_DISPATCHER_CONFIG.softDeadlineMs,
      ),
      providerTimeoutMs: PROVIDER_TIMEOUT_MS,
      channels: (Deno.env.get("ALERT_DISPATCH_CHANNELS") ?? "web_push").split(",").map((value) => value.trim()).filter(Boolean),
    },
    log: (entry) => console.log(JSON.stringify(entry)),
  });
  console.log(JSON.stringify({ event: "alert_dispatch_sweep", ...metrics }));
  return Response.json(metrics);
}

Deno.serve(async (request) => {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  if (request.method === "GET" || url.pathname.endsWith("/health")) {
    return health();
  }
  try {
    return await sweep();
  } catch (error) {
    // A sweep-level failure (e.g. database unreachable) is loud, never silent:
    // durable rows stay pending/leased and the next cron tick retries.
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "alert_dispatch_sweep_failed", error: message }));
    return Response.json({ error: message }, { status: 500 });
  }
});

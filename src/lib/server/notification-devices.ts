import "server-only";

import { encryptNotificationSecret, subscriptionFingerprint } from "@/lib/notifications/secret-box";
import { checkRateLimit, clientNetworkHash, hashIdentity } from "@/lib/server/rate-limit";
import { resolveStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SafeNotificationDevice = {
  id: string; deviceLabel: string | null; platform: string | null; enabled: boolean;
  verifiedAt: string | null; disabledAt: string | null; invalidatedAt: string | null;
  invalidationReason: string | null; lastSuccessAt: string | null; lastFailureAt: string | null;
  status: "unverified" | "active" | "disabled" | "invalidated";
};

function encryptionKey(): string {
  const key = process.env.OWNER_NOTIFICATION_ENCRYPTION_KEY?.trim();
  if (!key) throw new Error("Owner notification encryption is not configured.");
  return key;
}
async function ownerContext() {
  return resolveStaffContext("owner", { branchScoped: true });
}

export async function listOwnerNotificationDevices(): Promise<SafeNotificationDevice[]> {
  const ctx = await ownerContext();
  if (!ctx.ok) return [];
  const { data, error } = await createSupabaseServiceClient().from("owner_notification_devices")
    .select("id,device_label,platform,enabled,verified_at,disabled_at,invalidated_at,invalidation_reason,last_success_at,last_failure_at")
    .eq("owner_id", ctx.profile.id).eq("channel", "web_push").order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load notification devices: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: String(row.id), deviceLabel: row.device_label, platform: row.platform, enabled: row.enabled,
    verifiedAt: row.verified_at, disabledAt: row.disabled_at, invalidatedAt: row.invalidated_at,
    invalidationReason: row.invalidation_reason, lastSuccessAt: row.last_success_at, lastFailureAt: row.last_failure_at,
    status: row.invalidated_at ? "invalidated" : !row.enabled ? "disabled" : row.verified_at ? "active" : "unverified",
  }));
}

export async function registerOwnerNotificationDevice(value: unknown) {
  const ctx = await ownerContext();
  if (!ctx.ok) return { ok: false as const, status: ctx.reason === "unauthenticated" ? 401 : 403, error: ctx.message };
  const body = value as Record<string, unknown>;
  const subscription = body?.subscription as Record<string, unknown> | undefined;
  const keys = subscription?.keys as Record<string, unknown> | undefined;
  const installationId = typeof body?.installationId === "string" ? body.installationId : "";
  const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint : "";
  const auth = typeof keys?.auth === "string" ? keys.auth : "";
  const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh : "";
  const label = typeof body?.deviceLabel === "string" ? body.deviceLabel.trim() : "This browser";
  if (!UUID.test(installationId) || label.length > 80 || endpoint.length > 4096 || auth.length > 512 || p256dh.length > 1024
      || !endpoint.startsWith("https://") || auth.length < 8 || p256dh.length < 20) {
    return { ok: false as const, status: 400, error: "That notification subscription is not valid." };
  }
  const limitIdentity = hashIdentity(ctx.profile.id, await clientNetworkHash());
  const limit = await checkRateLimit("notification_registration", limitIdentity, { failClosed: true });
  if (!limit.allowed) return { ok: false as const, status: 429, error: "Too many notification setup attempts. Try again shortly." };
  const key = encryptionKey();
  const [endpointCiphertext, authCiphertext, p256dhCiphertext, fingerprint] = await Promise.all([
    encryptNotificationSecret(endpoint, key), encryptNotificationSecret(auth, key),
    encryptNotificationSecret(p256dh, key), subscriptionFingerprint(endpoint, auth, p256dh),
  ]);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("register_owner_notification_device_v18", {
    p_branch_id: ctx.branchId, p_installation_id: installationId, p_device_label: label,
    p_platform: typeof body.platform === "string" ? body.platform.slice(0, 80) : null,
    p_user_agent: typeof body.userAgent === "string" ? body.userAgent.slice(0, 500) : null,
    p_endpoint_ciphertext: endpointCiphertext, p_auth_ciphertext: authCiphertext,
    p_p256dh_ciphertext: p256dhCiphertext, p_subscription_fingerprint: fingerprint,
  });
  if (error) return { ok: false as const, status: 400, error: error.message };
  return { ok: true as const, data };
}

export async function ownerNotificationRpc(name: string, args: Record<string, unknown>) {
  const ctx = await ownerContext();
  if (!ctx.ok) return { ok: false as const, status: ctx.reason === "unauthenticated" ? 401 : 403, error: ctx.message };
  const { data, error } = await (await createSupabaseServerClient()).rpc(name, args);
  if (error) return { ok: false as const, status: error.code === "42501" ? 403 : 400, error: error.message };
  return { ok: true as const, data };
}

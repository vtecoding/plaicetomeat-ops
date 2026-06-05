import "server-only";

import { isOrderRef } from "@/lib/domain/order-ref";
import { normalizeUkPhone } from "@/lib/domain/public-order-access";
import { checkRateLimit, clientNetworkHash, hashIdentity } from "@/lib/server/rate-limit";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

// V11.1 — PRIVILEGED public-order mutation boundary.
//
// This is the ONLY module permitted to use the service-role client for the
// public order flow. It exists because cancel_public_order and
// establish_public_order_access are service_role-only RPCs: an anon caller (even
// holding a leaked public_access_id) cannot invoke them. These functions are
// reached solely from server actions that have ALREADY verified the signed
// session cookie (cancel) / are applying fail-closed rate limiting (both).
//
// Containment guarantees (asserted by public-route-imports.test.ts):
//  - it calls ONLY the two safe SECURITY DEFINER RPCs;
//  - it performs NO raw order-table reads and no internal order select;
//  - it returns no internal order fields to callers.

export type EstablishResult =
  | { kind: "ok"; publicAccessId: string; version: number }
  | { kind: "invalid" }
  | { kind: "not_matched" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

export async function establishPublicOrderAccess(orderRef: string, phone: string): Promise<EstablishResult> {
  if (!isOrderRef(orderRef) || normalizeUkPhone(phone) === "") {
    return { kind: "invalid" };
  }
  if (!hasSupabaseServiceEnv()) {
    return { kind: "unavailable" };
  }

  // Fail CLOSED: a limiter outage must not enable unbounded brute force.
  const identity = hashIdentity(await clientNetworkHash(), hashIdentity("ref", orderRef));
  const rl = await checkRateLimit("public_establish", identity, { failClosed: true });
  if (!rl.allowed) {
    // Generic temporary failure — does not reveal whether the order exists.
    return rl.degraded ? { kind: "unavailable" } : { kind: "rate_limited" };
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("establish_public_order_access", {
    p_order_ref: orderRef,
    p_phone: phone,
  });

  if (error) {
    console.error("[public-order] establish failed", { error: error.message });
    return { kind: "unavailable" };
  }
  if (!data) {
    return { kind: "not_matched" }; // identical for unknown ref and wrong phone
  }
  const result = data as { publicAccessId?: string; version?: number };
  if (!result.publicAccessId || !Number.isInteger(result.version)) {
    return { kind: "unavailable" };
  }
  return { kind: "ok", publicAccessId: result.publicAccessId, version: result.version as number };
}

export type CancelResult =
  | { kind: "ok"; orderRef: string }
  | { kind: "rejected"; message: string }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SAFE_CANCEL_MESSAGES = [
  "Order not found",
  "can no longer be cancelled",
  "cancellation window has expired",
];

/**
 * Cancel an order. The CALLER (cancel-order action) must have already verified
 * the signed session grants access to publicAccessId; `expectedVersion` is the
 * session-bound version and is enforced in SQL (compare-and-check).
 */
export async function cancelPublicOrder(
  publicAccessId: string,
  reason: string | null,
  expectedVersion: number,
): Promise<CancelResult> {
  if (!UUID_RE.test(publicAccessId)) {
    return { kind: "rejected", message: "Order not found." };
  }
  if (!hasSupabaseServiceEnv()) {
    return { kind: "unavailable" };
  }

  const rl = await checkRateLimit("public_cancel", hashIdentity(await clientNetworkHash(), publicAccessId), {
    failClosed: true,
  });
  if (!rl.allowed) {
    return rl.degraded ? { kind: "unavailable" } : { kind: "rate_limited" };
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc("cancel_public_order", {
    p_public_access_id: publicAccessId,
    p_reason: reason,
    p_expected_version: expectedVersion,
  });

  if (error) {
    const known = SAFE_CANCEL_MESSAGES.find((m) => error.message.includes(m));
    if (known) {
      return { kind: "rejected", message: error.message.replace(/\.$/, "") + "." };
    }
    console.error("[public-order] cancel failed", { error: error.message });
    return { kind: "unavailable" };
  }

  const result = data as { ok?: boolean; orderRef?: string } | null;
  if (result?.ok) {
    return { kind: "ok", orderRef: String(result.orderRef ?? "") };
  }
  return { kind: "rejected", message: "We could not cancel this order. Please call the shop." };
}

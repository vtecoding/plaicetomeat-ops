import "server-only";

import {
  findForbiddenFields,
  normalizeUkPhone,
  type PublicOrderStatus,
  type PublicOrderStatusValue,
} from "@/lib/domain/public-order-access";
import { isOrderRef } from "@/lib/domain/order-ref";
import { checkRateLimit, clientNetworkHash, hashIdentity } from "@/lib/server/rate-limit";
import { createSupabasePublicClient, hasSupabasePublicEnv } from "@/lib/supabase/server";

// V11.1 — public order access use cases. These are the ONLY way a public route
// reaches order data, and they call SECURITY DEFINER RPCs that return only the
// safe DTO. No service-role client, no reference->data read.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PublicStatusResult =
  | { kind: "ok"; data: PublicOrderStatus }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function mapStatus(raw: Record<string, unknown>): PublicOrderStatus {
  const items = Array.isArray(raw.items) ? raw.items : [];
  return {
    orderRef: String(raw.orderRef ?? ""),
    customerDisplayName: String(raw.customerDisplayName ?? ""),
    status: String(raw.status ?? "incoming") as PublicOrderStatusValue,
    pickupDate: String(raw.pickupDate ?? ""),
    pickupWindowLabel: String(raw.pickupWindowLabel ?? ""),
    items: items.map((i) => {
      const item = i as Record<string, unknown>;
      return {
        name: String(item.name ?? ""),
        quantity: toNumber(item.quantity),
        unitType: String(item.unitType ?? ""),
        lineTotal: toNumber(item.lineTotal),
      };
    }),
    subtotal: toNumber(raw.subtotal),
    canCancel: raw.canCancel === true,
    cancellationDeadline: raw.cancellationDeadline == null ? null : String(raw.cancellationDeadline),
  };
}

export async function getPublicOrderStatus(publicAccessId: string): Promise<PublicStatusResult> {
  if (!UUID_RE.test(publicAccessId)) {
    return { kind: "not_found" };
  }
  if (!hasSupabasePublicEnv()) {
    return { kind: "unavailable" };
  }

  const rl = await checkRateLimit("public_status", hashIdentity(await clientNetworkHash(), publicAccessId));
  if (!rl.allowed) {
    return { kind: "rate_limited" };
  }

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("get_public_order_status", { p_public_access_id: publicAccessId });

  if (error) {
    console.error("[public-order] status read failed", { error: error.message });
    return { kind: "unavailable" };
  }
  if (data == null) {
    return { kind: "not_found" };
  }

  const raw = data as Record<string, unknown>;
  // Defense in depth: never hand back a payload that carries an internal field.
  const violations = findForbiddenFields(raw);
  if (violations.length > 0) {
    console.error("[public-order] BLOCKED leaking DTO", { violations });
    return { kind: "unavailable" };
  }

  return { kind: "ok", data: mapStatus(raw) };
}

export type EstablishResult =
  | { kind: "ok"; publicAccessId: string }
  | { kind: "invalid" }
  | { kind: "not_matched" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

export async function establishPublicOrderAccess(orderRef: string, phone: string): Promise<EstablishResult> {
  if (!isOrderRef(orderRef) || normalizeUkPhone(phone) === "") {
    return { kind: "invalid" };
  }
  if (!hasSupabasePublicEnv()) {
    return { kind: "unavailable" };
  }

  const identity = hashIdentity(await clientNetworkHash(), hashIdentity("ref", orderRef));
  const rl = await checkRateLimit("public_establish", identity);
  if (!rl.allowed) {
    return { kind: "rate_limited" };
  }

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("establish_public_order_access", {
    p_order_ref: orderRef,
    p_phone: phone,
  });

  if (error) {
    console.error("[public-order] establish failed", { error: error.message });
    return { kind: "unavailable" };
  }
  if (!data) {
    return { kind: "not_matched" };
  }
  return { kind: "ok", publicAccessId: String(data) };
}

export type CancelResult =
  | { kind: "ok"; orderRef: string }
  | { kind: "rejected"; message: string }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

const SAFE_CANCEL_MESSAGES = [
  "Order not found",
  "can no longer be cancelled",
  "cancellation window has expired",
];

export async function cancelPublicOrder(publicAccessId: string, reason: string | null): Promise<CancelResult> {
  if (!UUID_RE.test(publicAccessId)) {
    return { kind: "rejected", message: "Order not found." };
  }
  if (!hasSupabasePublicEnv()) {
    return { kind: "unavailable" };
  }

  const rl = await checkRateLimit("public_cancel", hashIdentity(await clientNetworkHash(), publicAccessId));
  if (!rl.allowed) {
    return { kind: "rate_limited" };
  }

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("cancel_public_order", {
    p_public_access_id: publicAccessId,
    p_reason: reason,
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

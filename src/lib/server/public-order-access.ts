import "server-only";

import {
  findForbiddenFields,
  type PublicOrderStatus,
  type PublicOrderStatusValue,
} from "@/lib/domain/public-order-access";
import { checkRateLimit, clientNetworkHash, hashIdentity } from "@/lib/server/rate-limit";
import { createSupabasePublicClient, hasSupabasePublicEnv } from "@/lib/supabase/server";

// V11.1 — public, READ-ONLY order status (anon). Status is keyed by the
// unguessable public_access_id and returns only the safe DTO. Mutations
// (establish, cancel) live in order-access-privileged.ts behind service_role.

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

  // Status reads fail OPEN on limiter outage so customers can still see their
  // order; the unguessable id remains the access credential.
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
    return { kind: "not_found" }; // unknown OR revoked (revoked_at enforced in SQL)
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

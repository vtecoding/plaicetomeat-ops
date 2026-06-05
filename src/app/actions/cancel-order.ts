"use server";

import { hasOrderAccess } from "@/lib/server/order-access-session";
import { cancelPublicOrder } from "@/lib/server/public-order-access";

export type CancelOrderState = {
  ok: boolean;
  message: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function cancelOrderAction(_: CancelOrderState, formData: FormData): Promise<CancelOrderState> {
  const publicAccessId = String(formData.get("publicAccessId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (!UUID_RE.test(publicAccessId)) {
    return { ok: false, message: "That order link is not valid." };
  }

  // The established, signed order-access session is required: an enumerable
  // reference (or a leaked status URL alone) must never authorise cancellation.
  if (!(await hasOrderAccess(publicAccessId))) {
    return {
      ok: false,
      message: "Please confirm it's your order first by entering your order number and phone.",
    };
  }

  const result = await cancelPublicOrder(publicAccessId, reason || null);

  switch (result.kind) {
    case "ok":
      return { ok: true, message: "Your order has been cancelled." };
    case "rejected":
      return { ok: false, message: result.message };
    case "rate_limited":
      return { ok: false, message: "Too many attempts. Please wait a moment, or call the shop." };
    case "unavailable":
    default:
      return { ok: false, message: "We could not cancel this order. Please call the shop." };
  }
}

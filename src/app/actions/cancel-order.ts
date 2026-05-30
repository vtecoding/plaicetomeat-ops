"use server";

import { isOrderRef } from "@/lib/domain/order-ref";
import { createSupabaseServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";

export type CancelOrderState = {
  ok: boolean;
  message: string;
};

const SAFE_MESSAGE_PATTERNS = [
  "Order not found",
  "can no longer be cancelled",
  "cancellation window has expired",
];

function safeMessage(raw: string | undefined, fallback: string): string {
  if (raw && SAFE_MESSAGE_PATTERNS.some((p) => raw.includes(p))) {
    return raw.replace(/\.$/, "") + ".";
  }
  return fallback;
}

export async function cancelOrderAction(_: CancelOrderState, formData: FormData): Promise<CancelOrderState> {
  const orderRef = String(formData.get("orderRef") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (!isOrderRef(orderRef)) {
    return { ok: false, message: "That order reference is not valid." };
  }

  if (!hasSupabaseServiceEnv()) {
    return { ok: false, message: "Cancellation is unavailable right now. Please call the shop." };
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.rpc("cancel_order_by_ref", {
    p_order_ref: orderRef,
    p_reason: reason || null,
  });

  if (error) {
    return { ok: false, message: safeMessage(error.message, "We could not cancel this order. Please call the shop.") };
  }

  return { ok: true, message: "Your order has been cancelled." };
}

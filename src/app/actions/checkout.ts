"use server";

import { grantOrderAccess, isOrderAccessConfigured } from "@/lib/server/order-access-session";
import { submitCheckout } from "@/lib/server/orders";
import { MAX_CHECKOUT_BODY_BYTES } from "@/lib/validation/checkout";

export type CheckoutActionState = {
  ok: boolean;
  message: string;
  orderRef?: string;
  publicAccessId?: string;
  // V12.3 — partial-success signalling. When the order commits but the access
  // cookie could not be established, the order is NOT a failure: it exists and is
  // recoverable via ref + phone lookup.
  orderPlaced?: boolean;
  accessEstablished?: boolean;
  recoveryRequired?: boolean;
};

export async function createOrderAction(_: CheckoutActionState, formData: FormData): Promise<CheckoutActionState> {
  // Preflight the access secret BEFORE any mutation: if we could never establish
  // the access cookie, refuse now rather than commit an unreachable order.
  if (!isOrderAccessConfigured()) {
    return {
      ok: false,
      message: "Checkout is temporarily unavailable. Please try again shortly or call the shop.",
    };
  }

  const rawBasket = formData.get("basket");

  if (typeof rawBasket === "string" && Buffer.byteLength(rawBasket, "utf8") > MAX_CHECKOUT_BODY_BYTES) {
    return {
      ok: false,
      message: "Your basket is too large. Please remove some items and try again.",
    };
  }

  let parsedBasket: unknown[] = [];

  try {
    parsedBasket = rawBasket ? JSON.parse(String(rawBasket)) : [];
  } catch {
    return {
      ok: false,
      message: "Basket data could not be read. Please refresh and try again.",
    };
  }

  const result = await submitCheckout({
    branchId: formData.get("branchId"),
    customerName: formData.get("customerName"),
    customerPhone: formData.get("customerPhone"),
    customerEmail: formData.get("customerEmail"),
    pickupDate: formData.get("pickupDate"),
    pickupWindowId: formData.get("pickupWindowId"),
    notes: formData.get("notes"),
    idempotencyKey: formData.get("idempotencyKey"),
    basket: parsedBasket,
    isTest: formData.get("isTest") === "true",
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
    };
  }

  // The order is COMMITTED at this point. Establishing the signed access cookie is
  // a best-effort convenience: if it fails we must not report total failure, or
  // the customer would re-submit and be confused. Surface a recoverable partial
  // success instead. A freshly created order is always at public_access_version 1.
  let accessEstablished = false;
  try {
    await grantOrderAccess(result.publicAccessId, 1);
    accessEstablished = true;
  } catch (error) {
    console.error("[checkout] order placed but access establishment failed", {
      orderRef: result.orderRef,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    ok: true,
    orderPlaced: true,
    accessEstablished,
    recoveryRequired: !accessEstablished,
    message: accessEstablished
      ? result.message
      : "Your order was placed. To view it, use ‘Find my order’ with your order reference and phone number.",
    orderRef: result.orderRef,
    publicAccessId: result.publicAccessId,
  };
}

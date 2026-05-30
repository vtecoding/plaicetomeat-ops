"use server";

import { submitCheckout } from "@/lib/server/orders";

export type CheckoutActionState = {
  ok: boolean;
  message: string;
  orderRef?: string;
};

export async function createOrderAction(_: CheckoutActionState, formData: FormData): Promise<CheckoutActionState> {
  const rawBasket = formData.get("basket");
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
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
    };
  }

  return {
    ok: true,
    message: result.message,
    orderRef: result.orderRef,
  };
}

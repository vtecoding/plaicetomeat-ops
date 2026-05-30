"use server";

import { checkoutSchema } from "@/lib/validation/checkout";

export type CheckoutActionState = {
  ok: boolean;
  message: string;
};

export async function createOrderAction(_: CheckoutActionState, formData: FormData): Promise<CheckoutActionState> {
  const rawBasket = formData.get("basket");
  const parsedBasket = rawBasket ? JSON.parse(String(rawBasket)) : [];

  const parsed = checkoutSchema.safeParse({
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

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Checkout details are invalid.",
    };
  }

  return {
    ok: false,
    message: "Supabase order creation is scaffolded, but credentials and transaction wiring are required before live checkout.",
  };
}

"use server";

import { redirect } from "next/navigation";

import { grantOrderAccess } from "@/lib/server/order-access-session";
import { establishPublicOrderAccess } from "@/lib/server/public-order-access";

export type EstablishAccessState = {
  ok: boolean;
  message: string;
};

export async function establishOrderAccessAction(
  _: EstablishAccessState,
  formData: FormData,
): Promise<EstablishAccessState> {
  const orderRef = String(formData.get("orderRef") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  const result = await establishPublicOrderAccess(orderRef, phone);

  let redirectTo: string | null = null;

  switch (result.kind) {
    case "ok":
      await grantOrderAccess(result.publicAccessId);
      redirectTo = `/order/status/${result.publicAccessId}`;
      break;
    case "invalid":
      return { ok: false, message: "Please enter a valid order number (PTM-YYYY-NNNNN) and your phone number." };
    case "rate_limited":
      return { ok: false, message: "Too many attempts. Please wait a few minutes, or call the shop." };
    case "unavailable":
      return { ok: false, message: "This service is temporarily unavailable. Please call the shop." };
    case "not_matched":
    default:
      // Deliberately indistinguishable from a wrong reference: do not confirm
      // whether the reference exists.
      return { ok: false, message: "We couldn't find an order matching those details." };
  }

  // redirect() throws to perform the navigation; keep it outside the switch/try.
  redirect(redirectTo);
}

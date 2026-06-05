import { redirect } from "next/navigation";

import { isOrderRef } from "@/lib/domain/order-ref";

export const dynamic = "force-dynamic";

// V11.1: the order reference is a display label only and must never authorise
// access. Any old /order/<ref> link is redirected to the identity-checked lookup
// page; no order data is read or rendered here.
export default async function LegacyOrderPage({ params }: { params: Promise<{ orderRef: string }> }) {
  const { orderRef } = await params;
  if (isOrderRef(orderRef)) {
    redirect(`/order/lookup?ref=${encodeURIComponent(orderRef)}`);
  }
  redirect("/order/lookup");
}

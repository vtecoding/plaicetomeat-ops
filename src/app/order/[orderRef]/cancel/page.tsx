import { redirect } from "next/navigation";

import { isOrderRef } from "@/lib/domain/order-ref";

export const dynamic = "force-dynamic";

// V11.1: reference-only cancellation is removed. Redirect old links to the
// identity-checked lookup; cancellation now requires an established access
// session and is reached via /order/status/<publicAccessId>/cancel.
export default async function LegacyCancelPage({ params }: { params: Promise<{ orderRef: string }> }) {
  const { orderRef } = await params;
  if (isOrderRef(orderRef)) {
    redirect(`/order/lookup?ref=${encodeURIComponent(orderRef)}`);
  }
  redirect("/order/lookup");
}

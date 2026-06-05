import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock3, CreditCard, XCircle } from "lucide-react";

import { PayOnCollectionNote } from "@/components/pay-on-collection-note";
import { PageFrame } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPublicOrderStatus } from "@/lib/server/public-order-access";
import { formatCurrency, formatDisplayDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OrderStatusPage({ params }: { params: Promise<{ publicAccessId: string }> }) {
  const { publicAccessId } = await params;
  const result = await getPublicOrderStatus(publicAccessId);

  if (result.kind === "rate_limited") {
    return (
      <StatusMessage
        title="Too many requests"
        body="Please wait a moment and refresh this page. If this keeps happening, call the shop."
      />
    );
  }

  if (result.kind === "unavailable") {
    return (
      <StatusMessage
        title="Live status is temporarily unavailable"
        body="We couldn't load your order right now. Please try again shortly, or call the shop."
      />
    );
  }

  if (result.kind === "not_found") {
    notFound();
  }

  const order = result.data;

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {order.status === "ready" && (
          <div className="mb-6 rounded-lg border border-[#badbc8] bg-[#eaf7ef] p-5 text-[#103d29]">
            <p className="text-lg font-black">Your order is ready.</p>
            <p className="mt-1">Please proceed to the counter and pay on collection.</p>
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="rounded-lg border border-[#ded6ca] bg-white p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">Live status</Badge>
            </div>
            <h1 className="mt-4 text-5xl font-black tracking-normal">{order.orderRef}</h1>
            <p className="mt-2 text-[#6c5e52]">Order for {order.customerDisplayName}</p>

            {order.status !== "ready" && order.status !== "collected" && order.status !== "cancelled" && (
              <p className="mt-4 rounded-md bg-[#fbfaf7] p-4 text-sm leading-6 text-[#5c5148]">
                Thanks — your order is in. The shop is preparing it for your chosen collection time. You&apos;ll pay at the
                counter when you collect. Keep this page to check your live status.
              </p>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <StatusTile icon={Clock3} label="Status" value={customerStatusLabel(order.status)} />
              <StatusTile icon={CheckCircle2} label="Pickup" value={formatDisplayDate(order.pickupDate)} />
              <StatusTile icon={CreditCard} label="Window" value={order.pickupWindowLabel} />
            </div>

            <div className="mt-8">
              <h2 className="font-black">Items</h2>
              <div className="mt-3 divide-y divide-[#eee5d8] rounded-lg border border-[#eee5d8]">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex items-start justify-between gap-4 p-4 text-sm">
                    <div>
                      <p className="font-bold">{item.name}</p>
                      <p className="text-[#6c5e52]">
                        {item.quantity} {item.unitType}
                      </p>
                    </div>
                    <p className="font-bold">{formatCurrency(item.lineTotal)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <p className="font-bold">Subtotal</p>
                <p className="text-2xl font-black">{formatCurrency(order.subtotal)}</p>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <PayOnCollectionNote />
            <div className="rounded-lg border border-[#ded6ca] bg-white p-5">
              <h2 className="font-black">Cancellation</h2>
              {order.canCancel ? (
                <>
                  <p className="mt-2 text-sm text-[#6c5e52]">This order can still be cancelled online.</p>
                  <Button asChild variant="destructive" className="mt-4 w-full">
                    <Link href={`/order/status/${publicAccessId}/cancel`}>
                      <XCircle className="h-4 w-4" aria-hidden />
                      Cancel order
                    </Link>
                  </Button>
                </>
              ) : (
                <p className="mt-2 text-sm text-[#6c5e52]">
                  This order is already being prepared or can no longer be cancelled online. Please call the shop.
                </p>
              )}
            </div>
          </aside>
        </section>
      </main>
    </PageFrame>
  );
}

function StatusMessage({ title, body }: { title: string; body: string }) {
  return (
    <PageFrame>
      <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-3 text-[#6c5e52]">{body}</p>
      </main>
    </PageFrame>
  );
}

/** Customer-friendly wording for the internal order status. */
function customerStatusLabel(status: string): string {
  switch (status) {
    case "incoming":
      return "Order received";
    case "prepping":
      return "Being prepared";
    case "ready":
      return "Ready to collect";
    case "collected":
      return "Collected";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function StatusTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-[#fbfaf7] p-4">
      <Icon className="h-5 w-5 text-[#0f5132]" aria-hidden />
      <p className="mt-3 text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">{label}</p>
      <p className="mt-1 font-black capitalize">{value}</p>
    </div>
  );
}

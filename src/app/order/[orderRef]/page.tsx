import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock3, CreditCard, XCircle } from "lucide-react";

import { PayOnCollectionNote } from "@/components/pay-on-collection-note";
import { PageFrame } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { demoBranchSettings, demoPickupWindows } from "@/lib/data/demo";
import { canCustomerCancelOrder } from "@/lib/domain/cancellation";
import { getOrderByRef } from "@/lib/server/orders";
import { formatCurrency, formatDisplayDate, formatTimeRange } from "@/lib/utils";

export default async function OrderPage({ params }: { params: Promise<{ orderRef: string }> }) {
  const { orderRef } = await params;
  const order = await getOrderByRef(orderRef);

  if (!order) {
    notFound();
  }

  const pickupWindow = demoPickupWindows.find((window) => window.id === order.pickupWindowId);
  const cancellation = canCustomerCancelOrder({
    status: order.status,
    createdAt: order.createdAt,
    cancellationWindowMinutes: demoBranchSettings.cancellationWindowMinutes,
  });

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
            <Badge tone="green">Live status</Badge>
            <h1 className="mt-4 text-5xl font-black tracking-normal">{order.orderRef}</h1>
            <p className="mt-2 text-[#6c5e52]">Order for {order.customerName}</p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <StatusTile icon={Clock3} label="Status" value={order.status} />
              <StatusTile icon={CheckCircle2} label="Pickup" value={formatDisplayDate(order.pickupDate)} />
              <StatusTile
                icon={CreditCard}
                label="Window"
                value={pickupWindow ? formatTimeRange(pickupWindow.startTime, pickupWindow.endTime) : "Selected"}
              />
            </div>

            <div className="mt-8">
              <h2 className="font-black">Items</h2>
              <div className="mt-3 divide-y divide-[#eee5d8] rounded-lg border border-[#eee5d8]">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-4 p-4 text-sm">
                    <div>
                      <p className="font-bold">{item.productNameSnapshot}</p>
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
              {cancellation.allowed ? (
                <>
                  <p className="mt-2 text-sm text-[#6c5e52]">This order can still be cancelled online.</p>
                  <Button asChild variant="destructive" className="mt-4 w-full">
                    <Link href={`/order/${order.orderRef}/cancel`}>
                      <XCircle className="h-4 w-4" aria-hidden />
                      Cancel order
                    </Link>
                  </Button>
                </>
              ) : (
                <p className="mt-2 text-sm text-[#6c5e52]">{cancellation.reason}</p>
              )}
            </div>
          </aside>
        </section>
      </main>
    </PageFrame>
  );
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

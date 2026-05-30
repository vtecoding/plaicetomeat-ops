import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { demoPickupWindows, getDemoOrders } from "@/lib/data/demo";
import { formatCurrency, formatDisplayDate, formatTimeRange } from "@/lib/utils";

export default async function CounterOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = getDemoOrders().find((item) => item.id === id) ?? getDemoOrders()[0];
  const pickupWindow = demoPickupWindows.find((item) => item.id === order.pickupWindowId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Button asChild variant="ghost" size="sm">
          <Link href="/counter">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to counter
          </Link>
        </Button>

        <section className="mt-6 rounded-lg border border-[#ded6ca] bg-white p-6">
          <Badge tone="blue">{order.status}</Badge>
          <h1 className="mt-4 text-4xl font-black">{order.orderRef}</h1>
          <p className="mt-2 text-[#6c5e52]">
            {order.customerName} - {formatDisplayDate(order.pickupDate)} -{" "}
            {pickupWindow ? formatTimeRange(pickupWindow.startTime, pickupWindow.endTime) : "Pickup window"}
          </p>

          <div className="mt-6 divide-y divide-[#eee5d8] rounded-lg border border-[#eee5d8]">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-bold">{item.productNameSnapshot}</p>
                  <p className="text-sm text-[#6c5e52]">
                    {item.quantity} {item.unitType}
                  </p>
                </div>
                <p className="font-bold">{formatCurrency(item.lineTotal)}</p>
              </div>
            ))}
          </div>

          {order.notes && (
            <div className="mt-6 rounded-lg border border-[#f0c66e] bg-[#fff6df] p-4 text-sm text-[#5a3900]">
              {order.notes}
            </div>
          )}
        </section>
      </main>
    </PageFrame>
  );
}

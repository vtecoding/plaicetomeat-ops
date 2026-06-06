import Link from "next/link";

import { PageFrame } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { demoBranch } from "@/lib/data/demo";
import { getCounterOrders } from "@/lib/server/orders";
import { formatCurrency } from "@/lib/utils";

export default async function AdminOrdersPage() {
  const orders = await getCounterOrders(demoBranch.id);

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
        <h1 className="mt-2 text-3xl font-black">Order history</h1>
        <p className="mt-2 max-w-2xl text-sm text-[#6c5e52]">
          Past orders, search and exceptions. Live preparation happens at the{" "}
          <Link href="/counter" className="font-bold text-[#0f5132] underline-offset-2 hover:underline">
            Counter
          </Link>
          .
        </p>
        <div className="mt-8 overflow-hidden rounded-lg border border-[#ded6ca] bg-white">
          {orders.map((order) => (
            <div key={order.id} className="grid gap-3 border-b border-[#eee5d8] p-4 last:border-b-0 md:grid-cols-5">
              <p className="font-black">{order.orderRef}</p>
              <p>{order.customerName}</p>
              <Badge tone="blue">{order.status}</Badge>
              <p>{order.items.length} items</p>
              <p className="font-bold">{formatCurrency(order.subtotal)}</p>
            </div>
          ))}
        </div>
      </main>
    </PageFrame>
  );
}

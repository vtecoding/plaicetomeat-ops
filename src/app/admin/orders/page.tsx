import { PageFrame } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { getDemoOrders } from "@/lib/data/demo";
import { formatCurrency } from "@/lib/utils";

export default function AdminOrdersPage() {
  const orders = getDemoOrders();

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
        <h1 className="mt-2 text-3xl font-black">Order history</h1>
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

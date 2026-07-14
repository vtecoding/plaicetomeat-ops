import Link from "next/link";

import { AdminTillPanel } from "@/components/admin-till-panel";
import { PageFrame } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { BackLink, Masthead, Surface } from "@/components/ui/page";
import { getCounterOrders } from "@/lib/server/orders";
import { getDayPaymentPicture } from "@/lib/server/payment-truth";
import { requireStaffContext } from "@/lib/server/staff-context";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [orders, picture] = await Promise.all([getCounterOrders(branchId), getDayPaymentPicture(branchId)]);

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Masthead
          back={<BackLink href="/admin">Back to shop detail</BackLink>}
          eyebrow="Admin"
          title="Order history"
          subtitle={
            <>
              Past orders, search and exceptions. Live preparation happens at the{" "}
              <Link href="/counter" className="font-bold text-[var(--brand)] underline-offset-2 hover:underline">
                Counter
              </Link>
              .
            </>
          }
        />
        {/* V18 A1: the day's money picture + recorded drawer movements (D-9). */}
        <div className="mt-6">
          <AdminTillPanel picture={picture} />
        </div>

        <Surface className="mt-6 overflow-hidden">
          {orders.map((order) => (
            <div key={order.id} className="grid gap-3 border-b border-[var(--line)] p-4 last:border-b-0 md:grid-cols-5">
              <p className="font-bold">{order.orderRef}</p>
              <p>{order.customerName ?? "Counter sale"}</p>
              <Badge tone="blue">{order.status}</Badge>
              <p>{order.items.length} items</p>
              <p className="font-bold">{formatCurrency(order.subtotal)}</p>
            </div>
          ))}
        </Surface>
      </main>
    </PageFrame>
  );
}

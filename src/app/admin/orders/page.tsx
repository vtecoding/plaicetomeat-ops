import Link from "next/link";

import { AdminTillPanel } from "@/components/admin-till-panel";
import { AmendOrderPanel, RefundOrderPanel } from "@/components/order-corrections";
import { PageFrame } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { BackLink, Masthead, Surface } from "@/components/ui/page";
import { getCounterOrders } from "@/lib/server/orders";
import { getAllProducts } from "@/lib/server/catalog";
import { getDayPaymentPicture } from "@/lib/server/payment-truth";
import { requireStaffContext } from "@/lib/server/staff-context";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [orders, picture, products] = await Promise.all([
    getCounterOrders(branchId),
    getDayPaymentPicture(branchId),
    getAllProducts(branchId),
  ]);

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
            <div key={order.id} className="border-b border-[var(--line)] p-4 last:border-b-0">
              <div className="grid gap-3 md:grid-cols-5">
                <p className="font-bold">{order.orderRef}</p>
                <p>{order.customerName ?? "Counter sale"}</p>
                <Badge tone="blue">{order.status}</Badge>
                <p>{order.items.filter((item) => !item.isRemoved).length} items</p>
                <p className="font-bold">{formatCurrency(order.subtotal)}</p>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-[var(--muted)]">
                {order.items.map((item) => (
                  <p key={item.id} className={item.isRemoved ? "line-through" : undefined}>
                    {item.isRemoved ? "Removed" : `${item.quantity} ${item.unitType} ${item.productNameSnapshot} — ${formatCurrency(item.lineTotal)}`}
                    {(item.appliedSequence ?? 0) > 0 ? (
                      <span className="ml-2 text-xs">
                        Ordered: {item.originalQuantity} {item.originalUnitType} {item.originalProductName}
                      </span>
                    ) : null}
                  </p>
                ))}
              </div>
              {order.status === "prepping" || order.status === "ready" ? (
                <AmendOrderPanel order={order} products={products} />
              ) : null}
              {order.status === "collected" ? <RefundOrderPanel order={order} /> : null}
            </div>
          ))}
        </Surface>
      </main>
    </PageFrame>
  );
}

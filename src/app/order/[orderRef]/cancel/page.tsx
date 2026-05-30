import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, XCircle } from "lucide-react";

import { CancelOrderForm } from "@/components/cancel-order-form";
import { PageFrame } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { canCustomerCancelOrder } from "@/lib/domain/cancellation";
import { getBranchSettings } from "@/lib/server/catalog";
import { getOrderByRef } from "@/lib/server/orders";

export const dynamic = "force-dynamic";

export default async function CancelOrderPage({ params }: { params: Promise<{ orderRef: string }> }) {
  const { orderRef } = await params;
  const order = await getOrderByRef(orderRef);

  if (!order) {
    notFound();
  }

  const settings = await getBranchSettings(order.branchId);
  const cancellation = canCustomerCancelOrder({
    status: order.status,
    createdAt: order.createdAt,
    cancellationWindowMinutes: settings.cancellationWindowMinutes,
  });

  return (
    <PageFrame>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/order/${order.orderRef}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to order
          </Link>
        </Button>

        <section className="mt-6 rounded-lg border border-[#ded6ca] bg-white p-6">
          <XCircle className="h-8 w-8 text-[#b42318]" aria-hidden />
          <h1 className="mt-4 text-3xl font-black">Cancel {order.orderRef}</h1>
          {cancellation.allowed ? (
            <CancelOrderForm orderRef={order.orderRef} />
          ) : (
            <p className="mt-4 text-sm text-[#6c5e52]">{cancellation.reason}</p>
          )}
        </section>
      </main>
    </PageFrame>
  );
}

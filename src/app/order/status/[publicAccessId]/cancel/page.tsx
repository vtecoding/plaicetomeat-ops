import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, XCircle } from "lucide-react";

import { CancelOrderForm } from "@/components/cancel-order-form";
import { PageFrame } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { hasOrderAccess } from "@/lib/server/order-access-session";
import { getPublicOrderStatus } from "@/lib/server/public-order-access";

export const dynamic = "force-dynamic";

export default async function CancelOrderPage({ params }: { params: Promise<{ publicAccessId: string }> }) {
  const { publicAccessId } = await params;
  const result = await getPublicOrderStatus(publicAccessId);

  if (result.kind === "not_found") {
    notFound();
  }

  if (result.kind !== "ok") {
    return (
      <Shell title="Cancellation unavailable">
        <p className="mt-4 text-sm text-[#6c5e52]">
          We couldn&apos;t load this order right now. Please try again shortly, or call the shop.
        </p>
      </Shell>
    );
  }

  const order = result.data;
  const sessionOk = await hasOrderAccess(publicAccessId);

  return (
    <Shell title={`Cancel ${order.orderRef}`} backHref={`/order/status/${publicAccessId}`}>
      {!sessionOk ? (
        <div className="mt-4">
          <p className="text-sm text-[#6c5e52]">
            For your security, please confirm this is your order before cancelling.
          </p>
          <Button asChild className="mt-4">
            <Link href={`/order/lookup?ref=${encodeURIComponent(order.orderRef)}`}>Confirm it&apos;s my order</Link>
          </Button>
        </div>
      ) : order.canCancel ? (
        <CancelOrderForm publicAccessId={publicAccessId} />
      ) : (
        <p className="mt-4 text-sm text-[#6c5e52]">
          This order is already being prepared or can no longer be cancelled online. Please call the shop.
        </p>
      )}
    </Shell>
  );
}

function Shell({ title, backHref, children }: { title: string; backHref?: string; children: React.ReactNode }) {
  return (
    <PageFrame>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        {backHref && (
          <Button asChild variant="ghost" size="sm">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to order
            </Link>
          </Button>
        )}
        <section className="mt-6 rounded-lg border border-[#ded6ca] bg-white p-6">
          <XCircle className="h-8 w-8 text-[#b42318]" aria-hidden />
          <h1 className="mt-4 text-3xl font-black">{title}</h1>
          {children}
        </section>
      </main>
    </PageFrame>
  );
}

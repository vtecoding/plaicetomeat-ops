import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Scale } from "lucide-react";

import { AddToBasketButton } from "@/components/add-to-basket-button";
import { PayOnCollectionNote } from "@/components/pay-on-collection-note";
import { PageFrame } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { StockBadge } from "@/components/product-card";
import { demoCategories, demoProducts } from "@/lib/data/demo";
import { formatCurrency } from "@/lib/utils";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = demoProducts.find((item) => item.slug === slug);

  if (!product) {
    notFound();
  }

  const category = demoCategories.find((item) => item.id === product.categoryId);
  const unavailable = !product.isAvailable || product.stockStatus === "out_of_stock";

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Button asChild variant="ghost" size="sm">
          <Link href="/shop">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to shop
          </Link>
        </Button>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="rounded-lg border border-[#ded6ca] bg-white p-6">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">
                {category?.name ?? "Counter"}
              </p>
              <StockBadge status={product.stockStatus} isAvailable={product.isAvailable} />
            </div>
            <h1 className="mt-3 text-4xl font-black">{product.name}</h1>
            <p className="mt-4 max-w-2xl text-[#5c5148]">{product.description}</p>

            <dl className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-[#fbfaf7] p-4">
                <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Price</dt>
                <dd className="mt-1 text-2xl font-black">{formatCurrency(product.pricePerUnit)}</dd>
                <dd className="text-sm text-[#6c5e52]">per {product.unitType}</dd>
              </div>
              <div className="rounded-lg bg-[#fbfaf7] p-4">
                <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Minimum</dt>
                <dd className="mt-1 text-2xl font-black">
                  {product.minOrderQuantity} {product.unitType}
                </dd>
              </div>
              <div className="rounded-lg bg-[#fbfaf7] p-4">
                <dt className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Maximum</dt>
                <dd className="mt-1 text-2xl font-black">
                  {product.maxOrderQuantity ?? "Ask"} {product.maxOrderQuantity ? product.unitType : ""}
                </dd>
              </div>
            </dl>

            {product.requiresWeightConfirmation && (
              <div className="mt-6 flex gap-3 rounded-lg border border-[#d8d0c5] bg-[#f7f3ed] p-4 text-sm text-[#4b4036]">
                <Scale className="mt-0.5 h-5 w-5 shrink-0 text-[#0f5132]" aria-hidden />
                <span>Final weight may vary slightly. Pay the exact amount at collection.</span>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-[#ded6ca] bg-white p-5">
              <AddToBasketButton product={product} disabled={unavailable} />
              <p className="mt-3 text-xs leading-5 text-[#6c5e52]">
                Quantity controls and price recalculation are enforced again by the checkout server action.
              </p>
            </div>
            <PayOnCollectionNote />
          </aside>
        </section>
      </main>
    </PageFrame>
  );
}

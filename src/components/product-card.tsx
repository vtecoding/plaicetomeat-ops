import Link from "next/link";
import { AlertTriangle, Scale } from "lucide-react";

import { AddToBasketButton } from "@/components/add-to-basket-button";
import { Badge } from "@/components/ui/badge";
import type { Product, ProductCategory } from "@/lib/domain/types";
import { formatCurrency } from "@/lib/utils";

export function ProductCard({
  product,
  category,
}: {
  product: Product;
  category: ProductCategory | undefined;
}) {
  const outOfStock = !product.isAvailable || product.stockStatus === "out_of_stock";
  const tags = getProductTags(product);

  return (
    <article className="flex h-full flex-col rounded-lg border border-[#ded6ca] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#6c5e52]">
            {category?.name ?? "Butcher counter"}
          </p>
          <Link href={`/product/${product.slug}`} className="mt-1 block text-xl font-black hover:text-[#0f5132]">
            {product.name}
          </Link>
        </div>
        <StockBadge status={product.stockStatus} isAvailable={product.isAvailable} />
      </div>

      <p className="line-clamp-3 flex-1 text-sm leading-6 text-[#5c5148]">{product.description}</p>

      {tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full bg-[#f7f3ed] px-2.5 py-1 text-xs font-bold text-[#5c5148]">
              {tag}
            </span>
          ))}
        </div>
      )}

      {product.requiresWeightConfirmation && (
        <div className="mt-4 flex gap-2 rounded-md bg-[#f7f3ed] p-3 text-xs text-[#5c5148]">
          <Scale className="h-4 w-4 shrink-0 text-[#0f5132]" aria-hidden />
          <span>Final weight may vary slightly. Pay the exact amount at collection.</span>
        </div>
      )}

      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-2xl font-black">{formatCurrency(product.pricePerUnit)}</p>
          <p className="text-xs text-[#6c5e52]">per {product.unitType}</p>
        </div>
        <AddToBasketButton product={product} disabled={outOfStock} />
      </div>
    </article>
  );
}

function getProductTags(product: Product) {
  const text = `${product.name} ${product.description ?? ""}`.toLowerCase();
  const tags: string[] = [];
  if (/mince|diced|curry|leg|shoulder/.test(text)) tags.push("Best for curry");
  if (/steak|chop|kebab|wing|grill/.test(text)) tags.push("Best for grill");
  if (/breast|lean|fillet/.test(text)) tags.push("Lean option");
  if (/pack|box|whole/.test(text)) tags.push("Family pack");
  if (product.unitType === "kg") tags.push("Freezer friendly");
  return Array.from(new Set(tags)).slice(0, 3);
}

export function StockBadge({
  status,
  isAvailable,
}: {
  status: Product["stockStatus"];
  isAvailable: boolean;
}) {
  if (!isAvailable || status === "out_of_stock") {
    return (
      <Badge tone="red">
        <AlertTriangle className="mr-1 h-3 w-3" aria-hidden />
        Out of stock
      </Badge>
    );
  }

  if (status === "low_stock") {
    return <Badge tone="amber">Low stock</Badge>;
  }

  return <Badge tone="green">In stock</Badge>;
}

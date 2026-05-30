"use client";

import { ShoppingBasket } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  createEmptyBasket,
  getBasketStorageKey,
  isBasketExpired,
  upsertBasketItem,
} from "@/lib/domain/basket";
import type { Basket, Product } from "@/lib/domain/types";

export function AddToBasketButton({ product, disabled = false }: { product: Product; disabled?: boolean }) {
  const [added, setAdded] = useState(false);

  function handleAdd() {
    const key = getBasketStorageKey(product.branchId);
    const rawBasket = window.localStorage.getItem(key);
    let basket: Basket = createEmptyBasket(product.branchId);

    if (rawBasket) {
      try {
        const parsed = JSON.parse(rawBasket) as Basket;
        basket = isBasketExpired(parsed.updatedAt) ? createEmptyBasket(product.branchId) : parsed;
      } catch {
        basket = createEmptyBasket(product.branchId);
      }
    }

    const nextBasket = upsertBasketItem(basket, {
      productId: product.id,
      productSlug: product.slug,
      name: product.name,
      quantity: product.minOrderQuantity,
      unitType: product.unitType,
      unitPriceSnapshot: product.pricePerUnit,
    });

    window.localStorage.setItem(key, JSON.stringify(nextBasket));
    window.dispatchEvent(new CustomEvent("ptm-basket-updated"));
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }

  return (
    <Button onClick={handleAdd} disabled={disabled} size="sm">
      <ShoppingBasket className="h-4 w-4" aria-hidden />
      {added ? "Added" : "Add"}
    </Button>
  );
}

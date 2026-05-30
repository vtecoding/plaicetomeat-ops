"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PayOnCollectionNote } from "@/components/pay-on-collection-note";
import { Button } from "@/components/ui/button";
import { demoBranch } from "@/lib/data/demo";
import { createEmptyBasket, getBasketStorageKey, isBasketExpired } from "@/lib/domain/basket";
import type { Basket } from "@/lib/domain/types";
import { formatCurrency } from "@/lib/utils";

export function BasketClient() {
  const [basket, setBasket] = useState<Basket>(() => createEmptyBasket(demoBranch.id));
  const [staleMessage, setStaleMessage] = useState("");

  useEffect(() => {
    const key = getBasketStorageKey(demoBranch.id);
    const rawBasket = window.localStorage.getItem(key);

    if (!rawBasket) {
      return;
    }

    try {
      const parsed = JSON.parse(rawBasket) as Basket;

      if (isBasketExpired(parsed.updatedAt)) {
        window.localStorage.removeItem(key);
        setStaleMessage("Your basket was cleared because it was more than 24 hours old.");
        return;
      }

      setBasket(parsed);
    } catch {
      window.localStorage.removeItem(key);
    }
  }, []);

  const subtotal = useMemo(
    () => basket.items.reduce((total, item) => total + item.quantity * item.unitPriceSnapshot, 0),
    [basket.items],
  );

  function removeItem(productId: string) {
    const nextBasket = {
      ...basket,
      items: basket.items.filter((item) => item.productId !== productId),
      updatedAt: new Date().toISOString(),
    };
    setBasket(nextBasket);
    window.localStorage.setItem(getBasketStorageKey(demoBranch.id), JSON.stringify(nextBasket));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="rounded-lg border border-[#ded6ca] bg-white">
        <div className="border-b border-[#eee5d8] p-5">
          <h1 className="text-2xl font-black">Basket</h1>
          {staleMessage && <p className="mt-2 text-sm text-[#9f2318]">{staleMessage}</p>}
        </div>
        {basket.items.length === 0 ? (
          <div className="p-8 text-sm text-[#6c5e52]">
            Your basket is empty. Add products from the shop to start an order.
          </div>
        ) : (
          <div className="divide-y divide-[#eee5d8]">
            {basket.items.map((item) => (
              <div key={item.productId} className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-bold">{item.name}</p>
                  <p className="text-sm text-[#6c5e52]">
                    {item.quantity} {item.unitType} at {formatCurrency(item.unitPriceSnapshot)}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeItem(item.productId)} aria-label={`Remove ${item.name}`}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="space-y-4">
        <div className="rounded-lg border border-[#ded6ca] bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#6c5e52]">Display subtotal</p>
            <p className="text-2xl font-black">{formatCurrency(subtotal)}</p>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#6c5e52]">
            Prices shown here are for display. The server recalculates all totals at checkout.
          </p>
          {basket.items.length === 0 ? (
            <Button className="mt-5 w-full" disabled title="Add items to continue">
              Continue to checkout
            </Button>
          ) : (
            <Button asChild className="mt-5 w-full">
              <Link href="/checkout">Continue to checkout</Link>
            </Button>
          )}
        </div>
        <PayOnCollectionNote compact />
      </aside>
    </div>
  );
}

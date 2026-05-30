"use client";

import Link from "next/link";
import { CalendarDays, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PayOnCollectionNote } from "@/components/pay-on-collection-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { demoBranch, demoPickupWindows } from "@/lib/data/demo";
import { createEmptyBasket, getBasketStorageKey, isBasketExpired } from "@/lib/domain/basket";
import type { Basket } from "@/lib/domain/types";
import { formatCurrency, formatTimeRange } from "@/lib/utils";

export function CheckoutClient() {
  const [basket, setBasket] = useState<Basket>(() => createEmptyBasket(demoBranch.id));
  const [idempotencyKey, setIdempotencyKey] = useState("local-preview-key");
  const subtotal = useMemo(
    () => basket.items.reduce((total, item) => total + item.quantity * item.unitPriceSnapshot, 0),
    [basket.items],
  );

  useEffect(() => {
    setIdempotencyKey(window.crypto.randomUUID());

    const rawBasket = window.localStorage.getItem(getBasketStorageKey(demoBranch.id));

    if (!rawBasket) {
      return;
    }

    try {
      const parsed = JSON.parse(rawBasket) as Basket;

      if (!isBasketExpired(parsed.updatedAt)) {
        setBasket(parsed);
      }
    } catch {
      window.localStorage.removeItem(getBasketStorageKey(demoBranch.id));
    }
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <section className="rounded-lg border border-[#ded6ca] bg-white p-5">
        <h1 className="text-2xl font-black">Checkout</h1>
        <p className="mt-2 text-sm text-[#6c5e52]">Enter customer details and choose a pickup window.</p>

        <form className="mt-6 grid gap-5">
          <input type="hidden" name="branchId" value={demoBranch.id} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <input type="hidden" name="basket" value={JSON.stringify(basket.items)} />

          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="customerName">
              Name
            </label>
            <Input id="customerName" name="customerName" required placeholder="Customer name" />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="customerPhone">
              UK mobile number
            </label>
            <Input id="customerPhone" name="customerPhone" required placeholder="+447700900000" />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="customerEmail">
              Email
            </label>
            <Input id="customerEmail" name="customerEmail" type="email" placeholder="Optional" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-semibold" htmlFor="pickupDate">
                Pickup date
              </label>
              <Input id="pickupDate" name="pickupDate" type="date" required />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-semibold" htmlFor="pickupWindowId">
                Pickup window
              </label>
              <Select id="pickupWindowId" name="pickupWindowId" required defaultValue="">
                <option value="" disabled>
                  Select a window
                </option>
                {demoPickupWindows.map((window) => (
                  <option key={window.id} value={window.id}>
                    {window.label} ({formatTimeRange(window.startTime, window.endTime)})
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="notes">
              Notes
            </label>
            <Textarea id="notes" name="notes" placeholder="Cutting notes or collection context" />
          </div>

          <div className="rounded-lg border border-[#ded6ca] bg-[#fbfaf7] p-4 text-sm text-[#5c5148]">
            <p className="font-bold text-[#231f20]">Server checks still run at submission.</p>
            <p className="mt-1">
              Pickup cutoff, closure dates, product availability, quantity bounds, rate limits, and prices are all validated on the server.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/privacy" className="inline-flex items-center gap-2 text-sm font-semibold text-[#0f5132]">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Privacy notice
            </Link>
            <Button type="button" size="lg" disabled={basket.items.length === 0}>
              Place pay-on-collection order
            </Button>
          </div>
        </form>
      </section>

      <aside className="space-y-4">
        <PayOnCollectionNote />
        <div className="rounded-lg border border-[#ded6ca] bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-[#6c5e52]">
            <CalendarDays className="h-4 w-4" aria-hidden />
            Order summary
          </div>
          {basket.items.length === 0 ? (
            <p className="mt-4 text-sm text-[#6c5e52]">Your basket is empty.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {basket.items.map((item) => (
                <div key={item.productId} className="flex items-start justify-between gap-4 text-sm">
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-[#6c5e52]">
                      {item.quantity} {item.unitType}
                    </p>
                  </div>
                  <p className="font-bold">{formatCurrency(item.quantity * item.unitPriceSnapshot)}</p>
                </div>
              ))}
              <div className="border-t border-[#eee5d8] pt-4">
                <div className="flex items-center justify-between">
                  <p className="font-bold">Display subtotal</p>
                  <p className="text-xl font-black">{formatCurrency(subtotal)}</p>
                </div>
                <p className="mt-2 text-xs text-[#6c5e52]">Weight-based items may vary slightly.</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

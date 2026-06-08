"use client";

import Link from "next/link";
import { AlertCircle, CalendarDays, ShieldCheck } from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";

import { createOrderAction, type CheckoutActionState } from "@/app/actions/checkout";
import { PayOnCollectionNote } from "@/components/pay-on-collection-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createEmptyBasket, getBasketStorageKey, isBasketExpired } from "@/lib/domain/basket";
import { formatCutoffHour, getLocalIsoDate, isUkMobileNumber } from "@/lib/domain/checkout-rules";
import type { Basket, PickupWindow } from "@/lib/domain/types";
import { formatCurrency, formatTimeRange } from "@/lib/utils";

const initialActionState: CheckoutActionState = {
  ok: false,
  message: "",
};

export function CheckoutClient({
  branchId,
  pickupWindows,
  minOrderValue,
  sameDayCutoffTime,
  testModeEnabled = false,
}: {
  branchId: string;
  pickupWindows: PickupWindow[];
  minOrderValue: number;
  sameDayCutoffTime: string;
  testModeEnabled?: boolean;
}) {
  const [basket, setBasket] = useState<Basket>(() => createEmptyBasket(branchId));
  const [idempotencyKey, setIdempotencyKey] = useState("local-preview-key");
  const [minPickupDate, setMinPickupDate] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [isTestOrder, setIsTestOrder] = useState(false);
  const [actionState, formAction, isPending] = useActionState(createOrderAction, initialActionState);

  const cutoffHour = useMemo(() => Number(sameDayCutoffTime.slice(0, 2)) || 16, [sameDayCutoffTime]);

  const subtotal = useMemo(
    () => basket.items.reduce((total, item) => total + item.quantity * item.unitPriceSnapshot, 0),
    [basket.items],
  );
  const meetsMinimumOrder = subtotal >= minOrderValue;

  // Inline phone validation shares the exact server rule (isUkMobileNumber), so the
  // client never accepts something the server will reject, and vice versa.
  const phoneError = useMemo(() => {
    const trimmed = phone.trim();
    if (trimmed === "") return "Enter a UK mobile number.";
    if (!isUkMobileNumber(trimmed)) return "Enter a UK mobile number starting 07 or +447.";
    return null;
  }, [phone]);
  const showPhoneError = phoneTouched && phoneError !== null;

  const disabledReason =
    basket.items.length === 0
      ? "Add items to continue"
      : !meetsMinimumOrder
        ? `Minimum order is ${formatCurrency(minOrderValue)}`
        : phoneError
          ? "Enter a valid UK mobile number"
          : "";

  useEffect(() => {
    setIdempotencyKey(window.crypto.randomUUID());
    setMinPickupDate(getInitialPickupDate(cutoffHour));

    const rawBasket = window.localStorage.getItem(getBasketStorageKey(branchId));

    if (!rawBasket) {
      return;
    }

    try {
      const parsed = JSON.parse(rawBasket) as Basket;

      if (!isBasketExpired(parsed.updatedAt)) {
        setBasket(parsed);
      }
    } catch {
      window.localStorage.removeItem(getBasketStorageKey(branchId));
    }
  }, [branchId, cutoffHour]);

  useEffect(() => {
    if (!actionState.ok) {
      return;
    }

    // Order placed: clear the basket either way. Only auto-navigate to the status
    // page when the access cookie was established; otherwise we keep the customer
    // here and show the recovery panel (the status page would 403 without access).
    window.localStorage.removeItem(getBasketStorageKey(branchId));

    if (actionState.accessEstablished && actionState.publicAccessId) {
      window.location.assign(`/order/status/${actionState.publicAccessId}`);
    }
  }, [actionState, branchId]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <section className="rounded-lg border border-[#ded6ca] bg-white p-5">
        <h1 className="text-2xl font-black">Checkout</h1>
        <p className="mt-2 text-sm text-[#6c5e52]">Enter customer details and choose a pickup window.</p>

        <form
          action={formAction}
          className="mt-6 grid gap-5"
          onSubmit={(e) => {
            // Client guard mirrors the server rule; the server still re-validates.
            if (phoneError) {
              e.preventDefault();
              setPhoneTouched(true);
            }
          }}
        >
          <input type="hidden" name="branchId" value={branchId} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <input type="hidden" name="basket" value={JSON.stringify(basket.items)} />
          <input type="hidden" name="isTest" value={isTestOrder ? "true" : "false"} />

          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="customerName">
              Name
            </label>
            <Input id="customerName" name="customerName" required minLength={2} maxLength={80} placeholder="Customer name" />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="customerPhone">
              UK mobile number
            </label>
            <Input
              id="customerPhone"
              name="customerPhone"
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder="07700 900000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setPhoneTouched(true)}
              aria-invalid={showPhoneError}
              aria-describedby="customerPhone-error"
            />
            {showPhoneError && (
              <p id="customerPhone-error" data-testid="phone-error" className="text-sm font-semibold text-[#b42318]">
                {phoneError}
              </p>
            )}
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
              <Input id="pickupDate" name="pickupDate" type="date" required min={minPickupDate} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-semibold" htmlFor="pickupWindowId">
                Pickup window
              </label>
              <Select id="pickupWindowId" name="pickupWindowId" required defaultValue="" data-testid="pickup-window-select">
                <option value="" disabled>
                  Select a window
                </option>
                {pickupWindows.map((window) => (
                  <option key={window.id} value={window.id}>
                    {window.label} ({formatTimeRange(window.startTime, window.endTime)})
                  </option>
                ))}
              </Select>
              {pickupWindows.length === 0 && (
                <p className="text-sm text-[#b42318]">No pickup windows are currently open.</p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="notes">
              Notes
            </label>
            <Textarea id="notes" name="notes" maxLength={500} placeholder="Cutting notes or collection context" />
          </div>

          <div className="rounded-lg border border-[#ded6ca] bg-[#fbfaf7] p-4 text-sm text-[#5c5148]">
            <p className="font-bold text-[#231f20]">Server checks still run at submission.</p>
            <p className="mt-1">
              Same-day orders close at {formatCutoffHour(cutoffHour)}. Pickup cutoff, closure dates, product availability,
              quantity bounds, and prices are all validated on the server.
            </p>
          </div>

          {testModeEnabled && (
            <label
              data-testid="test-order-toggle"
              className="flex items-center gap-2 rounded-lg border border-dashed border-[#d99b22] bg-[#fff8ea] p-3 text-sm font-semibold text-[#7a4b00]"
            >
              <input type="checkbox" checked={isTestOrder} onChange={(e) => setIsTestOrder(e.target.checked)} />
              Place as TEST ORDER (no real SMS; visibly marked; dev/staging only)
            </label>
          )}

          {actionState.message && !actionState.ok && (
            <div className="flex gap-3 rounded-lg border border-[#f0c66e] bg-[#fff6df] p-4 text-sm text-[#5a3900]" role="alert">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <span>{actionState.message}</span>
            </div>
          )}

          {actionState.ok && actionState.recoveryRequired && (
            <div className="grid gap-2 rounded-lg border border-[#9ccfb0] bg-[#f2fbf5] p-4 text-sm text-[#0f5132]" role="status">
              <p className="font-bold">{actionState.message}</p>
              {actionState.orderRef && (
                <p>
                  Your order reference is <span className="font-mono font-black">{actionState.orderRef}</span>.
                </p>
              )}
              <Link href="/order/lookup" className="font-bold underline underline-offset-2">
                Find my order
              </Link>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/privacy" className="inline-flex items-center gap-2 text-sm font-semibold text-[#0f5132]">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Privacy notice
            </Link>
            <Button
              type="submit"
              size="lg"
              disabled={Boolean(disabledReason) || isPending}
              title={disabledReason || undefined}
            >
              {isPending ? "Placing order..." : "Place pay-on-collection order"}
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

function getInitialPickupDate(cutoffHour: number) {
  const now = new Date();

  if (now.getHours() < cutoffHour) {
    return getLocalIsoDate(now);
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return getLocalIsoDate(tomorrow);
}

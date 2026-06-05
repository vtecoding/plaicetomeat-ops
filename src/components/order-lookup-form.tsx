"use client";

import { useActionState } from "react";

import { establishOrderAccessAction, type EstablishAccessState } from "@/app/actions/establish-order-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initial: EstablishAccessState = { ok: false, message: "" };

export function OrderLookupForm({ defaultRef = "" }: { defaultRef?: string }) {
  const [state, formAction, isPending] = useActionState(establishOrderAccessAction, initial);

  return (
    <form className="mt-6 grid gap-5" action={formAction}>
      <div className="grid gap-2">
        <label className="text-sm font-semibold" htmlFor="orderRef">
          Order number
        </label>
        <Input id="orderRef" name="orderRef" defaultValue={defaultRef} placeholder="PTM-2026-00042" autoComplete="off" />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-semibold" htmlFor="phone">
          Phone number
        </label>
        <Input id="phone" name="phone" type="tel" placeholder="07123 456789" autoComplete="tel" />
      </div>
      {state.message && !state.ok && (
        <p data-testid="lookup-error" className="text-sm font-semibold text-[#b42318]" role="alert">
          {state.message}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isPending} data-testid="lookup-submit">
        {isPending ? "Checking…" : "View my order"}
      </Button>
    </form>
  );
}

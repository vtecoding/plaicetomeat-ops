"use client";

import { useActionState, useEffect } from "react";
import { CheckCircle2 } from "lucide-react";

import { cancelOrderAction, type CancelOrderState } from "@/app/actions/cancel-order";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const initial: CancelOrderState = { ok: false, message: "" };

export function CancelOrderForm({ orderRef }: { orderRef: string }) {
  const [state, formAction, isPending] = useActionState(cancelOrderAction, initial);

  useEffect(() => {
    if (state.ok) {
      const timer = setTimeout(() => window.location.assign(`/order/${orderRef}`), 1200);
      return () => clearTimeout(timer);
    }
  }, [state.ok, orderRef]);

  if (state.ok) {
    return (
      <div className="mt-6 flex items-center gap-2 rounded-lg border border-[#badbc8] bg-[#eaf7ef] p-4 text-[#103d29]" role="status">
        <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
        <span data-testid="cancel-success">{state.message}</span>
      </div>
    );
  }

  return (
    <form className="mt-6 grid gap-5" action={formAction}>
      <input type="hidden" name="orderRef" value={orderRef} />
      <div className="grid gap-2">
        <label className="text-sm font-semibold" htmlFor="reason">
          Reason
        </label>
        <Textarea id="reason" name="reason" placeholder="Optional" maxLength={300} />
      </div>
      {state.message && !state.ok && (
        <p data-testid="cancel-error" className="text-sm font-semibold text-[#b42318]" role="alert">
          {state.message}
        </p>
      )}
      <Button type="submit" variant="destructive" size="lg" disabled={isPending} data-testid="confirm-cancel">
        {isPending ? "Cancelling…" : "Confirm cancellation"}
      </Button>
    </form>
  );
}

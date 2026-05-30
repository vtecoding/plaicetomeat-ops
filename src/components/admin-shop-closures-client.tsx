"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CalendarOff, CheckCircle2 } from "lucide-react";

import { createShopClosure, removeShopClosure, type AdminScheduleResult } from "@/app/actions/admin-schedule";
import type { ShopClosure } from "@/lib/server/pickup-windows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDisplayDate } from "@/lib/utils";

type Feedback = { tone: "ok" | "error"; message: string } | null;

export function AdminShopClosuresClient({
  branchId,
  initialClosures,
}: {
  branchId: string;
  initialClosures: ShopClosure[];
}) {
  const [closures, setClosures] = useState(initialClosures);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();
  const [closeDate, setCloseDate] = useState("");
  const [reason, setReason] = useState("");

  function announce(r: AdminScheduleResult) {
    setFeedback(r.ok ? { tone: "ok", message: r.message } : { tone: "error", message: r.message });
  }

  function add() {
    startTransition(async () => {
      const result = await createShopClosure({ branchId, closeDate, reason: reason || null });
      announce(result);
      if (result.ok && result.id) {
        setClosures((prev) =>
          [...prev.filter((c) => c.closeDate !== closeDate), { id: result.id!, branchId, closeDate, reason: reason || null }].sort(
            (a, b) => a.closeDate.localeCompare(b.closeDate),
          ),
        );
        setCloseDate("");
        setReason("");
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await removeShopClosure({ closureId: id });
      announce(result);
      if (result.ok) {
        setClosures((prev) => prev.filter((c) => c.id !== id));
      }
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
          <h1 className="mt-2 text-3xl font-black">Shop closures</h1>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          data-testid="closure-feedback"
          className={
            "mt-4 flex items-center gap-2 rounded-lg border p-3 text-sm " +
            (feedback.tone === "ok"
              ? "border-[#0f5132]/30 bg-[#e6efe9] text-[#0f5132]"
              : "border-[#f0c66e] bg-[#fff6df] text-[#5a3900]")
          }
        >
          {feedback.tone === "ok" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      <form
        className="mt-6 grid gap-4 rounded-lg border border-[#ded6ca] bg-white p-5 sm:grid-cols-[200px_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="grid gap-1 text-sm font-semibold">
          Closure date
          <Input data-testid="new-closure-date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} type="date" required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Reason (optional)
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} />
        </label>
        <Button type="submit" data-testid="new-closure-submit" disabled={isPending}>
          {isPending ? "Adding…" : "Add closure"}
        </Button>
      </form>

      <div className="mt-8 grid gap-4">
        {closures.length === 0 && (
          <p className="rounded-lg border border-[#ded6ca] bg-white p-5 text-sm text-[#6c5e52]">No closures scheduled.</p>
        )}
        {closures.map((closure) => (
          <article
            key={closure.id}
            data-testid="closure-row"
            data-date={closure.closeDate}
            className="flex items-center justify-between gap-4 rounded-lg border border-[#ded6ca] bg-white p-5"
          >
            <div className="flex items-center gap-4">
              <CalendarOff className="h-6 w-6 text-[#b42318]" aria-hidden />
              <div>
                <p className="font-black">{formatDisplayDate(closure.closeDate)}</p>
                <p className="text-sm text-[#6c5e52]">{closure.reason ?? "Closed"}</p>
              </div>
            </div>
            <Button type="button" variant="destructive" data-testid="closure-remove" disabled={isPending} onClick={() => remove(closure.id)}>
              Remove
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}

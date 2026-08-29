"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Power } from "lucide-react";

import { setOwnerAwayMode } from "@/app/actions/owner-away";
import { Button } from "@/components/ui/button";
import type { OwnerAlertDeliveryHealth } from "@/lib/server/alert-dispatch";
import type { OwnerAwaySummary } from "@/lib/server/owner-away";
import { formatCurrency } from "@/lib/utils";

type Feedback = { tone: "ok" | "error"; message: string } | null;

export function OwnerOversightPanel({
  summary,
  deliveryHealth,
}: {
  summary: OwnerAwaySummary;
  deliveryHealth: OwnerAlertDeliveryHealth;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      const result = await setOwnerAwayMode({ ownerAway: !summary.settings.ownerAway });
      setFeedback(result.ok ? { tone: "ok", message: result.message } : { tone: "error", message: result.message });
      if (result.ok) router.refresh();
    });
  }

  const reviewCount =
    summary.alerts.openCount +
    summary.evidence.needsReview +
    summary.evidence.failed +
    summary.certificates.needsReview;

  return (
    <section
      id="owner-oversight"
      className="mt-4 scroll-mt-24 rounded-2xl border border-[#c5ddd0] bg-[var(--brand-50)] p-5"
      data-testid="owner-oversight-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-[var(--brand)]">Remote oversight · {summary.settings.ownerAway ? "On" : "Off"}</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-[var(--ink)]">{summary.headline}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {summary.sales.orderCount} sales · {formatCurrency(summary.sales.revenue)} net takings · {reviewCount} checks need you
          </p>
        </div>
        <Button
          type="button"
          onClick={toggle}
          disabled={isPending}
          variant={summary.settings.ownerAway ? "outline" : "default"}
          data-testid="owner-away-toggle"
        >
          <Power className="h-4 w-4" aria-hidden />
          {isPending ? "Saving..." : summary.settings.ownerAway ? "I am back" : "Turn on while away"}
        </Button>
      </div>

      {feedback ? (
        <p
          role="status"
          className={`mt-3 rounded-lg border p-3 text-sm font-semibold ${
            feedback.tone === "ok"
              ? "border-[#0f5132]/30 bg-white text-[#0f5132]"
              : "border-[#f0c66e] bg-[#fff8e6] text-[#5a3900]"
          }`}
        >
          {feedback.message}
        </p>
      ) : null}

      {deliveryHealth.deadLetterCount > 0 ? (
        <p className="mt-3 rounded-lg border border-[#e8a5a5] bg-[#fff1f1] p-3 text-sm font-semibold text-[#7a1b1b]">
          Alert delivery needs attention. {deliveryHealth.deadLetterCount} message
          {deliveryHealth.deadLetterCount === 1 ? " has" : "s have"} exhausted every retry.
        </p>
      ) : !deliveryHealth.configured ? (
        <p className="mt-3 rounded-lg border border-[#f0c66e] bg-[#fff8e6] p-3 text-sm font-semibold text-[#5a3900]">
          {deliveryHealth.configurationIssue ?? "Phone delivery is not ready."}
        </p>
      ) : null}

      <details className="mt-4 rounded-xl border border-[#c5ddd0] bg-white p-4">
        <summary className="cursor-pointer font-bold text-[var(--brand)]">Open the remote shop summary</summary>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Fact
            label="Shop"
            value={summary.shop.opened ? (summary.shop.closed ? "Opened and closed" : "Opened; close not saved") : "Opening not saved"}
          />
          <Fact label="Deliveries" value={`${summary.stock.deliveryCount} saved · ${summary.stock.deliveredKg.toFixed(2)}kg`} />
          <Fact label="Waste" value={`${summary.stock.wasteCount} entries · ${summary.stock.wasteKg.toFixed(2)}kg`} />
          <Fact
            label="Photos"
            value={`${summary.evidence.total} saved · ${summary.evidence.needsReview + summary.evidence.failed} to review`}
          />
          <Fact
            label="Certificates"
            value={`${summary.certificates.captured} saved · ${summary.certificates.needsReview} to review`}
          />
          <Fact label="Owner jobs" value={`${summary.alerts.openCount} open · ${summary.alerts.criticalCount} urgent`} />
        </dl>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
          <Button asChild variant="outline"><Link href="/admin/orders">Money & orders</Link></Button>
          <Button asChild variant="outline"><Link href="/admin/inventory">Stock</Link></Button>
          <Button asChild variant="outline"><Link href="/admin/compliance">Suppliers & safety</Link></Button>
          {summary.alerts.openCount > 0 ? (
            <Button asChild><Link href="#owner-jobs">Needs your decision</Link></Button>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-right font-bold text-[var(--ink)]">{value}</dd>
    </div>
  );
}

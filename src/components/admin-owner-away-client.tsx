"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, Camera, CheckCircle2, FileClock, PackageCheck, PoundSterling, Power, Store } from "lucide-react";

import { setOwnerAwayMode, type OwnerAwayActionResult } from "@/app/actions/owner-away";
import { Button } from "@/components/ui/button";
import { Masthead, Surface } from "@/components/ui/page";
import type { OwnerAwaySummary } from "@/lib/server/owner-away";
import { formatCurrency } from "@/lib/utils";

type Feedback = { tone: "ok" | "error"; message: string } | null;

export function AdminOwnerAwayClient({ summary }: { summary: OwnerAwaySummary }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();
  const nextMode = !summary.settings.ownerAway;

  function toggle() {
    startTransition(async () => {
      const result: OwnerAwayActionResult = await setOwnerAwayMode({ ownerAway: nextMode });
      setFeedback(result.ok ? { tone: "ok", message: result.message } : { tone: "error", message: result.message });
      if (result.ok) router.refresh();
    });
  }

  return (
    <div data-testid="owner-away-page">
      <Masthead
        eyebrow="Owner Away"
        title="Is the shop okay?"
        subtitle="One owner view of open, close, sales, stock, waste, photos, certificates and checks while you are away."
        actions={
          <Button type="button" onClick={toggle} disabled={isPending} variant={summary.settings.ownerAway ? "outline" : "default"} data-testid="owner-away-toggle">
            <Power className="h-4 w-4" aria-hidden />
            {isPending ? "Saving..." : summary.settings.ownerAway ? "I am back" : "Turn on"}
          </Button>
        }
      />

      {feedback && (
        <div
          role="status"
          className={
            "mt-4 flex items-center gap-2 rounded-lg border p-3 text-sm font-semibold " +
            (feedback.tone === "ok"
              ? "border-[#0f5132]/30 bg-[#e6efe9] text-[#0f5132]"
              : "border-[#f0c66e] bg-[#fff6df] text-[#5a3900]")
          }
        >
          {feedback.tone === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {!summary.configured && (
        <div className="mt-4 rounded-lg border border-[#f0c66e] bg-[#fff8e6] p-4 text-sm font-semibold text-[#5a3900]">
          Live database credentials are not configured, so this page cannot load the shop signals.
        </div>
      )}

      <Surface className="mt-6 overflow-hidden">
        <div className="border-b border-[var(--line)] bg-[var(--brand-50)] px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--brand)]">{summary.statusLabel}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold text-[var(--ink)]">{summary.headline}</h2>
          <p className="mt-1 text-sm font-medium text-[var(--muted)]">
            Watching since {new Date(summary.windowStart).toLocaleString("en-GB")}. Last refreshed{" "}
            {new Date(summary.generatedAt).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}.
          </p>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <AwayStat
            icon={Store}
            label="Shop"
            value={summary.shop.opened ? "Opened" : "Not opened"}
            detail={summary.shop.closed ? "Closed saved too" : "Close not saved yet"}
          />
          <AwayStat
            icon={PoundSterling}
            label="Sales"
            value={String(summary.sales.orderCount)}
            detail={formatCurrency(summary.sales.revenue)}
            testid="owner-away-sales-count"
          />
          <AwayStat
            icon={Camera}
            label="Photos saved"
            value={String(summary.evidence.total)}
            detail={`${summary.evidence.needsReview + summary.evidence.failed} need checking`}
            testid="owner-away-evidence-count"
          />
          <AwayStat
            icon={AlertTriangle}
            label="Owner checks"
            value={String(summary.alerts.openCount + summary.evidence.needsReview + summary.evidence.failed + summary.certificates.needsReview)}
            detail={`${summary.alerts.criticalCount} urgent`}
            testid="owner-away-alert-count"
          />
        </div>
      </Surface>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <Surface className="p-5">
          <PanelTitle icon={PackageCheck} title="Stock and waste" />
          <dl className="mt-4 grid gap-3 text-sm">
            <Fact label="Deliveries" value={`${summary.stock.deliveryCount} saved`} />
            <Fact label="Weight arrived" value={`${summary.stock.deliveredKg.toFixed(2)}kg`} />
            <Fact label="Waste" value={`${summary.stock.wasteCount} events - ${summary.stock.wasteKg.toFixed(2)}kg`} />
            <Fact label="Stock sold" value={`${summary.stock.saleKg.toFixed(2)}kg`} />
          </dl>
        </Surface>

        <Surface className="p-5">
          <PanelTitle icon={FileClock} title="Paperwork" />
          <dl className="mt-4 grid gap-3 text-sm">
            <Fact label="Papers captured" value={`${summary.certificates.captured} saved`} />
            <Fact label="Need review" value={`${summary.certificates.needsReview} papers`} />
            <Fact label="Evidence failed" value={`${summary.evidence.failed} failed uploads`} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[#eee5d8] pt-4">
            <Button asChild variant="outline">
              <Link href="/admin/evidence">Open evidence</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/compliance">Supplier certificates</Link>
            </Button>
          </div>
        </Surface>

        <Surface className="p-5">
          <PanelTitle icon={AlertTriangle} title="Needs owner" />
          {summary.alerts.latest.length === 0 ? (
            <p className="mt-4 text-sm font-medium text-[var(--muted)]">No open owner alerts.</p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {summary.alerts.latest.slice(0, 4).map((alert) => (
                <li key={alert.id} className="rounded-lg border border-[#eee5d8] bg-[#fbfaf7] p-3 text-sm">
                  <p className="font-bold text-[var(--ink)]">{alert.summary}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{alert.severity}</p>
                </li>
              ))}
            </ul>
          )}
        </Surface>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Surface className="p-5">
          <PanelTitle icon={PoundSterling} title="Latest sales" />
          {summary.sales.latestOrders.length === 0 ? (
            <p className="mt-4 text-sm font-medium text-[var(--muted)]">No sales in this window.</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {summary.sales.latestOrders.map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-3 rounded-lg bg-[#fbfaf7] px-3 py-2 text-sm">
                  <span className="font-bold">{order.orderRef}</span>
                  <span>{formatCurrency(order.subtotal)}</span>
                </li>
              ))}
            </ul>
          )}
        </Surface>

        <Surface className="p-5">
          <PanelTitle icon={Camera} title="Latest photos" />
          {summary.evidence.latest.length === 0 ? (
            <p className="mt-4 text-sm font-medium text-[var(--muted)]">No photos in this window.</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {summary.evidence.latest.map((item) => (
                <li key={item.id} className="rounded-lg bg-[#fbfaf7] px-3 py-2 text-sm">
                  <p className="font-bold capitalize">{item.evidenceType.replace(/_/g, " ")}</p>
                  <p className="text-[var(--muted)]">{item.source}</p>
                </li>
              ))}
            </ul>
          )}
        </Surface>
      </section>
    </div>
  );
}

function AwayStat({
  icon: Icon,
  label,
  value,
  detail,
  testid,
}: {
  icon: typeof Store;
  label: string;
  value: string;
  detail: string;
  testid?: string;
}) {
  return (
    <div className="rounded-xl border border-[#dcebe2] bg-white p-4">
      <Icon className="h-5 w-5 text-[var(--brand)]" aria-hidden />
      <p className="mt-3 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--ink)]" data-testid={testid}>
        {value}
      </p>
      <p className="mt-1 text-sm font-medium text-[var(--muted)]">{detail}</p>
    </div>
  );
}

function PanelTitle({ icon: Icon, title }: { icon: typeof Store; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-5 w-5 text-[var(--brand)]" aria-hidden />
      <h2 className="font-display text-xl font-semibold text-[var(--ink)]">{title}</h2>
    </div>
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

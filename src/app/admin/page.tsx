import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  PackageCheck,
  PoundSterling,
  Recycle,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { Masthead } from "@/components/ui/page";
import type { DataState } from "@/lib/domain/data-result";
import { getOperationalSnapshotV1 } from "@/lib/server/operational-snapshot";
import { requireStaffContext } from "@/lib/server/staff-context";
import { formatCurrency, formatDisplayDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ReviewCardProps = {
  icon: typeof ShoppingBag;
  title: string;
  summary: string;
  children: ReactNode;
  href: string;
  action: string;
};

export default async function AdminReviewPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const snapshot = await getOperationalSnapshotV1(branchId);

  if (!snapshot.result.data) {
    return (
      <PageFrame>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8" data-testid="owner-dashboard">
          <Masthead eyebrow="Review" title="Review the business" subtitle="A periodic view of the outcomes that matter." />
          <TruthStateBanner state={snapshot.result.state} message={snapshot.result.message} />
        </main>
      </PageFrame>
    );
  }

  const { metrics, intelligence, shopIntelligence } = snapshot.result.data;
  const expiringCertificates = intelligence.compliance.rows.filter(
    (row) => row.daysToExpiry !== null && row.daysToExpiry >= 0 && row.daysToExpiry <= 30,
  ).length;
  const missingCertificates = intelligence.compliance.rows.filter((row) => row.daysToExpiry === null).length;

  return (
    <PageFrame>
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:px-8" data-testid="owner-dashboard">
        <Masthead
          eyebrow="Review"
          title="Review the business"
          subtitle={`${shopIntelligence.weekly.rangeLabel} · Updated ${formatDisplayDate(metrics.date)}. Today remains the place for live jobs.`}
          actions={
            <Link
              href="/admin/today"
              className="inline-flex min-h-11 items-center rounded-lg bg-[var(--brand)] px-4 text-sm font-bold text-white"
            >
              Back to Today
            </Link>
          }
        />

        {snapshot.result.state !== "HEALTHY" ? (
          <TruthStateBanner state={snapshot.result.state} message={snapshot.result.message} />
        ) : null}

        <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="Business outcomes">
          <ReviewCard
            icon={PoundSterling}
            title="Sales"
            summary={shopIntelligence.weekly.revenue === null ? "Still building a reliable view" : formatCurrency(shopIntelligence.weekly.revenue)}
            href="/admin/orders"
            action="Open money and orders"
          >
            <ReviewFact label="Top product" value={shopIntelligence.weekly.topProduct ?? "No sales data yet"} />
            <ReviewFact label="Lowest performer" value={shopIntelligence.weekly.lowestProduct ?? "Not enough data"} />
            <ReviewFact label="Average customer spend" value={formatCurrency(intelligence.customers.averageOrderValue)} />
          </ReviewCard>

          <ReviewCard
            icon={PackageCheck}
            title="Stock"
            summary={`${intelligence.expiry.expiresThisWeek.length} batch${intelligence.expiry.expiresThisWeek.length === 1 ? "" : "es"} to use first`}
            href="/admin/inventory"
            action="Open stock"
          >
            <ReviewFact label="Expired" value={String(intelligence.expiry.expired.length)} />
            <ReviewFact label="Value at risk" value={formatCurrency(intelligence.expiry.valueAtRisk)} />
            <ReviewFact label="Stock lines being watched" value={String(intelligence.depletion.length)} />
          </ReviewCard>

          <ReviewCard
            icon={Recycle}
            title="Waste"
            summary={`${formatCurrency(intelligence.waste.weekValue)} recorded this week`}
            href="/admin/inventory"
            action="Open stock and waste"
          >
            <ReviewFact label="This month" value={formatCurrency(intelligence.waste.monthValue)} />
            <ReviewFact label="Biggest source" value={intelligence.waste.mostWastedProduct ?? "No waste recorded"} />
            <ReviewFact label="Weekly review" value={shopIntelligence.weekly.biggestWasteSource ?? "Nothing standing out"} />
          </ReviewCard>

          <ReviewCard
            icon={TrendingUp}
            title="Buying"
            summary={intelligence.depletion.length === 0 ? "No active stock lines need watching" : `${intelligence.depletion.length} stock line${intelligence.depletion.length === 1 ? "" : "s"} forecast`}
            href="/admin/purchasing"
            action="Open buying"
          >
            <ReviewFact label="Most frequent stock risk" value={shopIntelligence.weekly.mostFrequentStockRisk ?? "None"} />
            <ReviewFact label="Best margin line" value={intelligence.margin.best[0]?.productName ?? "Add costs to see this"} />
            <ReviewFact label="Needs price or cost data" value={String(intelligence.margin.unavailable.length)} />
          </ReviewCard>

          <ReviewCard
            icon={Users}
            title="Customers"
            summary={`${intelligence.customers.repeatCustomers} returning customer${intelligence.customers.repeatCustomers === 1 ? "" : "s"}`}
            href="/admin/orders"
            action="Open customer orders"
          >
            <ReviewFact label="First-time customers" value={String(intelligence.customers.firstTimeCustomers)} />
            <ReviewFact label="Orders analysed" value={String(intelligence.basket.realOrderCount)} />
            <ReviewFact label="Average basket" value={formatCurrency(intelligence.basket.averageBasketValue)} />
          </ReviewCard>

          <ReviewCard
            icon={AlertTriangle}
            title="Suppliers and safety"
            summary={intelligence.compliance.status}
            href="/admin/compliance"
            action="Open suppliers and safety"
          >
            <ReviewFact label="Certificates expiring soon" value={String(expiringCertificates)} />
            <ReviewFact label="Certificates missing" value={String(missingCertificates)} />
            <ReviewFact label="Weekly position" value={shopIntelligence.weekly.complianceSummary} />
          </ReviewCard>
        </section>

        {shopIntelligence.weekly.notes.length > 0 ? (
          <details className="mt-6 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
            <summary className="cursor-pointer font-display text-xl font-semibold text-[var(--ink)]">Notes behind this review</summary>
            <ul className="mt-4 grid gap-2 text-sm text-[var(--muted)]">
              {shopIntelligence.weekly.notes.map((note) => <li key={note}>• {note}</li>)}
            </ul>
          </details>
        ) : null}
      </main>
    </PageFrame>
  );
}

function ReviewCard({ icon: Icon, title, summary, children, href, action }: ReviewCardProps) {
  return (
    <article className="flex flex-col rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-50)] text-[var(--brand)] ring-1 ring-[#c5ddd0]">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold text-[var(--ink)]">{title}</h2>
          <p className="mt-1 text-sm font-bold text-[var(--brand)]">{summary}</p>
        </div>
      </div>
      <dl className="mt-5 grid gap-3">{children}</dl>
      <Link href={href} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--cream)] px-4 text-sm font-bold text-[var(--brand)]">
        {action}
      </Link>
    </article>
  );
}

function ReviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-2 text-sm last:border-0 last:pb-0">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="max-w-[60%] text-right font-bold text-[var(--ink)]">{value}</dd>
    </div>
  );
}

function TruthStateBanner({ state, message }: { state: DataState; message: string }) {
  const label: Record<DataState, string> = {
    HEALTHY: "Live data",
    NO_DATA: "No data yet",
    DEGRADED: "Some data unavailable",
    UNAVAILABLE: "Data unavailable",
    UNAUTHORISED: "Unauthorised",
    CONFIGURATION_REQUIRED: "Configuration required",
  };

  return (
    <section className="mt-6 rounded-xl border border-[#f0c66e] bg-[#fff8e6] p-4 text-sm text-[#5a3900]" data-testid="truth-state-banner">
      <p className="font-semibold">{label[state]}</p>
      <p className="mt-1 font-medium">{message}</p>
    </section>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Gauge,
  PoundSterling,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { PageFrame } from "@/components/site-header";
import type { PurchasingRecommendation, SupplierReadiness } from "@/lib/domain/purchasing-intelligence";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getPublicBranch } from "@/lib/server/catalog";
import { getPurchasingPlan, type PurchasingPlan } from "@/lib/server/purchasing-intelligence";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CONFIDENCE_LABEL: Record<PurchasingRecommendation["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export default async function PurchasingPage() {
  const profile = await getCurrentProfile();
  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  const branch = await getPublicBranch();
  const plan = await getPurchasingPlan(profile.branchId ?? branch.id);

  return (
    <PageFrame>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm font-bold text-[#0f5132]">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to dashboard
        </Link>
        <p className="mt-4 text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Purchasing &amp; Stock Planning</p>
        <h1 className="mt-2 text-3xl font-black">What should I order?</h1>
        <p className="mt-1 text-sm text-[#6c5e52]">
          Guidance only — you always decide. Every suggestion shows why, the figures behind it, and how confident it is.
          Generated {plan.generatedDate}.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-[320px_1fr]">
          <DataQualityCard plan={plan} />
          <SupplierReadinessBanner readiness={plan.supplierReadiness} />
        </div>

        <Section title="Buy more / buy less" subtitle="Backed by your sales speed and recorded waste. Waste savings come first.">
          {plan.recommendations.length === 0 ? (
            <EmptyNote text="No buying suggestions right now. Once there's enough sales and stock history, order-more and order-less guidance appears here." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {plan.recommendations.map((rec) => (
                <RecommendationCard key={rec.id} rec={rec} />
              ))}
            </div>
          )}
        </Section>

        {plan.seasonalPrep.length > 0 && (
          <Section title="Big-day preparation" subtitle="Peak trading days are coming up. Work through the checklist while there's still time to order.">
            <div className="grid gap-4 md:grid-cols-2">
              {plan.seasonalPrep.map((event) => (
                <article key={event.name} className="rounded-lg border border-[#ded6ca] bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-black">{event.name}</h3>
                    <span className="rounded-full bg-[#f7f3ed] px-2 py-0.5 text-xs font-bold text-[#6c5e52]">
                      {event.daysUntil === 0 ? "Today" : event.daysUntil === 1 ? "Tomorrow" : `${event.daysUntil} days away`}
                    </span>
                  </div>
                  {event.dateConfidence === "estimated" && (
                    <p className="mt-1 text-xs text-[#92510a]">Estimated date — confirm locally (moon-dependent).</p>
                  )}
                  <ul className="mt-3 space-y-2">
                    {event.prepTasks.map((task) => (
                      <li key={task} className="flex items-center gap-2 text-sm text-[#5c5148]">
                        <input type="checkbox" className="h-4 w-4 rounded border-[#b9ad9f] accent-[#0f5132]" aria-label={task} />
                        {task}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </Section>
        )}

        <Section title="Products needing attention" subtitle="Missing data is a bigger risk than any clever analytic. Fix these first.">
          {plan.productsNeedingAttention.length === 0 ? (
            <EmptyNote text="Every product has a price, a cost and stock information. Nothing needs attention." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plan.productsNeedingAttention.map((product) => (
                <article key={product.productName} className="rounded-lg border border-[#f0d8a8] bg-[#fdf6e9] p-4">
                  <p className="font-black">{product.productName}</p>
                  <ul className="mt-2 space-y-1">
                    {product.issues.map((issue) => (
                      <li key={issue} className="flex items-start gap-2 text-xs text-[#92510a]">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        {issue}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
          <Link href="/admin/products" className="mt-4 inline-flex text-sm font-bold text-[#0f5132]">
            Fix in Products &amp; Prices
          </Link>
        </Section>

        <Section
          title="What's making and losing money"
          subtitle="Margins use committed product cost first, then weighted active stock when a product has no cost yet."
        >
          <p className="text-sm text-[#6c5e52]">
            Margin uses committed product cost first, then falls back to the weighted cost of active stock if a product has not been costed yet.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MarginTile icon={TrendingUp} label="Most profitable" name={plan.margin.best?.productName} value={plan.margin.best?.grossProfit} />
            <MarginTile icon={TrendingDown} label="Least profitable" name={plan.margin.worst?.productName} value={plan.margin.worst?.grossProfit} />
            <MarginTile icon={PoundSterling} label="Highest revenue" name={plan.margin.highestRevenue?.productName} value={plan.margin.highestRevenue?.revenue} />
            <MarginTile
              icon={AlertTriangle}
              label="Most waste"
              name={plan.margin.highestWaste?.productName}
              value={plan.margin.highestWaste?.wasteCost}
              negative
            />
          </div>
          <Link href="/admin/cutting-guide" className="mt-4 inline-flex text-sm font-bold text-[#0f5132]">
            Work out what each cut is worth → Cutting &amp; Pricing guide
          </Link>
        </Section>
      </main>
    </PageFrame>
  );
}

function DataQualityCard({ plan }: { plan: PurchasingPlan }) {
  const { dataQuality } = plan;
  const tone =
    dataQuality.band === "high"
      ? { text: "#0f5132", bg: "#f2fbf5", border: "#bfe3cf" }
      : dataQuality.band === "medium"
        ? { text: "#92510a", bg: "#fdf6e9", border: "#f0d8a8" }
        : { text: "#b42318", bg: "#fff3f0", border: "#f0c0b8" };

  return (
    <div className="rounded-lg border p-5" style={{ borderColor: tone.border, backgroundColor: tone.bg }}>
      <div className="flex items-center gap-2">
        <Gauge className="h-5 w-5" style={{ color: tone.text }} aria-hidden />
        <h2 className="font-black">Data quality</h2>
      </div>
      <p className="mt-2 text-4xl font-black" style={{ color: tone.text }}>
        {dataQuality.score}%
      </p>
      <p className="text-xs text-[#6c5e52]">
        {dataQuality.band === "high"
          ? "Recommendations can be trusted."
          : dataQuality.band === "medium"
            ? "Suggestions shown with reduced confidence."
            : "Too much missing data — fill the gaps below to trust the guidance."}
      </p>
      <dl className="mt-3 space-y-1">
        {dataQuality.breakdown.map((row) => (
          <div key={row.label} className="flex justify-between text-xs">
            <dt className="text-[#6c5e52]">{row.label}</dt>
            <dd className="font-bold">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SupplierReadinessBanner({ readiness }: { readiness: SupplierReadiness }) {
  const ready = readiness.overall === "ready";
  const tone = ready ? { text: "#0f5132", bg: "#f2fbf5", border: "#bfe3cf" } : { text: "#92510a", bg: "#fdf6e9", border: "#f0d8a8" };

  return (
    <div className="rounded-lg border p-5" style={{ borderColor: tone.border, backgroundColor: tone.bg }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-black">Before you place an order</h2>
        <span className="rounded-full border bg-white px-3 py-1 text-sm font-black" style={{ color: tone.text, borderColor: tone.border }}>
          {ready ? "Ready to order" : "Needs review"}
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {readiness.items.map((item) => (
          <div key={item.label} className="flex items-start gap-2 rounded-md bg-white/70 p-2">
            {item.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0f5132]" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#b45309]" aria-hidden />
            )}
            <div>
              <p className="text-sm font-bold">{item.label}</p>
              <p className="text-xs leading-5 text-[#5c5148]">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: PurchasingRecommendation }) {
  const isMore = rec.kind === "order_more";
  const Icon = isMore ? TrendingUp : TrendingDown;

  return (
    <article className="rounded-lg border border-[#ded6ca] bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-[#0f5132]" aria-hidden />
          <h3 className="font-black">{rec.title}</h3>
        </div>
        <span className="rounded-full bg-[#f7f3ed] px-2 py-0.5 text-[11px] font-bold text-[#6c5e52]">
          {CONFIDENCE_LABEL[rec.confidence]}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-[#5c5148]">{rec.reason}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {rec.metrics.map((metric) => (
          <div key={metric.label} className="rounded-md bg-[#f7f3ed] p-2">
            <dt className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">{metric.label}</dt>
            <dd className="text-sm font-black">{metric.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm font-bold text-[#0f5132]">{rec.suggestedAction}</p>
      <p className="mt-2 text-[11px] text-[#8a7d70]">Generated {rec.generatedDate}</p>
    </article>
  );
}

function MarginTile({
  icon: Icon,
  label,
  name,
  value,
  negative = false,
}: {
  icon: typeof TrendingUp;
  label: string;
  name: string | undefined;
  value: number | null | undefined;
  negative?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[#ded6ca] bg-white p-4">
      <Icon className="h-5 w-5 text-[#0f5132]" aria-hidden />
      <p className="mt-2 text-xs font-bold uppercase tracking-[0.06em] text-[#6c5e52]">{label}</p>
      <p className="mt-1 font-black">{name ?? "Not enough data"}</p>
      <p className={negative ? "text-sm font-bold text-[#b42318]" : "text-sm font-bold text-[#0f5132]"}>
        {value === null || value === undefined ? "Margin unavailable until a cost source exists" : formatCurrency(value)}
      </p>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-black">{title}</h2>
      <p className="mt-1 text-sm text-[#6c5e52]">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="rounded-lg border border-[#ded6ca] bg-white p-5 text-sm text-[#6c5e52]">{text}</p>;
}

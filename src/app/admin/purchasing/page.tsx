import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { ActionContext } from "@/components/owner-brain/action-context";
import { PageFrame } from "@/components/site-header";
import type { PurchasingRecommendation, SupplierReadiness } from "@/lib/domain/purchasing-intelligence";
import { getPurchasingPlan, type PurchasingPlan } from "@/lib/server/purchasing-intelligence";
import { requireStaffContext } from "@/lib/server/staff-context";
import { cn, firstParam } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Slug ↔ name, mirrors the slug used to build the operator-action id (operator-guidance). */
function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const plan = await getPurchasingPlan(branchId);
  const sp = await searchParams;
  const focus = firstParam(sp.focus);

  return (
    <PageFrame>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <ActionContext from={firstParam(sp.from)} doParam={firstParam(sp.do)} focus={focus} why={firstParam(sp.why)} />

        <Link href="/admin" className="inline-flex items-center gap-1 text-sm font-bold text-[#0f5132]">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to dashboard
        </Link>
        <p className="mt-4 text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Purchasing &amp; Stock Planning</p>
        <h1 className="mt-2 text-3xl font-black">What should I order?</h1>
        <p className="mt-1 text-sm text-[#6c5e52]">
          Only items that need a decision are shown here. Generated {plan.generatedDate}.
        </p>
        <p className="mt-2 rounded-md border border-[#bfe3cf] bg-[#f2fbf5] px-3 py-2 text-xs font-semibold text-[#0f5132]" data-testid="stock-honesty-stamp">
          Collected orders are already taken off stock.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-[320px_1fr]">
          <OrderReadinessCard plan={plan} />
          <SupplierReadinessBanner readiness={plan.supplierReadiness} />
        </div>

        <Section title="Order guidance" subtitle="Do these before you call your supplier.">
          {plan.recommendations.length === 0 ? (
            <EmptyNote text="No need to order yet." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {plan.recommendations.map((rec) => (
                <RecommendationCard key={rec.id} rec={rec} focused={focus !== undefined && slug(rec.productName) === focus} />
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

        <Section title="Check these before ordering" subtitle="Quick fixes that make the order advice cleaner.">
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

      </main>
    </PageFrame>
  );
}

function OrderReadinessCard({ plan }: { plan: PurchasingPlan }) {
  const hasAttention = plan.productsNeedingAttention.length > 0 || plan.supplierReadiness.overall === "needs_review";
  const hasOrders = plan.recommendations.length > 0;
  const status = hasAttention ? "Needs Attention" : hasOrders ? "Check Soon" : "Healthy";
  const tone =
    status === "Healthy"
      ? { text: "#0f5132", bg: "#f2fbf5", border: "#bfe3cf" }
      : status === "Check Soon"
        ? { text: "#92510a", bg: "#fdf6e9", border: "#f0d8a8" }
        : { text: "#b42318", bg: "#fff3f0", border: "#f0c0b8" };

  return (
    <div className="rounded-lg border p-5" style={{ borderColor: tone.border, backgroundColor: tone.bg }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-black">Before you order</h2>
        <span className="rounded-full border bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.06em]" style={{ color: tone.text, borderColor: tone.border }}>
          {status}
        </span>
      </div>
      <p className="mt-3 text-sm font-semibold text-[#5c5148]" data-testid="order-readiness-note">
        {status === "Healthy"
          ? "No need to order yet."
          : status === "Check Soon"
            ? "A few items need a buying decision."
            : "Check the highlighted items before ordering."}
      </p>
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

function RecommendationCard({ rec, focused = false }: { rec: PurchasingRecommendation; focused?: boolean }) {
  const isMore = rec.kind === "order_more";
  const Icon = isMore ? TrendingUp : TrendingDown;

  return (
    <article
      id={slug(rec.productName)}
      className={cn(
        "scroll-mt-24 rounded-lg border bg-white p-4",
        focused ? "border-[#0f5132] ring-2 ring-[#0f5132]/40" : "border-[#ded6ca]",
      )}
      data-focused={focused ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-[#0f5132]" aria-hidden />
          <h3 className="font-black">{rec.title}</h3>
        </div>
        <span className="rounded-full bg-[#f2fbf5] px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.06em] text-[#0f5132]">
          {rec.operatorActionLabel}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-[#5c5148]">{rec.reason}</p>
      {rec.operatorDetail && <p className="mt-2 text-sm font-semibold text-[#6c5e52]">{rec.operatorDetail}</p>}
      <p className="mt-3 text-sm font-bold text-[#0f5132]">{rec.suggestedAction}</p>
    </article>
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

import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CalendarOff,
  ClipboardList,
  FileClock,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  PackageCheck,
  PackageSearch,
  PoundSterling,
  Recycle,
  Scissors,
  Settings,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";

import { BusinessInsightsSections } from "@/components/admin/business-insights";
import { PageFrame } from "@/components/site-header";
import type { DataState } from "@/lib/domain/data-result";
import type { DashboardMetrics } from "@/lib/server/dashboard";
import type { OpsIntelligence } from "@/lib/server/operations-intelligence";
import { getOperationalSnapshotV1 } from "@/lib/server/operational-snapshot";
import { requireStaffContext } from "@/lib/server/staff-context";
import { formatCurrency, formatDisplayDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

// V11.3 — "One door per job". /admin is the SINGLE analysis hub ("Business Insights",
// a.k.a. Review Business): historical analysis only. Daily operations (what needs
// attention, what to do today, the morning walk, setup) live on Today. The counter
// is /counter. There is no longer a counter-service mode or a launch-readiness card
// here, and no duplicate "what needs fixing" operational board.

type InsightPanel = {
  icon: typeof ShoppingBag;
  title: string;
  summary: string;
  content: ReactNode;
};

type ToolLink = { href: string; label: string; detail: string; icon: typeof ShoppingBag; ownerOnly?: boolean };

const analysisToolLinks = [
  { href: "/admin/purchasing", label: "What should I buy next?", detail: "Stock to order before you call your supplier", icon: TrendingUp },
  { href: "/admin/cutting-guide", label: "Cutting & Pricing", detail: "What a whole animal is worth & what to charge", icon: Scissors },
  { href: "/admin/products", label: "Products & Prices", detail: "What you sell and what it costs", icon: PackageSearch },
  { href: "/admin/inventory", label: "What stock do I have?", detail: "What's in, what's going off", icon: PackageCheck },
  { href: "/admin/orders", label: "Order history", detail: "Past orders, search and exceptions", icon: ShoppingBag },
  { href: "/admin/compliance", label: "Supplier Certificates", detail: "Halal and food-safety paperwork", icon: ClipboardList },
  { href: "/admin/settings", label: "Shop Settings", detail: "Shop details and customer texts", icon: Settings },
] as const;

const moreToolLinks: ToolLink[] = [
  { href: "/admin/pickup-windows", label: "Collection Times", detail: "Time slots customers can choose", icon: ClipboardList },
  { href: "/admin/shop-closures", label: "Closed Days", detail: "Holidays and days the shop is shut", icon: CalendarOff },
  { href: "/admin/audit", label: "Activity History", detail: "Every change — who did it and when", icon: FileClock, ownerOnly: true },
  { href: "/admin/releases", label: "System Checks", detail: "Technical checks for support — safe to skip", icon: ClipboardList, ownerOnly: true },
];

export default async function AdminPage() {
  const { profile, branchId } = await requireStaffContext("manager", { branchScoped: true });
  const snapshot = await getOperationalSnapshotV1(branchId);
  if (!snapshot.result.data) {
    return (
      <PageFrame>
        <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="owner-dashboard">
          <TruthStateBanner state={snapshot.result.state} message={snapshot.result.message} />
        </main>
      </PageFrame>
    );
  }

  const { metrics, intelligence, shopIntelligence: intel } = snapshot.result.data;

  const insightPanels = buildInsightPanels(metrics, intelligence);

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="owner-dashboard">
        <header className="flex flex-col gap-4 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Business Insights</p>
            <h1 className="mt-2 text-3xl font-black">Review the business</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6c5e52]">
              Historical analysis — money, stock, waste, margin, customers and certificates. For today&apos;s jobs, use Today.
            </p>
            <p className="mt-2 text-sm font-semibold text-[#0f5132]">{formatDisplayDate(metrics.date)}</p>
          </div>
          <Link
            href="/admin/today"
            className="inline-flex h-11 items-center rounded-full bg-[#0f5132] px-4 text-sm font-bold text-white transition hover:bg-[#0c3f27]"
          >
            Back to Today
          </Link>
        </header>

        {snapshot.result.state !== "HEALTHY" && <TruthStateBanner state={snapshot.result.state} message={snapshot.result.message} />}

        <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" aria-label="Business snapshot">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Shop numbers</p>
            <h2 className="mt-1 text-xl font-black">What happened today?</h2>
            <p className="mt-1 text-sm text-[#6c5e52]">Money, waste, stock risk and certificates.</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SnapshotStat label="Orders today" value={String(metrics.orderCount)} testid="metric-order-count" />
            <SnapshotStat label="Revenue today" value={formatCurrency(metrics.estimatedRevenue)} testid="metric-revenue" />
            <SnapshotStat label="Waste this week" value={formatCurrency(intelligence.waste.weekValue)} testid="metric-waste-week" />
            <SnapshotStat label="Stock to use first" value={formatCurrency(metrics.stockValueAtRisk)} testid="metric-stock-risk" />
            <SnapshotStat label="Certificates expiring" value={String(metrics.expiringCertificates)} testid="metric-expiring-certificates" />
          </div>
        </section>

        {/* Shop-intelligence analysis migrated from the retired Briefing. */}
        <BusinessInsightsSections intel={intel} />

        <section id="business-insights" className="mt-6" aria-label="Business insights">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">The detail</p>
            <h2 className="mt-1 text-xl font-black">What should I watch?</h2>
            <p className="mt-1 text-sm text-[#6c5e52]">Stock, buying, margin, waste, customers and certificates.</p>
          </div>

          <div className="mt-4 grid gap-4 lg:hidden">
            {insightPanels.map((panel) => (
              <details key={panel.title} className="group rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <panel.icon className="h-5 w-5 text-[#0f5132]" aria-hidden />
                    <div>
                      <p className="text-sm font-black">{panel.title}</p>
                      <p className="mt-0.5 text-xs text-[#6c5e52]">{panel.summary}</p>
                    </div>
                  </div>
                  <span className="text-sm font-black text-[#0f5132] transition group-open:rotate-180">v</span>
                </summary>
                <div className="mt-4 border-t border-[#eee4d8] pt-4">{panel.content}</div>
              </details>
            ))}
          </div>

          <div className="mt-4 hidden gap-4 lg:grid xl:grid-cols-3">
            {insightPanels.map((panel) => (
              <IntelligencePanel key={panel.title} icon={panel.icon} title={panel.title}>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">{panel.summary}</p>
                <div className="mt-4">{panel.content}</div>
              </IntelligencePanel>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" aria-label="Analysis tools">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Dig deeper</p>
            <h2 className="mt-1 text-xl font-black">Analysis tools</h2>
            <p className="mt-1 text-sm text-[#6c5e52]">Buying, pricing, products, stock and history.</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {analysisToolLinks.map((item) => (
              <QuickActionCard key={item.href} {...item} />
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" aria-label="More tools">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">More tools</p>
            <h2 className="mt-1 text-xl font-black">Admin links</h2>
            <p className="mt-1 text-sm text-[#6c5e52]">The rest of the admin surface stays one tap away.</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {moreToolLinks
              .filter((item) => !item.ownerOnly || profile.role === "owner")
              .map((item) => (
                <QuickActionCard key={item.href} href={item.href} label={item.label} detail={item.detail} icon={item.icon} />
              ))}
          </div>
        </section>
      </main>

      <MobileActionBar />
    </PageFrame>
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
    <section className="mt-4 rounded-xl border border-[#f0c66e] bg-[#fff8e6] p-4 text-sm text-[#5a3900]" data-testid="truth-state-banner">
      <p className="font-black">{label[state]}</p>
      <p className="mt-1 font-semibold">{message}</p>
    </section>
  );
}

function buildInsightPanels(
  metrics: DashboardMetrics,
  intelligence: OpsIntelligence,
): InsightPanel[] {
  return [
    {
      icon: PackageCheck,
      title: "What expires soon?",
      summary: `${intelligence.expiry.expiresThisWeek.length} batches at risk`,
      content: (
        <>
          <StatLine label="Expires today" value={String(intelligence.expiry.expiresToday.length)} />
          <StatLine label="Expires this week" value={String(intelligence.expiry.expiresThisWeek.length)} />
          <StatLine label="Expired" value={String(intelligence.expiry.expired.length)} />
          <StatLine label="Value at risk" value={formatCurrency(intelligence.expiry.valueAtRisk)} />
          {intelligence.expiry.expiresThisWeek.slice(0, 3).map((item) => (
            <p key={`${item.productName}-${item.expiryDate}`} className="mt-3 text-sm text-[#5c5148]">
              <strong>{item.productName}</strong> - {item.remainingWeightKg.toFixed(3)}kg -{" "}
              {formatCurrency(item.valueAtRisk)} at risk -{" "}
              {item.daysToExpiry < 0 ? "Expired" : item.daysToExpiry === 0 ? "Expires today" : `Expires in ${item.daysToExpiry} days`}
            </p>
          ))}
        </>
      ),
    },
    {
      icon: Recycle,
      title: "What am I losing money on?",
      summary: `${formatCurrency(intelligence.waste.weekValue)} this week`,
      content: (
        <>
          <StatLine label="Most wasted product" value={intelligence.waste.mostWastedProduct ?? "No waste recorded"} />
          <StatLine label="Waste this week" value={formatCurrency(intelligence.waste.weekValue)} />
          <StatLine label="Waste this month" value={formatCurrency(intelligence.waste.monthValue)} />
          {intelligence.waste.byReason.slice(0, 4).map((reason) => (
            <StatLine key={reason.label} label={reason.label} value={formatCurrency(reason.value)} />
          ))}
        </>
      ),
    },
    {
      icon: PoundSterling,
      title: "What money can I make?",
      summary: metrics.configured ? "Live margin snapshot" : "Database not configured",
      content: (
        <>
          <StatLine label="Revenue" value={formatCurrency(intelligence.financial.revenue)} />
          <StatLine label="Inventory cost" value={formatNullableCurrency(intelligence.financial.inventoryCost)} />
          <StatLine label="Waste cost" value={formatCurrency(intelligence.financial.wasteCost)} />
          <StatLine label="Estimated gross profit" value={formatNullableCurrency(intelligence.financial.estimatedGrossProfit)} />
          {intelligence.financial.unavailableReason && (
            <p className="mt-3 text-sm font-bold text-[#7a271a]">{intelligence.financial.unavailableReason}</p>
          )}
        </>
      ),
    },
    {
      icon: TrendingUp,
      title: "What makes me money?",
      summary: "Profit, waste, and margin",
      content: (
        <>
          <StatLine label="Most profitable product" value={intelligence.margin.best[0]?.productName ?? "Margin unavailable"} />
          <StatLine label="Least profitable product" value={intelligence.margin.worst[0]?.productName ?? "Margin unavailable"} />
          <StatLine label="Product causing most waste" value={intelligence.margin.highestWasteDrag?.productName ?? "No waste recorded"} />
          <StatLine label="Total estimated profit" value={formatNullableCurrency(intelligence.financial.estimatedGrossProfit)} />
          <StatLine label="Total estimated waste cost" value={formatCurrency(intelligence.financial.wasteCost)} />
          {intelligence.margin.unavailable.slice(0, 2).map((product) => (
            <p key={`unavailable-${product.productName}`} className="mt-3 text-sm text-[#7a271a]">
              <strong>{product.productName}</strong>: {product.marginUnavailableReason}
            </p>
          ))}
        </>
      ),
    },
    {
      icon: PackageCheck,
      title: "What stock do I have?",
      summary: `Expected demand on ${intelligence.depletion.length} stock line${intelligence.depletion.length === 1 ? "" : "s"}`,
      content: (
        <>
          {intelligence.depletion.length === 0 ? (
            <p className="text-sm text-[#6c5e52]">No active stock to check.</p>
          ) : (
            intelligence.depletion.slice(0, 5).map((row) => (
              <p key={row.batchId} className="mt-3 text-sm text-[#5c5148]">
                <strong>{row.productName}</strong> - {row.message}
                {row.state === "enough_data" ? " Suggested action: Consider ordering more stock." : ""}
              </p>
            ))
          )}
        </>
      ),
    },
    {
      icon: Users,
      title: "Customer Loyalty",
      summary: `${intelligence.customers.repeatRate}% repeat rate`,
      content: (
        <>
          <StatLine label="First time customers" value={String(intelligence.customers.firstTimeCustomers)} />
          <StatLine label="Returning customers" value={String(intelligence.customers.repeatCustomers)} />
          <StatLine label="Repeat customer rate" value={`${intelligence.customers.repeatRate}%`} />
          <StatLine label="Average spend per customer" value={formatCurrency(intelligence.customers.averageOrderValue)} />
          {intelligence.customers.topCustomers.slice(0, 3).map((customer) => (
            <p key={customer.customerPhone} className="mt-3 text-sm text-[#5c5148]">
              <strong>{customer.customerName}</strong>
              <br />
              {formatCurrency(customer.spend)} spent
              <br />
              Last order: {new Date(customer.lastOrder).toLocaleDateString("en-GB")}
            </p>
          ))}
        </>
      ),
    },
    {
      icon: ShoppingBag,
      title: "What Customers Buy Together",
      summary: `${intelligence.basket.realOrderCount} orders analysed`,
      content: (
        <>
          <StatLine label="Real orders analysed" value={String(intelligence.basket.realOrderCount)} />
          <StatLine label="Average basket value" value={formatCurrency(intelligence.basket.averageBasketValue)} />
          {intelligence.basket.bundleSuggestion ? (
            <p className="mt-3 text-sm font-bold text-[#0f5132]">{intelligence.basket.bundleSuggestion}</p>
          ) : (
            <p className="mt-3 text-sm text-[#6c5e52]">{intelligence.basket.message}</p>
          )}
          {intelligence.basket.topPairings.slice(0, 3).map((pairing) => (
            <StatLine
              key={`${pairing.productA}-${pairing.productB}`}
              label={`${pairing.productA} + ${pairing.productB}`}
              value={`${pairing.count} orders`}
            />
          ))}
        </>
      ),
    },
    {
      icon: AlertTriangle,
      title: "What certificates expire soon?",
      summary: intelligence.compliance.status,
      content: (
        <>
          <StatLine label="Status" value={intelligence.compliance.status} />
          <StatLine
            label="Certificates expiring soon"
            value={String(
              intelligence.compliance.rows.filter(
                (row) => row.daysToExpiry !== null && row.daysToExpiry >= 0 && row.daysToExpiry <= 30,
              ).length,
            )}
          />
          <StatLine
            label="Certificates expired"
            value={String(intelligence.compliance.rows.filter((row) => row.daysToExpiry !== null && row.daysToExpiry < 0).length)}
          />
          <StatLine
            label="Missing certificates"
            value={String(intelligence.compliance.rows.filter((row) => row.daysToExpiry === null).length)}
          />
          {intelligence.compliance.rows.slice(0, 4).map((supplier) => (
            <StatLine
              key={supplier.supplierName}
              label={supplier.supplierName}
              value={
                supplier.daysToExpiry === null
                  ? "Missing"
                  : supplier.daysToExpiry < 0
                    ? "Expired"
                    : `${supplier.daysToExpiry} days remaining`
              }
            />
          ))}
          {intelligence.compliance.rows.some((row) => row.daysToExpiry === null || row.daysToExpiry <= 30) && (
            <p className="mt-3 text-sm font-bold text-[#0f5132]">Required action: contact supplier and upload updated certificate.</p>
          )}
        </>
      ),
    },
    {
      icon: FlaskConical,
      title: "Product Performance",
      summary: "Best and worst movers",
      content: (
        <>
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Best performers</p>
          {intelligence.productPerformance.best.slice(0, 3).map((product) => (
            <StatLine key={`best-${product.productName}`} label={product.productName} value={formatNullableCurrency(product.grossProfit)} />
          ))}
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Worst performers</p>
          {intelligence.productPerformance.worst.slice(0, 3).map((product) => (
            <StatLine key={`worst-${product.productName}`} label={product.productName} value={formatNullableCurrency(product.grossProfit)} />
          ))}
        </>
      ),
    },
  ];
}

function SnapshotStat({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div className="rounded-xl bg-[#f7f3ed] p-4">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">{label}</p>
      <p className="mt-1 text-lg font-black" data-testid={testid}>
        {value}
      </p>
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 flex items-start justify-between gap-3 text-sm">
      <span className="text-[#6c5e52]">{label}</span>
      <strong className="text-right">{value}</strong>
    </div>
  );
}

function QuickActionCard({
  icon: Icon,
  label,
  detail,
  href,
}: {
  icon: typeof ShoppingBag;
  label: string;
  detail: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-28 flex-col rounded-2xl border border-[#ded6ca] bg-[#fbfaf7] p-4 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
    >
      <Icon className="h-5 w-5 text-[#0f5132]" aria-hidden />
      <p className="mt-4 text-lg font-black">{label}</p>
      <p className="mt-1 text-sm text-[#6c5e52]">{detail}</p>
    </Link>
  );
}

function IntelligencePanel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ShoppingBag;
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
      <Icon className="h-5 w-5 text-[#0f5132]" aria-hidden />
      <h3 className="mt-3 text-lg font-black">{title}</h3>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function MobileActionBar() {
  const links = [
    { href: "/admin/today", label: "Today", icon: ListChecks },
    { href: "/counter", label: "Counter", icon: LayoutDashboard },
    { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
    { href: "/admin/inventory", label: "Inventory", icon: PackageCheck },
  ] as const;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#ded6ca] bg-[#fbfaf7]/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-4 gap-2">
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex min-h-16 flex-col items-center justify-center rounded-2xl border border-[#ded6ca] bg-white text-center text-[11px] font-black uppercase tracking-[0.08em] text-[#0f5132] shadow-sm"
          >
            <item.icon className="h-4 w-4" aria-hidden />
            <span className="mt-1">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

function formatNullableCurrency(value: number | null) {
  return value === null ? "Add a cost to see profit" : formatCurrency(value);
}

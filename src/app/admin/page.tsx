import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CalendarOff,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileClock,
  FlaskConical,
  Gauge,
  MessageSquareWarning,
  PackageCheck,
  PackageSearch,
  PoundSterling,
  Recycle,
  Rocket,
  ShieldAlert,
  Settings,
  ShoppingBag,
  Sun,
  TrendingUp,
  Users,
} from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { LAUNCH_OVERALL_LABEL, type LaunchItem, type LaunchReadiness } from "@/lib/domain/launch-readiness";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getPublicBranch } from "@/lib/server/catalog";
import { getDashboardMetrics } from "@/lib/server/dashboard";
import { getLaunchReadiness } from "@/lib/server/launch-readiness";
import { getOperationsIntelligence } from "@/lib/server/operations-intelligence";
import { cn, formatCurrency, formatDisplayDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const adminLinks = [
  { href: "/admin/purchasing", label: "Purchasing & Stock Planning", detail: "What to order, what to order less of, before you call your supplier", icon: TrendingUp },
  { href: "/admin/products", label: "Products & Prices", detail: "Add or edit what you sell and what it costs", icon: PackageSearch },
  { href: "/admin/orders", label: "Orders", detail: "Every order customers have placed", icon: ShoppingBag },
  { href: "/admin/pickup-windows", label: "Collection Times", detail: "The time slots customers can collect in", icon: ClipboardList },
  { href: "/admin/shop-closures", label: "Closed Days", detail: "Holidays and days the shop is shut", icon: CalendarOff },
  { href: "/admin/compliance", label: "Supplier Certificates", detail: "Halal and food-safety paperwork", icon: ClipboardList },
  { href: "/admin/inventory", label: "Stock & Waste", detail: "What's in, what's going off, what was binned", icon: PackageCheck },
  { href: "/admin/settings", label: "Shop Settings", detail: "Shop details and customer text messages", icon: Settings },
  { href: "/admin/audit", label: "Activity History", detail: "Every change — who did it and when", icon: FileClock, ownerOnly: true },
  { href: "/admin/releases", label: "System Checks", detail: "Technical checks for your support team — safe to skip", icon: ClipboardList, ownerOnly: true },
];

export default async function AdminPage() {
  const profile = await getCurrentProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  const branch = await getPublicBranch();
  const branchId = profile.branchId ?? branch.id;
  const [metrics, intelligence] = await Promise.all([
    getDashboardMetrics(branchId),
    getOperationsIntelligence(branchId),
  ]);
  const launch = await getLaunchReadiness(branchId, metrics);
  const actionGroups = [
    { key: "urgent", title: "Urgent" },
    { key: "money_saving", title: "Money-saving" },
    { key: "stock", title: "Stock" },
    { key: "compliance", title: "Compliance" },
    { key: "customer_growth", title: "Customer growth" },
  ] as const;
  const quickWins = [
    {
      label: "Potential saving",
      value:
        intelligence.waste.weekValue > 0
          ? `${formatCurrency(intelligence.waste.weekValue)} waste reduction opportunity`
          : "No recorded waste saving this week",
    },
    {
      label: "Potential revenue",
      value:
        intelligence.customers.firstTimeCustomers > 0
          ? `${intelligence.customers.firstTimeCustomers} first-time customers not yet returned`
          : "No first-time customer follow-up due",
    },
    {
      label: "Potential stock risk",
      value:
        intelligence.expiry.valueAtRisk > 0
          ? `${formatCurrency(intelligence.expiry.valueAtRisk)} inventory at risk`
          : "No inventory value currently at risk",
    },
  ];

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Your shop</p>
        <h1 className="mt-2 text-3xl font-black">Owner Dashboard</h1>

        <LaunchReadinessCard launch={launch} />

        <section className="mt-6 rounded-lg border border-[#ded6ca] bg-white p-5" aria-label="Morning briefing">
          <div className="flex items-center gap-3">
            <Sun className="h-6 w-6 text-[#0f5132]" aria-hidden />
            <div>
              <h2 className="text-xl font-black">Good Morning</h2>
              <p className="text-sm text-[#6c5e52]">One-screen owner briefing before the counter gets busy.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <BriefingLine label="Orders awaiting prep" value={String(metrics.awaitingPrep)} />
            <BriefingLine label="Expiring batches" value={String(intelligence.morning.expiringBatches)} />
            <BriefingLine label="Certificates expiring" value={String(intelligence.morning.certificatesExpiring)} />
            <BriefingLine label="Waste yesterday" value={formatCurrency(intelligence.morning.wasteYesterday)} />
            <BriefingLine label="Revenue yesterday" value={formatCurrency(intelligence.morning.revenueYesterday)} />
            <BriefingLine label="Top product" value={intelligence.morning.topProduct} />
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-3" aria-label="Daily routine">
          <ChecklistPanel
            title="Opening Checklist"
            items={["Counter online", "Certificates checked", "No stock expiring today", "Orders reviewed", "Waste recorded"]}
          />
          <ChecklistPanel
            title="Closing Checklist"
            items={["Orders completed", "Waste recorded", "Stock checked", "Tomorrow's risk reviewed", "Counter closed"]}
          />
          <article className="rounded-lg border border-[#ded6ca] bg-white p-5">
            <h2 className="font-black">Quick Wins</h2>
            <div className="mt-4 space-y-3">
              {quickWins.map((win) => (
                <QuickWin key={win.label} label={win.label} value={win.value} />
              ))}
            </div>
          </article>
        </section>

        {intelligence.dataState.status === "error" && (
          <section className="mt-6 rounded-lg border border-[#b42318] bg-[#fff3f0] p-5" aria-label="Some figures could not load">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-[#b42318]" aria-hidden />
              <div>
                <h2 className="font-black text-[#7a271a]">Some figures couldn&apos;t load</h2>
                <p className="mt-1 text-sm leading-6 text-[#7a271a]">{intelligence.dataState.message}</p>
              </div>
            </div>
          </section>
        )}

        <section className="mt-6 rounded-lg border border-[#ded6ca] bg-white p-5" aria-label="Today's Actions">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Today&apos;s Actions</p>
            <h2 className="mt-1 text-xl font-black">Owner Task List</h2>
            <p className="mt-1 text-sm text-[#6c5e52]">Plain-English actions backed by live shop data.</p>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-5">
            {actionGroups.map((group) => {
              const actions = intelligence.actions.filter((action) => action.group === group.key);
              return (
                <div key={group.key} className="rounded-md bg-[#f7f3ed] p-3">
                  <h3 className="text-sm font-black">{group.title}</h3>
                  <div className="mt-3 space-y-3">
                    {actions.length === 0 ? (
                      <p className="text-sm text-[#6c5e52]">No action needed right now.</p>
                    ) : (
                      actions.map((action) => <OwnerActionCard key={action.id} action={action} />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-6" data-testid="owner-dashboard" aria-label="Today's operational summary">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-black">Today - {formatDisplayDate(metrics.date)}</h2>
            {!metrics.configured && (
              <span className="text-sm text-[#6c5e52]">Live metrics unavailable (database not configured)</span>
            )}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              icon={ShoppingBag}
              label="Orders today"
              value={String(metrics.orderCount)}
              testid="metric-order-count"
            />
            <MetricCard
              icon={ClipboardList}
              label="Awaiting prep"
              value={String(metrics.awaitingPrep)}
              testid="metric-awaiting-prep"
            />
            <MetricCard icon={ClipboardList} label="Ready" value={String(metrics.readyCount)} testid="metric-ready" />
            <MetricCard
              icon={PoundSterling}
              label="Estimated revenue today"
              value={formatCurrency(metrics.estimatedRevenue)}
              testid="metric-revenue"
            />
            <MetricCard
              icon={MessageSquareWarning}
              label="Texts that didn't send"
              value={String(metrics.failedSmsCount)}
              testid="metric-failed-sms"
              hint="Orders still work fine even when texts are off or fail"
            />
            <MetricCard
              icon={FlaskConical}
              label="Practice orders today"
              value={String(metrics.testOrderCount)}
              testid="metric-test-orders"
              hint="Trial orders for training — not counted in sales or takings"
            />
            <MetricCard
              icon={Gauge}
              label="Counter screen"
              value={metrics.realtimeMode === "websocket" ? "Updating live" : metrics.realtimeMode === "polling" ? "Checking regularly" : "Needs a look"}
              testid="metric-realtime-mode"
              hint="Open the Counter page to confirm orders are coming through"
            />
            <MetricCard
              icon={PackageCheck}
              label="Items binned this week"
              value={String(metrics.wasteEventsThisWeek)}
              testid="metric-waste-week"
              hint="Stock recorded as waste"
            />
            <MetricCard
              icon={PackageCheck}
              label="Stock going off soon"
              value={String(metrics.expiringBatchCount)}
              testid="metric-expiring-batches"
              hint="Stock that will expire within 3 days"
            />
            <MetricCard
              icon={ShieldAlert}
              label="Certificates running out"
              value={String(metrics.expiringCertificates)}
              testid="metric-expiring-certificates"
              hint="Supplier certificates expiring within 30 days"
            />
          </div>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-3" aria-label="Action needed">
          <ActionPanel
            icon={PackageCheck}
            title="Stock risk"
            body={
              metrics.inventoryConfigured
                ? `${metrics.batchesExpiringWithin3Days} batches expiring within 3 days. ${formatCurrency(metrics.stockValueAtRisk)} estimated value at risk.`
                : "Action required: receive your first inventory batch to enable expiry and waste tracking."
            }
            href="/admin/inventory"
          />
          <ActionPanel
            icon={ShieldAlert}
            title="Compliance risk"
            body={
              metrics.certificateRecordsConfigured
                ? `${metrics.expiredCertificates} expired, ${metrics.expiringCertificates} expiring within 30 days, ${metrics.missingCertificates} missing verification.`
                : "Action required: record supplier certificates before making customer trust claims."
            }
            href="/admin/compliance"
          />
          <ActionPanel
            icon={MessageSquareWarning}
            title="Text Messages"
            body={`${metrics.failedSmsCount} customer text${metrics.failedSmsCount === 1 ? "" : "s"} didn't send today. Texts are a nice-to-have — taking orders, the counter, and collections all work perfectly without them.`}
            href="/admin/settings"
          />
        </section>

        <section className="mt-8 grid gap-4 xl:grid-cols-3" aria-label="Operations intelligence">
          <IntelligencePanel icon={PackageCheck} title="What's Going Off Soon">
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
          </IntelligencePanel>

          <IntelligencePanel icon={Recycle} title="Where Money's Being Lost">
            <StatLine label="Most wasted product" value={intelligence.waste.mostWastedProduct ?? "No waste recorded"} />
            <StatLine label="Waste this week" value={formatCurrency(intelligence.waste.weekValue)} />
            <StatLine label="Waste this month" value={formatCurrency(intelligence.waste.monthValue)} />
            {intelligence.waste.byReason.slice(0, 4).map((reason) => (
              <StatLine key={reason.label} label={reason.label} value={formatCurrency(reason.value)} />
            ))}
          </IntelligencePanel>

          <IntelligencePanel icon={PoundSterling} title="Daily Profit Estimate">
            <StatLine label="Revenue" value={formatCurrency(intelligence.financial.revenue)} />
            <StatLine label="Inventory cost" value={formatNullableCurrency(intelligence.financial.inventoryCost)} />
            <StatLine label="Waste cost" value={formatCurrency(intelligence.financial.wasteCost)} />
            <StatLine label="Estimated gross profit" value={formatNullableCurrency(intelligence.financial.estimatedGrossProfit)} />
            {intelligence.financial.unavailableReason && (
              <p className="mt-3 text-sm font-bold text-[#7a271a]">{intelligence.financial.unavailableReason}</p>
            )}
          </IntelligencePanel>
        </section>

        <section className="mt-8 grid gap-4 xl:grid-cols-3" aria-label="Business intelligence">
          <IntelligencePanel icon={TrendingUp} title="Profit & Loss">
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
          </IntelligencePanel>

          <IntelligencePanel icon={PackageCheck} title="Stock Running Low">
            {intelligence.depletion.length === 0 ? (
              <p className="text-sm text-[#6c5e52]">No active stock to forecast.</p>
            ) : (
              intelligence.depletion.slice(0, 5).map((row) => (
                <p key={row.batchId} className="mt-3 text-sm text-[#5c5148]">
                  <strong>{row.productName}</strong> - {row.message}
                  {row.state === "enough_data" ? " Suggested action: Consider ordering more stock." : ""}
                </p>
              ))
            )}
          </IntelligencePanel>

          <IntelligencePanel icon={Users} title="Customer Loyalty">
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
          </IntelligencePanel>
        </section>

        <section className="mt-8 grid gap-4 xl:grid-cols-3" aria-label="Growth and compliance intelligence">
          <IntelligencePanel icon={ShoppingBag} title="What Customers Buy Together">
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
          </IntelligencePanel>

          <IntelligencePanel icon={ShieldAlert} title="Food Compliance">
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
          </IntelligencePanel>

          <IntelligencePanel icon={TrendingUp} title="Product Performance">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Best performers</p>
            {intelligence.productPerformance.best.slice(0, 3).map((product) => (
              <StatLine key={`best-${product.productName}`} label={product.productName} value={formatNullableCurrency(product.grossProfit)} />
            ))}
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">Worst performers</p>
            {intelligence.productPerformance.worst.slice(0, 3).map((product) => (
              <StatLine key={`worst-${product.productName}`} label={product.productName} value={formatNullableCurrency(product.grossProfit)} />
            ))}
          </IntelligencePanel>
        </section>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {adminLinks
            .filter((item) => !("ownerOnly" in item && item.ownerOnly) || profile.role === "owner")
            .map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border border-[#ded6ca] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <item.icon className="h-6 w-6 text-[#0f5132]" aria-hidden />
              <p className="mt-4 text-lg font-black">{item.label}</p>
              <p className="mt-1 text-sm text-[#6c5e52]">{item.detail}</p>
            </Link>
          ))}
        </div>
      </main>
    </PageFrame>
  );
}

function LaunchReadinessCard({ launch }: { launch: LaunchReadiness }) {
  const overallTone =
    launch.overall === "ready"
      ? { border: "#bfe3cf", bg: "#f2fbf5", text: "#0f5132" }
      : launch.overall === "attention"
        ? { border: "#f0d8a8", bg: "#fdf6e9", text: "#92510a" }
        : { border: "#ded6ca", bg: "#f7f3ed", text: "#6c5e52" };

  return (
    <section
      className="mt-6 rounded-lg border p-5"
      style={{ borderColor: overallTone.border, backgroundColor: overallTone.bg }}
      aria-label="Launch readiness"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Rocket className="h-6 w-6" style={{ color: overallTone.text }} aria-hidden />
          <div>
            <h2 className="text-xl font-black">Launch Readiness</h2>
            <p className="text-sm text-[#6c5e52]">
              {launch.readyCount} of {launch.autoCheckedCount} checks ready. The app only ticks what it can actually see —
              the last two are for you to confirm.
            </p>
          </div>
        </div>
        <span
          className="rounded-full px-3 py-1 text-sm font-black"
          style={{ backgroundColor: "white", color: overallTone.text, border: `1px solid ${overallTone.border}` }}
        >
          {LAUNCH_OVERALL_LABEL[launch.overall]}
        </span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {launch.items.map((item) => (
          <LaunchReadinessRow key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
}

function LaunchReadinessRow({ item }: { item: LaunchItem }) {
  const Icon = item.status === "ready" ? CheckCircle2 : item.status === "attention" ? AlertTriangle : Circle;
  const color = item.status === "ready" ? "#0f5132" : item.status === "attention" ? "#b45309" : "#8a7d70";

  return (
    <div className="flex items-start gap-3 rounded-md bg-white/70 p-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color }} aria-hidden />
      <div>
        <p className="text-sm font-black">{item.label}</p>
        <p className="mt-0.5 text-xs leading-5 text-[#5c5148]">{item.detail}</p>
      </div>
    </div>
  );
}

function OwnerActionCard({
  action,
}: {
  action: {
    id: string;
    severity: string;
    title: string;
    explanation: string;
    estimatedImpact: string;
    recommendedAction: string;
    sourceMetrics: Record<string, string | number | null>;
    confidence: string;
  };
}) {
  return (
    <article className="rounded-md border border-[#ded6ca] bg-white p-3">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-[#6c5e52]">{action.severity}</p>
      <h4 className="mt-1 text-sm font-black">{action.title}</h4>
      <ActionDetail label="What happened" value={action.explanation} />
      <ActionDetail label="Why it matters" value={action.estimatedImpact} />
      <ActionDetail label="What to do" value={action.recommendedAction} strong />
    </article>
  );
}

function ActionDetail({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="mt-2">
      <p className="text-[11px] font-black uppercase tracking-[0.08em] text-[#8a7d70]">{label}</p>
      <p className={cn("mt-1 text-sm text-[#5c5148]", strong && "font-bold text-[#0f5132]")}>{value}</p>
    </div>
  );
}

function ChecklistPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="rounded-lg border border-[#ded6ca] bg-white p-5">
      <h2 className="font-black">{title}</h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-3 text-sm font-semibold text-[#5c5148]">
            <input type="checkbox" className="h-4 w-4 rounded border-[#b9ad9f] accent-[#0f5132]" aria-label={item} />
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}

function QuickWin({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[#f7f3ed] p-3">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">{label}</p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
}

function ActionPanel({
  icon: Icon,
  title,
  body,
  href,
}: {
  icon: typeof ShoppingBag;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <article className="rounded-lg border border-[#ded6ca] bg-white p-5">
      <Icon className="h-5 w-5 text-[#0f5132]" aria-hidden />
      <h2 className="mt-3 font-black">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#5c5148]">{body}</p>
      <Link href={href} className="mt-4 inline-flex text-sm font-bold text-[#0f5132]">
        Review action
      </Link>
    </article>
  );
}

function IntelligencePanel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ShoppingBag;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-lg border border-[#ded6ca] bg-white p-5">
      <Icon className="h-5 w-5 text-[#0f5132]" aria-hidden />
      <h2 className="mt-3 text-lg font-black">{title}</h2>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function BriefingLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[#f7f3ed] p-3">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
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

function formatNullableCurrency(value: number | null) {
  return value === null ? "Margin unavailable - product cost not entered." : formatCurrency(value);
}

function MetricCard({
  icon: Icon,
  label,
  value,
  testid,
  hint,
}: {
  icon: typeof ShoppingBag;
  label: string;
  value: string;
  testid: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[#ded6ca] bg-white p-5">
      <Icon className="h-5 w-5 text-[#0f5132]" aria-hidden />
      <p className="mt-3 text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">{label}</p>
      <p className="mt-1 text-3xl font-black" data-testid={testid}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-[#8a7d70]">{hint}</p>}
    </div>
  );
}

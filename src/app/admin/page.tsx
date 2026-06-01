import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CalendarOff,
  ClipboardList,
  FileClock,
  FlaskConical,
  Gauge,
  MessageSquareWarning,
  PackageCheck,
  PackageSearch,
  PoundSterling,
  Recycle,
  ShieldAlert,
  Settings,
  ShoppingBag,
  Sun,
  TrendingUp,
  Users,
} from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getPublicBranch } from "@/lib/server/catalog";
import { getDashboardMetrics } from "@/lib/server/dashboard";
import { getOperationsIntelligence } from "@/lib/server/operations-intelligence";
import { formatCurrency, formatDisplayDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const adminLinks = [
  { href: "/admin/products", label: "Products", detail: "Products and categories", icon: PackageSearch },
  { href: "/admin/orders", label: "Orders", detail: "Order history", icon: ShoppingBag },
  { href: "/admin/pickup-windows", label: "Pickup Windows", detail: "Slot configuration", icon: ClipboardList },
  { href: "/admin/shop-closures", label: "Shop Closures", detail: "Bank holidays and closures", icon: CalendarOff },
  { href: "/admin/compliance", label: "Compliance", detail: "Supplier certificates", icon: ClipboardList },
  { href: "/admin/inventory", label: "Inventory", detail: "Batches and waste risk", icon: PackageCheck },
  { href: "/admin/settings", label: "Settings", detail: "Branch and SMS templates", icon: Settings },
  { href: "/admin/audit", label: "Audit Log", detail: "Operational event history", icon: FileClock },
  { href: "/admin/releases", label: "Releases", detail: "Deployment ledger and verification", icon: ClipboardList },
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
  const actionGroups = [
    { key: "urgent", title: "Urgent" },
    { key: "money_saving", title: "Money-saving" },
    { key: "stock", title: "Stock" },
    { key: "compliance", title: "Compliance" },
    { key: "customer_growth", title: "Customer growth" },
  ] as const;

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Manager console</p>
        <h1 className="mt-2 text-3xl font-black">Admin</h1>

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

        {intelligence.dataState.status === "error" && (
          <section className="mt-6 rounded-lg border border-[#b42318] bg-[#fff3f0] p-5" aria-label="Admin intelligence error">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-[#b42318]" aria-hidden />
              <div>
                <h2 className="font-black text-[#7a271a]">Admin intelligence data error</h2>
                <p className="mt-1 text-sm leading-6 text-[#7a271a]">{intelligence.dataState.message}</p>
              </div>
            </div>
          </section>
        )}

        <section className="mt-6 rounded-lg border border-[#ded6ca] bg-white p-5" aria-label="Owner Actions">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Action Intelligence</p>
            <h2 className="mt-1 text-xl font-black">Owner Actions</h2>
            <p className="mt-1 text-sm text-[#6c5e52]">Deterministic recommendations backed by live source metrics.</p>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-5">
            {actionGroups.map((group) => {
              const actions = intelligence.actions.filter((action) => action.group === group.key);
              return (
                <div key={group.key} className="rounded-md bg-[#f7f3ed] p-3">
                  <h3 className="text-sm font-black">{group.title}</h3>
                  <div className="mt-3 space-y-3">
                    {actions.length === 0 ? (
                      <p className="text-sm text-[#6c5e52]">No metric-backed action right now.</p>
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
            <h2 className="text-lg font-black">Today · {formatDisplayDate(metrics.date)}</h2>
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
              label="Failed SMS today"
              value={String(metrics.failedSmsCount)}
              testid="metric-failed-sms"
            />
            <MetricCard
              icon={FlaskConical}
              label="Test orders today"
              value={String(metrics.testOrderCount)}
              testid="metric-test-orders"
              hint="Excluded from order count and revenue"
            />
            <MetricCard
              icon={Gauge}
              label="Realtime mode"
              value={metrics.realtimeMode === "websocket" ? "Live requested" : metrics.realtimeMode === "polling" ? "Polling" : "Auto/degraded-ready"}
              testid="metric-realtime-mode"
              hint="Badge on counter reflects actual connection state"
            />
            <MetricCard
              icon={PackageCheck}
              label="Waste this week"
              value={String(metrics.wasteEventsThisWeek)}
              testid="metric-waste-week"
              hint="Recorded inventory waste events"
            />
            <MetricCard
              icon={PackageCheck}
              label="Expiring batches"
              value={String(metrics.expiringBatchCount)}
              testid="metric-expiring-batches"
              hint="Active stock expiring within 3 days"
            />
            <MetricCard
              icon={ShieldAlert}
              label="Expiring certificates"
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
            title="System health"
            body={`${metrics.failedSmsCount} failed SMS today. SMS sending remains env-gated; realtime mode is ${metrics.realtimeMode}.`}
            href="/admin/settings"
          />
        </section>

        <section className="mt-8 grid gap-4 xl:grid-cols-3" aria-label="Operations intelligence">
          <IntelligencePanel icon={PackageCheck} title="Expiry Command Centre">
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

          <IntelligencePanel icon={Recycle} title="Waste Intelligence">
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
          <IntelligencePanel icon={TrendingUp} title="Margin Intelligence">
            <StatLine label="Best margin product" value={intelligence.margin.best[0]?.productName ?? "Margin unavailable"} />
            <StatLine label="Worst margin product" value={intelligence.margin.worst[0]?.productName ?? "Margin unavailable"} />
            <StatLine label="Highest waste drag" value={intelligence.margin.highestWasteDrag?.productName ?? "No waste drag"} />
            <StatLine label="Gross profit today" value={formatNullableCurrency(intelligence.financial.estimatedGrossProfit)} />
            {intelligence.margin.unavailable.slice(0, 2).map((product) => (
              <p key={`unavailable-${product.productName}`} className="mt-3 text-sm text-[#7a271a]">
                <strong>{product.productName}</strong>: {product.marginUnavailableReason}
              </p>
            ))}
          </IntelligencePanel>

          <IntelligencePanel icon={PackageCheck} title="Inventory Depletion Forecast">
            {intelligence.depletion.length === 0 ? (
              <p className="text-sm text-[#6c5e52]">No active stock to forecast.</p>
            ) : (
              intelligence.depletion.slice(0, 5).map((row) => (
                <p key={row.batchId} className="mt-3 text-sm text-[#5c5148]">
                  <strong>{row.productName}</strong> - {row.message}
                </p>
              ))
            )}
          </IntelligencePanel>

          <IntelligencePanel icon={Users} title="Customer Value Tracking">
            <StatLine label="First time customers" value={String(intelligence.customers.firstTimeCustomers)} />
            <StatLine label="Repeat customers" value={String(intelligence.customers.repeatCustomers)} />
            <StatLine label="Repeat rate" value={`${intelligence.customers.repeatRate}%`} />
            <StatLine label="Average order value" value={formatCurrency(intelligence.customers.averageOrderValue)} />
            {intelligence.customers.topCustomers.slice(0, 3).map((customer) => (
              <p key={customer.customerPhone} className="mt-3 text-sm text-[#5c5148]">
                <strong>{customer.customerName}</strong> - {customer.orders} orders - {formatCurrency(customer.spend)} lifetime -{" "}
                {formatCurrency(customer.averageOrderValue)} AOV - last{" "}
                {new Date(customer.lastOrder).toLocaleDateString("en-GB")}
              </p>
            ))}
          </IntelligencePanel>
        </section>

        <section className="mt-8 grid gap-4 xl:grid-cols-3" aria-label="Growth and compliance intelligence">
          <IntelligencePanel icon={ShoppingBag} title="Basket Intelligence">
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

          <IntelligencePanel icon={ShieldAlert} title="Compliance Intelligence">
            <StatLine label="Compliance dashboard" value={intelligence.compliance.status} />
            {intelligence.compliance.rows.slice(0, 4).map((supplier) => (
              <StatLine
                key={supplier.supplierName}
                label={supplier.supplierName}
                value={
                  supplier.daysToExpiry === null
                    ? "Missing"
                    : supplier.daysToExpiry < 0
                      ? "Expired"
                      : `${supplier.daysToExpiry} days`
                }
              />
            ))}
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
          {adminLinks.map((item) => (
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
  const supportingNumber = Object.entries(action.sourceMetrics).find(([, value]) => typeof value === "number");

  return (
    <article className="rounded-md border border-[#ded6ca] bg-white p-3">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-[#6c5e52]">{action.severity}</p>
      <h4 className="mt-1 text-sm font-black">{action.title}</h4>
      <p className="mt-2 text-sm text-[#5c5148]">{action.explanation}</p>
      <p className="mt-2 text-sm font-bold text-[#0f5132]">{action.recommendedAction}</p>
      <p className="mt-2 text-xs text-[#6c5e52]">
        Impact: {action.estimatedImpact}
        {supportingNumber ? ` Supporting number: ${supportingNumber[0]} ${supportingNumber[1]}.` : ""}
      </p>
    </article>
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
  return value === null ? "Margin unavailable - missing product cost." : formatCurrency(value);
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

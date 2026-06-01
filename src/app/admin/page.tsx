import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CalendarOff,
  ClipboardList,
  FileClock,
  FlaskConical,
  LayoutDashboard,
  PackageCheck,
  PackageSearch,
  PoundSterling,
  Recycle,
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
import { cn, formatCurrency, formatDisplayDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SearchParams = {
  mode?: string;
};

type PriorityAction = {
  id: string;
  severity: string;
  title: string;
  explanation: string;
  recommendedAction: string;
};

type OperationalIssue = {
  id: string;
  label: string;
  severity: "red" | "amber";
  title: string;
  detail: string;
};

type InsightPanel = {
  icon: typeof ShoppingBag;
  title: string;
  summary: string;
  content: ReactNode;
};

const quickActionLinks = [
  { href: "/admin/orders", label: "Orders", detail: "Order history", icon: ShoppingBag },
  { href: "/admin/products", label: "Products", detail: "Products and categories", icon: PackageSearch },
  { href: "/admin/inventory", label: "Inventory", detail: "Batches and waste risk", icon: PackageCheck },
  { href: "/admin/compliance", label: "Compliance", detail: "Supplier certificates", icon: ClipboardList },
  { href: "/counter", label: "Counter", detail: "Service desk view", icon: LayoutDashboard },
  { href: "/admin/settings", label: "Settings", detail: "Branch and SMS templates", icon: Settings },
] as const;

const moreToolLinks = [
  { href: "/admin/pickup-windows", label: "Pickup Windows", detail: "Slot configuration", icon: ClipboardList },
  { href: "/admin/shop-closures", label: "Shop Closures", detail: "Bank holidays and closures", icon: CalendarOff },
  { href: "/admin/audit", label: "Audit Log", detail: "Operational event history", icon: FileClock },
  { href: "/admin/releases", label: "Releases", detail: "Deployment ledger and verification", icon: ClipboardList },
] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const profile = await getCurrentProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  const params = await searchParams;
  const isCounterMode = params.mode === "counter";
  const branch = await getPublicBranch();
  const branchId = profile.branchId ?? branch.id;
  const [metrics, intelligence] = await Promise.all([
    getDashboardMetrics(branchId),
    getOperationsIntelligence(branchId),
  ]);

  const priorityActions = intelligence.actions.slice(0, 5) as PriorityAction[];
  const operationalIssues = buildOperationalIssues(metrics, intelligence);
  const dailyFocus = buildDailyFocus(metrics, intelligence, operationalIssues);
  const insightPanels = buildInsightPanels(metrics, intelligence);

  return (
    <PageFrame>
      <main
        className={cn("mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8", isCounterMode && "max-w-5xl pb-24")}
        data-testid="owner-dashboard"
      >
        {isCounterMode ? (
          <CounterServiceMode
            metrics={metrics}
            operationalIssues={operationalIssues}
            criticalAlertCount={operationalIssues.length}
          />
        ) : (
          <>
            <header className="flex flex-col gap-4 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Manager console</p>
                <h1 className="mt-2 text-3xl font-black">Owner dashboard</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6c5e52]">
                  The owner-first mobile view keeps priorities, risks, and service actions in one scan.
                </p>
                <p className="mt-2 text-sm font-semibold text-[#0f5132]">Today - {formatDisplayDate(metrics.date)}</p>
              </div>
              <div className="flex items-center gap-3">
                <BadgePill tone="green">Desktop ready</BadgePill>
                <Link
                  href="/admin?mode=counter"
                  className="inline-flex h-11 items-center rounded-full border border-[#d6cdc0] bg-[#f7f3ed] px-4 text-sm font-bold text-[#0f5132] transition hover:bg-[#efe8dd]"
                >
                  Counter-service mode
                </Link>
              </div>
            </header>

            <section id="today-priorities" className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Section 1</p>
                  <h2 className="mt-1 text-xl font-black">Today&apos;s Priorities</h2>
                  <p className="mt-1 text-sm text-[#6c5e52]">The five actions that matter before service.</p>
                </div>
                <BadgePill tone={priorityActions.length > 0 ? "amber" : "green"}>
                  {priorityActions.length > 0 ? `${priorityActions.length} tasks` : "No urgent tasks"}
                </BadgePill>
              </div>

              {priorityActions.length === 0 ? (
                <p className="mt-4 rounded-xl bg-[#f7f3ed] p-4 text-sm text-[#5c5148]">
                  Nothing needs attention right now.
                </p>
              ) : (
                <ol className="mt-4 grid gap-3">
                  {priorityActions.map((action, index) => (
                    <li key={action.id} className="flex gap-3 rounded-xl border border-[#ece2d5] bg-[#fbfaf7] p-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0f5132] text-sm font-black text-white">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-black">{action.title}</p>
                          <BadgePill tone={severityTone(action.severity)}>{action.severity}</BadgePill>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[#5c5148]">{action.explanation}</p>
                        <p className="mt-1 text-sm font-semibold text-[#0f5132]">{action.recommendedAction}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="mt-6 grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
              <article className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <Sun className="mt-0.5 h-6 w-6 text-[#0f5132]" aria-hidden />
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Daily focus</p>
                    <h2 className="mt-1 text-xl font-black">Today&apos;s Focus</h2>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {dailyFocus.lines.map((line) => (
                    <p key={line} className="text-sm leading-6 text-[#5c5148]">
                      {line}
                    </p>
                  ))}
                </div>
                <p className="mt-4 rounded-xl bg-[#f7f3ed] p-4 text-sm font-bold text-[#0f5132]">{dailyFocus.recommendation}</p>
              </article>

              <article className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" aria-label="Business snapshot">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Section 2</p>
                  <h2 className="mt-1 text-xl font-black">Business Snapshot</h2>
                  <p className="mt-1 text-sm text-[#6c5e52]">The numbers to check in one glance.</p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <SnapshotStat label="Orders today" value={String(metrics.orderCount)} testid="metric-order-count" />
                  <SnapshotStat label="Orders awaiting prep" value={String(metrics.awaitingPrep)} testid="metric-awaiting-prep" />
                  <SnapshotStat label="Ready orders" value={String(metrics.readyCount)} testid="metric-ready" />
                  <SnapshotStat label="Revenue today" value={formatCurrency(metrics.estimatedRevenue)} testid="metric-revenue" />
                  <SnapshotStat label="Waste this week" value={formatCurrency(intelligence.waste.weekValue)} testid="metric-waste-week" />
                  <SnapshotStat label="Stock at risk" value={formatCurrency(metrics.stockValueAtRisk)} testid="metric-stock-risk" />
                  <SnapshotStat label="Certificates expiring" value={String(metrics.expiringCertificates)} testid="metric-expiring-certificates" />
                </div>
              </article>
            </section>

            <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" aria-label="Operational status">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Section 3</p>
                  <h2 className="mt-1 text-xl font-black">Operational Status</h2>
                  <p className="mt-1 text-sm text-[#6c5e52]">Only problems are shown here.</p>
                </div>
                {operationalIssues.length === 0 && <BadgePill tone="green">Healthy</BadgePill>}
              </div>

              {operationalIssues.length === 0 ? (
                <p className="mt-4 rounded-xl bg-[#f7f3ed] p-4 text-sm text-[#5c5148]">
                  Nothing needs attention right now.
                </p>
              ) : (
                <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {operationalIssues.map((issue) => (
                    <article
                      key={issue.id}
                      className={cn(
                        "rounded-xl border p-4",
                        issue.severity === "red" ? "border-[#f5c2c7] bg-[#fff5f5]" : "border-[#f4d7a1] bg-[#fff9ef]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-black">{issue.label}</p>
                        <BadgePill tone={issue.severity === "red" ? "red" : "amber"}>
                          {issue.severity === "red" ? "Action required" : "Needs attention"}
                        </BadgePill>
                      </div>
                      <p className="mt-2 text-sm font-bold text-[#1f1b16]">{issue.title}</p>
                      <p className="mt-1 text-sm leading-6 text-[#5c5148]">{issue.detail}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" aria-label="Quick actions">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Section 4</p>
                <h2 className="mt-1 text-xl font-black">Quick Actions</h2>
                <p className="mt-1 text-sm text-[#6c5e52]">Large buttons for fast navigation.</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {quickActionLinks.map((item) => (
                  <QuickActionCard key={item.href} {...item} />
                ))}
              </div>
            </section>

            <section id="business-insights" className="mt-6" aria-label="Business insights">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Section 5</p>
                  <h2 className="mt-1 text-xl font-black">Business Insights</h2>
                  <p className="mt-1 text-sm text-[#6c5e52]">Secondary intelligence that stays out of the way on mobile.</p>
                </div>
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

            <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" aria-label="More tools">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">More tools</p>
                <h2 className="mt-1 text-xl font-black">Admin links</h2>
                <p className="mt-1 text-sm text-[#6c5e52]">The rest of the admin surface stays one tap away.</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {moreToolLinks.map((item) => (
                  <QuickActionCard key={item.href} {...item} />
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      <MobileActionBar compact={isCounterMode} />
    </PageFrame>
  );
}

function CounterServiceMode({
  metrics,
  operationalIssues,
  criticalAlertCount,
}: {
  metrics: Awaited<ReturnType<typeof getDashboardMetrics>>;
  operationalIssues: OperationalIssue[];
  criticalAlertCount: number;
}) {
  return (
    <>
      <header className="flex flex-col gap-4 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Counter-service mode</p>
          <h1 className="mt-2 text-3xl font-black">Service view</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6c5e52]">
            A compact layout for serving customers. No analytics, no long scrolling, just the live counters that matter.
          </p>
          <p className="mt-2 text-sm font-semibold text-[#0f5132]">Today - {formatDisplayDate(metrics.date)}</p>
        </div>
        <Link
          href="/admin"
          className="inline-flex h-11 items-center rounded-full border border-[#d6cdc0] bg-[#f7f3ed] px-4 text-sm font-bold text-[#0f5132] transition hover:bg-[#efe8dd]"
        >
          Back to full dashboard
        </Link>
      </header>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <CompactMetricCard label="Orders awaiting prep" value={String(metrics.awaitingPrep)} testid="metric-awaiting-prep" />
        <CompactMetricCard label="Ready orders" value={String(metrics.readyCount)} testid="metric-ready" />
        <CompactMetricCard label="Revenue today" value={formatCurrency(metrics.estimatedRevenue)} testid="metric-revenue" />
        <CompactMetricCard label="Critical alerts" value={String(criticalAlertCount)} testid="metric-critical-alerts" />
      </section>

      <section id="critical-alerts" className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" aria-label="Critical alerts">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Live status</p>
            <h2 className="mt-1 text-xl font-black">Critical alerts</h2>
          </div>
          <BadgePill tone={criticalAlertCount === 0 ? "green" : "amber"}>
            {criticalAlertCount === 0 ? "Clear" : `${criticalAlertCount} items`}
          </BadgePill>
        </div>
        {operationalIssues.length === 0 ? (
          <p className="mt-4 rounded-xl bg-[#f7f3ed] p-4 text-sm text-[#5c5148]">Nothing needs attention right now.</p>
        ) : (
          <div className="mt-4 grid gap-3">
            {operationalIssues.map((issue) => (
              <article
                key={issue.id}
                className={cn(
                  "rounded-xl border p-4",
                  issue.severity === "red" ? "border-[#f5c2c7] bg-[#fff5f5]" : "border-[#f4d7a1] bg-[#fff9ef]",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black">{issue.label}</p>
                  <BadgePill tone={issue.severity === "red" ? "red" : "amber"}>
                    {issue.severity === "red" ? "Action required" : "Needs attention"}
                  </BadgePill>
                </div>
                <p className="mt-2 text-sm font-bold text-[#1f1b16]">{issue.title}</p>
                <p className="mt-1 text-sm leading-6 text-[#5c5148]">{issue.detail}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Service note</p>
        <p className="mt-2 text-sm leading-6 text-[#5c5148]">
          Counter-service mode keeps the screen lean during service. Open the full dashboard later for priorities,
          insights, and admin tools.
        </p>
      </section>
    </>
  );
}

function buildOperationalIssues(
  metrics: Awaited<ReturnType<typeof getDashboardMetrics>>,
  intelligence: Awaited<ReturnType<typeof getOperationsIntelligence>>,
) {
  const issues: OperationalIssue[] = [];

  if (metrics.awaitingPrep > 0) {
    issues.push({
      id: "counter-backlog",
      label: "Counter status",
      severity: metrics.awaitingPrep >= 4 ? "red" : "amber",
      title: `${metrics.awaitingPrep} orders still need prep`,
      detail:
        metrics.readyCount > 0
          ? `${metrics.readyCount} order${metrics.readyCount === 1 ? "" : "s"} are already ready, so the prep queue can be cleared in order.`
          : "No ready orders are waiting, so the prep queue is the first thing to clear.",
    });
  }

  if (metrics.stockValueAtRisk > 0 || metrics.batchesExpiringWithin3Days > 0) {
    issues.push({
      id: "inventory-risk",
      label: "Inventory risk",
      severity: metrics.batchesExpiringWithin3Days > 0 ? "red" : "amber",
      title: `${formatCurrency(metrics.stockValueAtRisk)} stock at risk`,
      detail:
        metrics.batchesExpiringWithin3Days > 0
          ? `${metrics.batchesExpiringWithin3Days} batch${metrics.batchesExpiringWithin3Days === 1 ? "" : "es"} expire within 3 days.`
          : "No batches are expiring immediately, but current stock value is still exposed to waste.",
    });
  }

  const certificateIssueCount = metrics.expiredCertificates + metrics.expiringCertificates + metrics.missingCertificates;
  if (certificateIssueCount > 0) {
    issues.push({
      id: "compliance-risk",
      label: "Compliance",
      severity: metrics.expiredCertificates > 0 || metrics.missingCertificates > 0 ? "red" : "amber",
      title: `${certificateIssueCount} certificate issue${certificateIssueCount === 1 ? "" : "s"}`,
      detail:
        metrics.expiredCertificates > 0
          ? `${metrics.expiredCertificates} certificate${metrics.expiredCertificates === 1 ? "" : "s"} are expired and need immediate follow-up.`
          : metrics.missingCertificates > 0
            ? `${metrics.missingCertificates} supplier record${metrics.missingCertificates === 1 ? "" : "s"} still need a certificate attached.`
            : `${metrics.expiringCertificates} certificate${metrics.expiringCertificates === 1 ? "" : "s"} expire within 30 days.`,
    });
  }

  if (metrics.failedSmsCount > 0) {
    issues.push({
      id: "sms-status",
      label: "SMS status",
      severity: "amber",
      title: `${metrics.failedSmsCount} failed SMS message${metrics.failedSmsCount === 1 ? "" : "s"} today`,
      detail: "Orders still work, but failed notifications may need manual follow-up.",
    });
  }

  if (metrics.realtimeMode !== "websocket") {
    issues.push({
      id: "realtime-status",
      label: "Realtime status",
      severity: "amber",
      title: metrics.realtimeMode === "polling" ? "Counter updates are polling" : "Counter updates need verification",
      detail:
        metrics.realtimeMode === "polling"
          ? "Live push is not confirmed, so the counter board is using polling fallback."
          : "Open the counter board and confirm orders appear immediately during service.",
    });
  }

  if (intelligence.dataState.status === "error" && intelligence.dataState.message) {
    issues.push({
      id: "intelligence-error",
      label: "Insights",
      severity: "amber",
      title: "Some intelligence failed to load",
      detail: intelligence.dataState.message,
    });
  }

  return issues;
}

function buildDailyFocus(
  metrics: Awaited<ReturnType<typeof getDashboardMetrics>>,
  intelligence: Awaited<ReturnType<typeof getOperationsIntelligence>>,
  issues: OperationalIssue[],
) {
  const lines: string[] = [];
  let recommendation = "Keep the dashboard clear and check the next order wave.";

  if (intelligence.waste.weekValue > 0) {
    lines.push(`${formatCurrency(intelligence.waste.weekValue)} waste opportunity identified.`);
    recommendation = "Reduce waste before placing the next supplier order.";
  }

  if (intelligence.customers.firstTimeCustomers > 0) {
    lines.push(`${intelligence.customers.firstTimeCustomers} customers have not returned.`);
    if (recommendation === "Keep the dashboard clear and check the next order wave.") {
      recommendation = "Contact recent customers and encourage a repeat order.";
    }
  }

  const complianceIssue = issues.find((issue) => issue.label === "Compliance");
  if (complianceIssue) {
    lines.push(
      complianceIssue.severity === "red"
        ? `${metrics.expiredCertificates + metrics.missingCertificates} compliance risks need action.`
        : `${metrics.expiringCertificates} compliance items are due soon.`,
    );
    recommendation = "Contact suppliers and upload updated certificates.";
  } else if (metrics.stockValueAtRisk > 0) {
    lines.push(`${formatCurrency(metrics.stockValueAtRisk)} stock is currently at risk.`);
    if (recommendation === "Keep the dashboard clear and check the next order wave.") {
      recommendation = "Review the next stock order before anything expires.";
    }
  }

  if (lines.length === 0) {
    lines.push("Nothing needs attention right now.");
    lines.push("Recommendations will appear when a new order, waste, or compliance risk shows up.");
    recommendation = "Use the time to prepare the counter and keep service smooth.";
  }

  return {
    lines: lines.slice(0, 3),
    recommendation,
  };
}

function buildInsightPanels(
  metrics: Awaited<ReturnType<typeof getDashboardMetrics>>,
  intelligence: Awaited<ReturnType<typeof getOperationsIntelligence>>,
): InsightPanel[] {
  return [
    {
      icon: PackageCheck,
      title: "Expiry Command Centre",
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
      title: "Waste Intelligence",
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
      title: "Daily Profit Estimate",
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
      title: "Profit & Loss",
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
      title: "Stock Forecast",
      summary: `${intelligence.depletion.length} forecast rows`,
      content: (
        <>
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
      title: "Food Compliance",
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

function severityTone(severity: string) {
  if (severity === "urgent") return "red";
  if (severity === "warning") return "amber";
  return "green";
}

function BadgePill({
  tone,
  children,
}: {
  tone: "green" | "amber" | "red";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.08em]",
        tone === "green" && "bg-[#e6f5ec] text-[#0f5132]",
        tone === "amber" && "bg-[#fff4d8] text-[#8b5e00]",
        tone === "red" && "bg-[#fde8e7] text-[#9f1d1d]",
      )}
    >
      {children}
    </span>
  );
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

function CompactMetricCard({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <article className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.08em] text-[#6c5e52]">{label}</p>
      <p className="mt-2 text-3xl font-black" data-testid={testid}>
        {value}
      </p>
    </article>
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

function MobileActionBar({ compact = false }: { compact?: boolean }) {
  const links = [
    { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
    { href: "/admin/inventory", label: "Inventory", icon: PackageCheck },
    { href: "/counter", label: "Counter", icon: LayoutDashboard },
    { href: compact ? "/admin#critical-alerts" : "/admin#today-priorities", label: "Actions", icon: Sun },
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
  return value === null ? "Margin unavailable - product cost not entered." : formatCurrency(value);
}

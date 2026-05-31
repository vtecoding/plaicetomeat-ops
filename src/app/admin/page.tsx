import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarOff,
  ClipboardList,
  FlaskConical,
  Gauge,
  MessageSquareWarning,
  PackageCheck,
  PackageSearch,
  PoundSterling,
  ShieldAlert,
  Settings,
  ShoppingBag,
} from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getPublicBranch } from "@/lib/server/catalog";
import { getDashboardMetrics } from "@/lib/server/dashboard";
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
];

export default async function AdminPage() {
  const profile = await getCurrentProfile();

  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  const branch = await getPublicBranch();
  const branchId = profile.branchId ?? branch.id;
  const metrics = await getDashboardMetrics(branchId);

  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Manager console</p>
        <h1 className="mt-2 text-3xl font-black">Admin</h1>

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
          </div>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-3" aria-label="Action needed">
          <ActionPanel
            icon={PackageCheck}
            title="Stock risk"
            body={
              metrics.inventoryConfigured
                ? `${metrics.batchesExpiringWithin3Days} batches expiring within 3 days. ${formatCurrency(metrics.stockValueAtRisk)} estimated value at risk.`
                : "Inventory not configured yet."
            }
          />
          <ActionPanel
            icon={ShieldAlert}
            title="Compliance risk"
            body={
              metrics.certificateRecordsConfigured
                ? `${metrics.expiredCertificates} expired, ${metrics.expiringCertificates} expiring within 30 days, ${metrics.missingCertificates} missing verification.`
                : "Supplier certificate records not configured yet."
            }
          />
          <ActionPanel
            icon={MessageSquareWarning}
            title="System health"
            body={`${metrics.failedSmsCount} failed SMS today. SMS sending remains env-gated; realtime mode is ${metrics.realtimeMode}.`}
          />
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

function ActionPanel({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof ShoppingBag;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-lg border border-[#ded6ca] bg-white p-5">
      <Icon className="h-5 w-5 text-[#0f5132]" aria-hidden />
      <h2 className="mt-3 font-black">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[#5c5148]">{body}</p>
    </article>
  );
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

import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  PackageCheck,
  PackagePlus,
  Scissors,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";

import { PageFrame } from "@/components/site-header";
import {
  buildComplianceWarnings,
  buildStockAttention,
  buildTodayActions,
  buildTodayOrders,
  overallUrgency,
  type AttentionItem,
  type Urgency,
} from "@/lib/domain/dad-mode";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getPublicBranch } from "@/lib/server/catalog";
import { getDashboardMetrics } from "@/lib/server/dashboard";
import { getOperationsIntelligence } from "@/lib/server/operations-intelligence";
import { cn, formatDisplayDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const URGENCY_TONE: Record<Urgency, "green" | "amber" | "red" | "neutral"> = {
  urgent: "red",
  attention: "amber",
  important: "neutral",
  ok: "green",
};

const bigButtons = [
  { href: "/counter", label: "Counter", detail: "Serve and prepare orders", icon: LayoutDashboard },
  { href: "/admin/inventory", label: "Add stock", detail: "Record what came in", icon: PackagePlus },
  { href: "/admin/products", label: "Products", detail: "What you sell and prices", icon: PackageCheck },
  { href: "/admin/purchasing", label: "Purchasing", detail: "What to buy next", icon: TrendingUp },
  { href: "/admin/compliance", label: "Compliance", detail: "Halal & food-safety papers", icon: ClipboardList },
  { href: "/admin/cutting-guide", label: "Prices", detail: "What a whole animal is worth", icon: Scissors },
  { href: "/admin/setup", label: "Setup checklist", detail: "Get ready to open", icon: ListChecks },
  { href: "/admin/guide", label: "Help & guide", detail: "How to do each job", icon: BookOpen },
  { href: "/admin", label: "More detail", detail: "Full numbers and insights", icon: ArrowRight },
] as const;

export default async function TodayPage() {
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

  const actions = buildTodayActions(intelligence.actions);
  const orders = buildTodayOrders(metrics);
  const stock = buildStockAttention(metrics);
  const compliance = buildComplianceWarnings(metrics);

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="dad-mode-home">
        <header className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Your shop today</p>
          <h1 className="mt-2 text-3xl font-black">Here&apos;s what to do today</h1>
          <p className="mt-2 text-sm font-semibold text-[#0f5132]">{formatDisplayDate(metrics.date)}</p>
        </header>

        {/* 1. Today's Actions — the most important section. */}
        <Section
          eyebrow="Do these first"
          title="Today's jobs"
          badge={<UrgencyBadge urgency={actions.length === 0 ? "ok" : actions[0].urgency} count={actions.length} />}
        >
          {actions.length === 0 ? (
            <Reassurance>Nothing needs doing right now. Keep an eye on new orders.</Reassurance>
          ) : (
            <ol className="grid gap-3" data-testid="today-actions">
              {actions.map((action) => (
                <li
                  key={action.id}
                  className="rounded-xl border border-[#ece2d5] bg-[#fbfaf7] p-4"
                  data-testid="today-action"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-black">{action.title}</p>
                    <UrgencyBadge urgency={action.urgency} />
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[#5c5148]">{action.why}</p>
                  <p className="mt-1 text-sm text-[#5c5148]">
                    <span className="font-semibold text-[#0f5132]">Suggested:</span> {action.suggested}
                  </p>
                  <Link
                    href={action.href}
                    className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-[#0f5132] px-5 text-sm font-bold text-white transition hover:bg-[#0c3f27]"
                  >
                    {action.actionLabel}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {/* 2. Today's Orders. */}
        <Section eyebrow="At the counter" title="Today's orders">
          <div className="grid gap-3 sm:grid-cols-3">
            <BigStat label="Orders today" value={orders.total} />
            <BigStat label="Waiting to prepare" value={orders.awaitingPrep} tone={orders.awaitingPrep > 0 ? "amber" : "green"} />
            <BigStat label="Ready to collect" value={orders.ready} tone={orders.ready > 0 ? "green" : "neutral"} />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <PrimaryButton href="/counter" icon={LayoutDashboard}>
              Open Counter
            </PrimaryButton>
            <SecondaryButton href="/admin/orders" icon={ShoppingBag}>
              View Orders
            </SecondaryButton>
          </div>
        </Section>

        {/* 3. Stock Needing Attention. */}
        <Section
          eyebrow="Stock"
          title="Stock needing attention"
          badge={<UrgencyBadge urgency={overallUrgency(stock)} count={stock.length} />}
        >
          {stock.length === 0 ? (
            <Reassurance>Stock looks fine. Nothing is about to go off.</Reassurance>
          ) : (
            <AttentionList items={stock} testid="stock-attention" />
          )}
        </Section>

        {/* 4. Compliance Warnings. */}
        <Section
          eyebrow="Halal & food safety"
          title="Compliance warnings"
          badge={<UrgencyBadge urgency={overallUrgency(compliance)} count={compliance.length} />}
        >
          {compliance.length === 0 ? (
            <Reassurance>Compliance: no urgent issues.</Reassurance>
          ) : (
            <AttentionList items={compliance} testid="compliance-warnings" />
          )}
        </Section>

        {/* 5. Big Navigation Buttons. */}
        <Section eyebrow="Go to" title="What do you want to open?">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {bigButtons.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-28 flex-col rounded-2xl border border-[#ded6ca] bg-[#fbfaf7] p-4 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
              >
                <item.icon className="h-6 w-6 text-[#0f5132]" aria-hidden />
                <p className="mt-3 text-lg font-black">{item.label}</p>
                <p className="mt-1 text-sm text-[#6c5e52]">{item.detail}</p>
              </Link>
            ))}
          </div>
        </Section>
      </main>
    </PageFrame>
  );
}

function Section({
  eyebrow,
  title,
  badge,
  children,
}: {
  eyebrow: string;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-black">{title}</h2>
        </div>
        {badge}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AttentionList({ items, testid }: { items: AttentionItem[]; testid: string }) {
  return (
    <div className="grid gap-3" data-testid={testid}>
      {items.map((item) => (
        <article
          key={item.id}
          className={cn(
            "rounded-xl border p-4",
            item.urgency === "urgent" ? "border-[#f5c2c7] bg-[#fff5f5]" : "border-[#f4d7a1] bg-[#fff9ef]",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-black">{item.title}</p>
            <UrgencyBadge urgency={item.urgency} />
          </div>
          <p className="mt-1 text-sm leading-6 text-[#5c5148]">{item.detail}</p>
        </article>
      ))}
    </div>
  );
}

function Reassurance({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-xl bg-[#f2fbf5] p-4 text-sm font-semibold text-[#0f5132]">
      <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

function BigStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "green" | "amber" | "neutral";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        tone === "green" && "border-[#bfe3cf] bg-[#f2fbf5]",
        tone === "amber" && "border-[#f4d7a1] bg-[#fff9ef]",
        tone === "neutral" && "border-[#ece2d5] bg-[#f7f3ed]",
      )}
    >
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">{label}</p>
      <p className="mt-1 text-3xl font-black">{value}</p>
    </div>
  );
}

function UrgencyBadge({ urgency, count }: { urgency: Urgency; count?: number }) {
  const tone = URGENCY_TONE[urgency];
  const label =
    count !== undefined && count === 0
      ? "All good"
      : count !== undefined
        ? `${count} to do`
        : urgency === "urgent"
          ? "Urgent"
          : urgency === "attention"
            ? "Needs attention"
            : urgency === "important"
              ? "Important"
              : "All good";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.08em]",
        tone === "green" && "bg-[#e6f5ec] text-[#0f5132]",
        tone === "amber" && "bg-[#fff4d8] text-[#8b5e00]",
        tone === "red" && "bg-[#fde8e7] text-[#9f1d1d]",
        tone === "neutral" && "bg-[#eee7db] text-[#6c5e52]",
      )}
    >
      {label}
    </span>
  );
}

function PrimaryButton({ href, icon: Icon, children }: { href: string; icon: typeof ShoppingBag; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center gap-2 rounded-full bg-[#0f5132] px-6 text-base font-bold text-white transition hover:bg-[#0c3f27]"
    >
      <Icon className="h-5 w-5" aria-hidden />
      {children}
    </Link>
  );
}

function SecondaryButton({ href, icon: Icon, children }: { href: string; icon: typeof ShoppingBag; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center gap-2 rounded-full border border-[#d6cdc0] bg-[#f7f3ed] px-6 text-base font-bold text-[#0f5132] transition hover:bg-[#efe8dd]"
    >
      <Icon className="h-5 w-5" aria-hidden />
      {children}
    </Link>
  );
}

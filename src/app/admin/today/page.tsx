import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Circle,
  LayoutDashboard,
  ListChecks,
  Sparkles,
  Sprout,
  TrendingUp,
} from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getPublicBranch } from "@/lib/server/catalog";
import { getOwnerBrain } from "@/lib/server/owner-brain";
import {
  DUE_WINDOW_LABEL,
  SHOP_STATUS_LABEL,
  type OwnerDecision,
  type OwnerWeeklySummary,
  type ShopStatus,
} from "@/lib/owner-brain/types";
import type { GettingStarted } from "@/lib/shop-intelligence/types";
import { cn, formatDisplayDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_TONE = {
  good: "green",
  needs_attention: "amber",
  unknown: "neutral",
} as const;

export default async function TodayPage() {
  const profile = await getCurrentProfile();
  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  const branch = await getPublicBranch();
  const branchId = profile.branchId ?? branch.id;
  const brain = await getOwnerBrain(branchId);
  const date = formatDisplayDate(new Date(brain.generatedAt));

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="owner-brain-home">
        <header className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Today</p>
          <h1 className="mt-2 text-3xl font-black">What needs you today</h1>
          <p className="mt-2 text-sm font-semibold text-[#6c5e52]">{date}</p>
        </header>

        {brain.setupMode ? (
          <SetupMode gettingStarted={brain.gettingStarted} />
        ) : (
          <>
            {/* The three — and only three — sections. */}
            <DecisionSection
              testid="decisions-urgent"
              dot="🔴"
              title="Urgent"
              subtitle="Needs action today"
              decisions={brain.urgent}
              emptyText="Nothing urgent. Nothing here can't wait."
            />
            <DecisionSection
              testid="decisions-important"
              dot="🟡"
              title="Important"
              subtitle="Worth doing this week"
              decisions={brain.important}
              emptyText="Nothing pressing this week."
            />
            <DecisionSection
              testid="decisions-opportunities"
              dot="🟢"
              title="Opportunities"
              subtitle="Ways to grow — no rush"
              decisions={brain.opportunities}
              emptyText="No new opportunities spotted yet."
            />

            <ShopStatusPanel status={brain.status} />
            <WeeklySummaryPanel weekly={brain.weekly} />
          </>
        )}

        <MoreDetail />
      </main>
    </PageFrame>
  );
}

function SetupMode({ gettingStarted }: { gettingStarted: GettingStarted }) {
  return (
    <section className="mt-4 rounded-2xl border border-[#bfe3cf] bg-[#f2fbf5] p-5 shadow-sm" data-testid="setup-mode">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0f5132] text-white">
            <Sprout className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Getting started</p>
            <h2 className="mt-1 text-xl font-black text-[#0f5132]">{gettingStarted.title}</h2>
          </div>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.06em] text-[#0f5132] ring-1 ring-[#bfe3cf]">
          {gettingStarted.doneCount} of {gettingStarted.totalCount} done
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-[#27543c]">{gettingStarted.intro}</p>

      <ol className="mt-4 grid gap-3">
        {gettingStarted.steps.map((step) => (
          <li
            key={step.id}
            className={cn(
              "flex flex-wrap items-start gap-3 rounded-xl border p-4",
              step.done ? "border-[#bfe3cf] bg-white/70" : "border-[#ded6ca] bg-white",
            )}
          >
            {step.done ? (
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[#0f5132]" aria-hidden />
            ) : (
              <Circle className="mt-0.5 h-6 w-6 shrink-0 text-[#9fb3a6]" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className={cn("text-base font-black", step.done ? "text-[#6c5e52] line-through" : "text-[#241f1a]")}>{step.text}</p>
              {!step.done && <p className="mt-1 text-sm leading-6 text-[#5c5148]">{step.why}</p>}
            </div>
            {!step.done && (
              <Link
                href={step.href}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-[#0f5132] px-4 text-sm font-bold text-white transition hover:bg-[#0c3f27]"
              >
                {step.actionLabel}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </li>
        ))}
      </ol>

      <p className="mt-4 text-sm text-[#27543c]">
        Once these are done, this page turns into your daily list of what needs doing — no jargon, just decisions.
      </p>
    </section>
  );
}

function DecisionSection({
  testid,
  dot,
  title,
  subtitle,
  decisions,
  emptyText,
}: {
  testid: string;
  dot: string;
  title: string;
  subtitle: string;
  decisions: OwnerDecision[];
  emptyText: string;
}) {
  return (
    <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span aria-hidden className="text-lg">
            {dot}
          </span>
          <h2 className="text-xl font-black">{title}</h2>
          <p className="text-sm font-semibold text-[#6c5e52]">{subtitle}</p>
        </div>
        <span className="rounded-full bg-[#eee7db] px-3 py-1 text-xs font-black uppercase tracking-[0.06em] text-[#6c5e52]">
          {decisions.length === 0 ? "All clear" : decisions.length}
        </span>
      </div>

      <div className="mt-4">
        {decisions.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl bg-[#f2fbf5] p-4 text-sm font-semibold text-[#0f5132]">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            {emptyText}
          </p>
        ) : (
          <ul className="grid gap-3" data-testid={testid}>
            {decisions.map((decision) => (
              <li key={decision.id}>
                <DecisionRow decision={decision} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function DecisionRow({ decision }: { decision: OwnerDecision }) {
  return (
    <Link
      href={`/admin/today/${decision.id}`}
      data-testid="decision-row"
      className="flex items-center gap-3 rounded-xl border border-[#ece2d5] bg-[#fbfaf7] p-4 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-black text-[#241f1a]">{decision.title}</p>
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#5c5148]">{decision.whyItMatters}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <MoneyChip impact={decision.estimatedImpact} />
          <span className="rounded-full bg-[#eee7db] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#6c5e52]">
            {DUE_WINDOW_LABEL[decision.dueWindow]}
          </span>
        </div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-[#9a8c7d]" aria-hidden />
    </Link>
  );
}

function MoneyChip({ impact }: { impact: OwnerDecision["estimatedImpact"] }) {
  const tone = impact.kind === "opportunity" ? "green" : impact.kind === "none" ? "neutral" : "amber";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-[0.04em]",
        tone === "green" && "bg-[#e6f5ec] text-[#0f5132]",
        tone === "amber" && "bg-[#fff4d8] text-[#8b5e00]",
        tone === "neutral" && "bg-[#eee7db] text-[#6c5e52]",
      )}
    >
      {impact.label}
    </span>
  );
}

function ShopStatusPanel({ status }: { status: ShopStatus }) {
  const tone = STATUS_TONE[status.band];
  return (
    <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" data-testid="shop-status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">How the shop is doing</p>
          <h2 className="mt-1 text-xl font-black">{status.headline}</h2>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-4 py-1.5 text-sm font-black uppercase tracking-[0.06em]",
            tone === "green" && "bg-[#e6f5ec] text-[#0f5132]",
            tone === "amber" && "bg-[#fff4d8] text-[#8b5e00]",
            tone === "neutral" && "bg-[#eee7db] text-[#6c5e52]",
          )}
        >
          {SHOP_STATUS_LABEL[status.band]}
        </span>
      </div>

      {(status.good.length > 0 || status.watch.length > 0) && (
        <div className="mt-4 grid gap-2">
          {status.good.map((item) => (
            <p key={`good-${item}`} className="flex items-center gap-2 text-sm font-semibold text-[#0f5132]">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> {item} is in good shape
            </p>
          ))}
          {status.watch.map((item) => (
            <p key={`watch-${item}`} className="flex items-center gap-2 text-sm font-semibold text-[#8b5e00]">
              <span aria-hidden className="text-base leading-none">
                ⚠
              </span>{" "}
              {item} needs a look
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function WeeklySummaryPanel({ weekly }: { weekly: OwnerWeeklySummary }) {
  return (
    <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" data-testid="weekly-owner-summary">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">This week</p>
      <h2 className="mt-1 text-xl font-black">Your week at a glance · {weekly.rangeLabel}</h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <SummaryColumn title="Wins" tone="green" items={weekly.wins} emptyText="Building up." />
        <SummaryColumn title="Risks" tone="amber" items={weekly.risks} emptyText="None to flag." />
        <SummaryColumn title="Opportunities" tone="neutral" items={weekly.opportunities} emptyText="None yet." />
      </div>
    </section>
  );
}

function SummaryColumn({
  title,
  tone,
  items,
  emptyText,
}: {
  title: string;
  tone: "green" | "amber" | "neutral";
  items: string[];
  emptyText: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        tone === "green" && "border-[#bfe3cf] bg-[#f2fbf5]",
        tone === "amber" && "border-[#f4d7a1] bg-[#fff9ef]",
        tone === "neutral" && "border-[#ece2d5] bg-[#fbfaf7]",
      )}
    >
      <p
        className={cn(
          "text-xs font-black uppercase tracking-[0.08em]",
          tone === "green" && "text-[#0f5132]",
          tone === "amber" && "text-[#8b5e00]",
          tone === "neutral" && "text-[#6c5e52]",
        )}
      >
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[#6c5e52]">{emptyText}</p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {items.map((item) => (
            <li key={item} className="text-sm leading-6 text-[#3f372f]">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MoreDetail() {
  const links = [
    { href: "/counter", label: "Counter", detail: "Serve and prepare orders", icon: LayoutDashboard },
    { href: "/admin/briefing", label: "Full briefing", detail: "The detail behind today", icon: Sparkles, testid: "briefing-link" },
    { href: "/admin", label: "More detail", detail: "Full numbers and insights", icon: TrendingUp },
    { href: "/admin/playbooks", label: "Playbooks", detail: "How to do each job", icon: BookOpen },
    { href: "/admin/guide", label: "Help & guide", detail: "Quick how-to and dry run", icon: BookOpen },
    { href: "/admin/setup", label: "Setup checklist", detail: "Get ready to open", icon: ListChecks },
  ];
  return (
    <section className="mt-6 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">More</p>
      <h2 className="mt-1 text-xl font-black">Open something else</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            {...(item.testid ? { "data-testid": item.testid } : {})}
            className="flex min-h-24 flex-col rounded-2xl border border-[#ded6ca] bg-[#fbfaf7] p-4 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
          >
            <item.icon className="h-6 w-6 text-[#0f5132]" aria-hidden />
            <p className="mt-3 text-lg font-black">{item.label}</p>
            <p className="mt-1 text-sm text-[#6c5e52]">{item.detail}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

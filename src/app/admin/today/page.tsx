import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Clock,
  LayoutDashboard,
  ListChecks,
  PlayCircle,
  Sprout,
  Sunrise,
  Sunset,
  TrendingUp,
} from "lucide-react";

import { PageFrame } from "@/components/site-header";
import type { DataState } from "@/lib/domain/data-result";
import { buildDayShape, buildMorningBriefing } from "@/lib/owner-brain/brain";
import { getOperationalSnapshotV1 } from "@/lib/server/operational-snapshot";
import { requireStaffContext } from "@/lib/server/staff-context";
import type {
  DayShape,
  MorningBriefing,
  OperatorAction,
  OwnerWeeklySummary,
} from "@/lib/owner-brain/types";
import type { GettingStarted } from "@/lib/shop-intelligence/types";
import { cn, formatDisplayDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const snapshot = await getOperationalSnapshotV1(branchId);
  const brain = snapshot.result.data?.brain;
  const morning = snapshot.result.data?.intelligence.morning;
  const date = formatDisplayDate(new Date(snapshot.asOf));

  // V15.3 — the 20-second orientation read before the actions. Built purely from the same
  // trusted signals the brain already used + the operational morning signal; never shown
  // when the shop is still in setup (no day to brief yet).
  const briefing =
    brain && !brain.setupMode && morning
      ? buildMorningBriefing({ doNow: brain.doNow, later: brain.later, morning })
      : null;

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 pb-28 pt-6 sm:px-6 lg:px-8" data-testid="owner-brain-home">
        <header className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Today</p>
          <h1 className="mt-2 text-3xl font-black">What needs you today</h1>
          <p className="mt-2 text-sm font-semibold text-[#6c5e52]">{date}</p>
        </header>

        {snapshot.result.state !== "HEALTHY" && <TruthStateBanner state={snapshot.result.state} message={snapshot.result.message} />}

        {!brain ? null : brain.setupMode ? (
          <SetupMode gettingStarted={brain.gettingStarted} />
        ) : (
          <>
            {/* V15.3 — the 20-second briefing sits above Do Now. It orients (Yesterday /
                Today / Ignore); it never decides. Compact by design so the actions stay
                dominant and reachable without scrolling. */}
            {briefing && <MorningBriefingPanel briefing={briefing} />}

            {/* V15.1 TODAY OS — Do Now dominates the page. It is the first and largest thing
                the operator acts on; the day-shape + guided walk fold in as a slim lead-in so
                nothing competes with the three actions. */}
            <DoNowZone day={buildDayShape(brain.doNow)} actions={brain.doNow} />

            {/* Everything below recedes. Later is collapsed; the weekly summary is demoted to a
                collapsed "for reference" panel. No dashboard surface sits above Do Now. */}
            <LaterReserve actions={brain.later} />
            <SecondaryInfo weekly={brain.weekly} />
          </>
        )}

        <MoreDetail />
      </main>
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

/**
 * V15.3 — the morning briefing. A calm, compact orientation read before the actions:
 * Yesterday (context) · Today (the shape) · what to ignore (reassurance). Deliberately
 * lighter than Do Now — it explains, it never decides, and it never shows a number.
 */
function MorningBriefingPanel({ briefing }: { briefing: MorningBriefing }) {
  const rows: Array<{ label: string; text: string; testid: string }> = [
    { label: "Yesterday", text: briefing.yesterday, testid: "briefing-yesterday" },
    { label: "Today", text: briefing.today, testid: "briefing-today" },
    { label: "You can ignore", text: briefing.ignore, testid: "briefing-ignore" },
  ];

  return (
    <section className="mt-4 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" data-testid="morning-briefing">
      <div className="flex items-center gap-2">
        <Sunrise className="h-5 w-5 text-[#0f5132]" aria-hidden />
        <h2 className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">Your morning briefing</h2>
      </div>
      <dl className="mt-3 grid gap-2.5">
        {rows.map((row) => (
          <div key={row.testid} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3" data-testid={row.testid}>
            <dt className="shrink-0 text-xs font-black uppercase tracking-[0.08em] text-[#9a8c7d] sm:w-28 sm:pt-0.5">{row.label}</dt>
            <dd className="text-base font-semibold leading-6 text-[#3f372f]">{row.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * V15.1 — the operating-system centre of TODAY. The single dominant zone (bordered, raised)
 * that the operator reads first. At most three actions, chosen by the V15 Action Compression
 * Engine; there is no path to a fourth. The day-shape and guided walk fold in as a slim
 * lead-in so they support — never compete with — the three actions.
 */
function DoNowZone({ day, actions }: { day: DayShape; actions: OperatorAction[] }) {
  return (
    <section
      className="mt-4 scroll-mt-20 rounded-2xl border-2 border-[#0f5132] bg-white p-5 shadow-md sm:p-6"
      data-testid="do-now-zone"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-xl">
            🔴
          </span>
          <h2 className="text-2xl font-black">Do now</h2>
        </div>
        <span className="rounded-full bg-[#0f5132] px-3 py-1 text-xs font-black uppercase tracking-[0.06em] text-white">
          {actions.length === 0 ? "All clear" : `${actions.length} ${actions.length === 1 ? "thing" : "things"}`}
        </span>
      </div>

      {actions.length === 0 ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#f2fbf5] p-4" data-testid="day-shape">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-[#0f5132]" aria-hidden />
          <div>
            <p className="text-lg font-black text-[#0f5132]">You&apos;re clear to trade</p>
            <p className="text-sm font-semibold text-[#27543c]">Nothing needs you right now. Have a good day.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Slim lead-in: the shape of the day + an optional guided walk. Subordinate to the
              action cards below — small, muted, never a filled banner. */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3" data-testid="day-shape">
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#6c5e52]">
              <Clock className="h-4 w-4" aria-hidden />
              {day.timeLabel ? `${day.timeLabel}, one thing at a time` : "One thing at a time"}
            </p>
            <Link
              href="/admin/today/walk"
              data-testid="walk-start"
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-[#bfe3cf] bg-white px-4 text-sm font-bold text-[#0f5132] transition hover:bg-[#eafaf0]"
            >
              <PlayCircle className="h-4 w-4" aria-hidden />
              Walk me through it
            </Link>
          </div>

          <ol className="mt-4 grid gap-3" data-testid="decisions-do-now">
            {actions.map((action, index) => (
              <li key={action.id}>
                <ActionCard action={action} ordinal={index + 1} />
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/**
 * V15.1 — a primary action card. What (title), why (one line — money at stake when we can
 * price it, otherwise what's happening), and the whole card is "do it" (opens the action).
 * Numbered 1·2·3 so the order to work through is unmistakable. Nothing else.
 */
function ActionCard({ action, ordinal }: { action: OperatorAction; ordinal: number }) {
  return (
    <Link
      href={action.href}
      data-testid="decision-row"
      className="flex items-center gap-4 rounded-xl border border-[#ded6ca] bg-[#fbfaf7] p-4 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md sm:p-5"
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0f5132] text-base font-black text-white"
      >
        {ordinal}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-black leading-snug text-[#241f1a] sm:text-xl">{action.title}</p>
        <p className="mt-1 text-sm font-semibold leading-6 text-[#5c5148]">{action.reason}</p>
      </div>
      <ChevronRight className="h-6 w-6 shrink-0 text-[#9a8c7d]" aria-hidden />
    </Link>
  );
}

/**
 * V15 — the Later reserve. Everything that did not make the top three is kept here, never
 * lost, collapsed by default. The butcher is not asked to review it during normal trade —
 * it exists for the moment they want to, plus auditability and debugging.
 */
function LaterReserve({ actions }: { actions: OperatorAction[] }) {
  if (actions.length === 0) return null;

  return (
    // Secondary by design: muted, collapsed, recedes below Do Now. id="opportunities" keeps
    // the guided-walk "ways to grow" link landing here — growth opportunities are the lowest
    // doctrine tier, so they live in the Later reserve now.
    <details
      id="opportunities"
      className="group mt-6 scroll-mt-20 rounded-2xl border border-[#ece2d5] bg-[#fbfaf7] p-5"
      data-testid="later-reserve"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span aria-hidden className="text-base">
            🗂️
          </span>
          <h2 className="text-lg font-black text-[#6c5e52]">Later</h2>
          <p className="text-sm font-semibold text-[#9a8c7d]">Can wait — open if you want a look</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eee7db] px-3 py-1 text-xs font-black uppercase tracking-[0.06em] text-[#6c5e52]">
          {actions.length}
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden />
        </span>
      </summary>

      <ul className="mt-4 grid gap-3" data-testid="decisions-later">
        {actions.map((action) => (
          <li key={action.id}>
            <DecisionRow action={action} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function DecisionRow({ action }: { action: OperatorAction }) {
  return (
    <Link
      href={action.href}
      data-testid="decision-row"
      className="flex items-center gap-3 rounded-xl border border-[#ece2d5] bg-[#fbfaf7] p-4 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-black text-[#241f1a]">{action.title}</p>
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#5c5148]">{action.whyItMatters}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <MoneyChip tone={action.impactTone} label={action.impactLabel} />
          <span className="rounded-full bg-[#eee7db] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#6c5e52]">
            {action.dueLabel}
          </span>
        </div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-[#9a8c7d]" aria-hidden />
    </Link>
  );
}

function MoneyChip({ tone: kind, label }: { tone: OperatorAction["impactTone"]; label: string }) {
  const tone = kind === "opportunity" ? "green" : kind === "none" ? "neutral" : "amber";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-[0.04em]",
        tone === "green" && "bg-[#e6f5ec] text-[#0f5132]",
        tone === "amber" && "bg-[#fff4d8] text-[#8b5e00]",
        tone === "neutral" && "bg-[#eee7db] text-[#6c5e52]",
      )}
    >
      {label}
    </span>
  );
}

/**
 * V15.1 — information demotion. The "How the shop is doing" status panel is retired from
 * TODAY entirely (it changed no behaviour — "the shop is doing well" is not an action).
 * The weekly summary is kept for completeness but demoted to a collapsed, muted "for
 * reference" panel that sits below Do Now and never competes with it.
 */
function SecondaryInfo({ weekly }: { weekly: OwnerWeeklySummary }) {
  return (
    <details className="group mt-6 rounded-2xl border border-[#ece2d5] bg-[#fbfaf7] p-5" data-testid="weekly-owner-summary">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.12em] text-[#9a8c7d]">For reference</p>
          <h2 className="mt-1 text-lg font-black text-[#6c5e52]">Your week at a glance · {weekly.rangeLabel}</h2>
        </div>
        <ChevronDown className="h-5 w-5 shrink-0 text-[#9a8c7d] transition group-open:rotate-180" aria-hidden />
      </summary>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <SummaryColumn title="Wins" tone="green" items={weekly.wins} emptyText="Building up." />
        <SummaryColumn title="Risks" tone="amber" items={weekly.risks} emptyText="None to flag." />
        <SummaryColumn title="Opportunities" tone="neutral" items={weekly.opportunities} emptyText="None yet." />
      </div>
    </details>
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
    { href: "/admin/open", label: "Open the shop", detail: "Morning checklist", icon: Sunrise, testid: "open-shop-link" },
    { href: "/admin/close", label: "Close the shop", detail: "End-of-day checklist", icon: Sunset, testid: "close-shop-link" },
    { href: "/admin/stock-count", label: "Stock count", detail: "Count what's really there", icon: ClipboardCheck, testid: "stock-count-link" },
    { href: "/counter", label: "Counter", detail: "Serve and prepare orders", icon: LayoutDashboard },
    { href: "/admin", label: "Business Insights", detail: "Review the business — numbers & trends", icon: TrendingUp, testid: "business-insights-link" },
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

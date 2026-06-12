import Link from "next/link";
import {
  Archive,
  ArrowRight,
  AlertTriangle,
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
import { getOwnerAwaySummary, type OwnerAwaySummary } from "@/lib/server/owner-away";
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
  const { profile, branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [snapshot, ownerAway] = await Promise.all([
    getOperationalSnapshotV1(branchId),
    profile.role === "owner" ? getOwnerAwaySummary(branchId) : Promise.resolve(null),
  ]);
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
        <header className="px-1">
          <p className="eyebrow text-[var(--brand)]">Today · {date}</p>
          <h1 className="mt-2 font-display text-[2rem] font-semibold leading-[1.04] tracking-[-0.02em] text-[var(--ink)] sm:text-[2.45rem]">
            What needs you today
          </h1>
        </header>
        <div className="rule-engraved mt-4" />

        {snapshot.result.state !== "HEALTHY" && <TruthStateBanner state={snapshot.result.state} message={snapshot.result.message} />}
        {ownerAway && <OwnerAwayTodayPanel summary={ownerAway} />}

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

        <MoreDetail isOwner={profile.role === "owner"} />
      </main>
    </PageFrame>
  );
}

function OwnerAwayTodayPanel({ summary }: { summary: OwnerAwaySummary }) {
  const needsOwner =
    summary.alerts.openCount + summary.evidence.needsReview + summary.evidence.failed + summary.certificates.needsReview;

  return (
    <Link
      href="/admin/away"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#c5ddd0] bg-[var(--brand-50)] px-5 py-4 shadow-[0_1px_0_rgba(255,255,255,0.7)] transition hover:border-[var(--brand)] hover:bg-white"
      data-testid="owner-away-today-panel"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[var(--brand)] ring-1 ring-[#c5ddd0]">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="eyebrow block text-[var(--brand)]">{summary.statusLabel}</span>
          <span className="mt-1 block text-lg font-bold text-[var(--ink)]">{summary.headline}</span>
          <span className="mt-1 block text-sm font-medium text-[var(--muted)]">
            {summary.sales.orderCount} sales, {summary.evidence.total} photos, {needsOwner} owner checks.
          </span>
        </span>
      </span>
      <span className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-[var(--brand)] ring-1 ring-[#c5ddd0]">
        Review
        <ChevronRight className="h-4 w-4" aria-hidden />
      </span>
    </Link>
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
    <section
      className="mt-4 rounded-xl border border-[#eccb85] bg-[#fbf1da] p-4 text-sm text-[#5a3900] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
      data-testid="truth-state-banner"
    >
      <p className="font-bold">{label[state]}</p>
      <p className="mt-1 font-medium">{message}</p>
    </section>
  );
}

function SetupMode({ gettingStarted }: { gettingStarted: GettingStarted }) {
  return (
    <section
      className="mt-4 overflow-hidden rounded-2xl border border-[#bfe0cd] bg-[var(--card)] shadow-[0_1px_0_rgba(255,255,255,0.7),0_24px_50px_-38px_rgba(15,81,50,0.5)]"
      data-testid="setup-mode"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#dcebe2] bg-gradient-to-b from-[var(--brand-50)] to-transparent px-5 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-[#13653e] to-[#0a3a24] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
            <Sprout className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="eyebrow text-[var(--brand)]">Getting started</p>
            <h2 className="mt-1 font-display text-xl font-semibold text-[var(--brand)]">{gettingStarted.title}</h2>
          </div>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.06em] text-[var(--brand)] ring-1 ring-[#bfe0cd]">
          {gettingStarted.doneCount} of {gettingStarted.totalCount} done
        </span>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <p className="text-sm leading-6 text-[#27543c]">{gettingStarted.intro}</p>

        <ol className="mt-4 grid gap-3">
          {gettingStarted.steps.map((step) => (
            <li
              key={step.id}
              className={cn(
                "flex flex-wrap items-start gap-3 rounded-xl border p-4",
                step.done ? "border-[#cfe6da] bg-[#f4faf6]" : "border-[var(--line)] bg-white",
              )}
            >
              {step.done ? (
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[var(--brand)]" aria-hidden />
              ) : (
                <Circle className="mt-0.5 h-6 w-6 shrink-0 text-[#9fb3a6]" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className={cn("text-base font-bold", step.done ? "text-[var(--muted)] line-through" : "text-[var(--ink)]")}>{step.text}</p>
                {!step.done && <p className="mt-1 text-sm leading-6 text-[#5c5148]">{step.why}</p>}
              </div>
              {!step.done && (
                <Link
                  href={step.href}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_-12px_rgba(15,81,50,0.6)] transition hover:bg-[var(--brand-700)]"
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
      </div>
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
    <section
      className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[0_1px_0_rgba(255,255,255,0.7),0_18px_40px_-34px_rgba(40,28,16,0.4)]"
      data-testid="morning-briefing"
    >
      <div className="flex items-center gap-2.5 border-b border-[var(--line)] bg-[var(--cream)]/50 px-5 py-3">
        <Sunrise className="h-4 w-4 text-[var(--brand)]" aria-hidden />
        <h2 className="eyebrow text-[var(--muted)]">Your morning briefing</h2>
      </div>
      <dl className="grid gap-3 px-5 py-4">
        {rows.map((row) => (
          <div key={row.testid} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4" data-testid={row.testid}>
            <dt className="shrink-0 text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[var(--faint)] sm:w-28 sm:pt-1">{row.label}</dt>
            <dd className="text-[0.95rem] font-medium leading-6 text-[#3a322b]">{row.text}</dd>
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
      className="mt-4 scroll-mt-24 overflow-hidden rounded-2xl border border-[#c5ddd0] bg-[var(--card)] shadow-[0_1px_0_rgba(255,255,255,0.85),0_34px_64px_-44px_rgba(15,81,50,0.5)]"
      data-testid="do-now-zone"
    >
      <div className="flex items-center justify-between gap-4 border-b border-[#d6e8df] bg-gradient-to-b from-[var(--brand-50)] to-transparent px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span aria-hidden className="relative grid h-7 w-7 place-items-center rounded-full bg-white ring-1 ring-[#bcd8c8]">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand)] shadow-[0_0_0_3px_rgba(15,81,50,0.12)]" />
          </span>
          <h2 className="font-display text-[1.6rem] font-semibold leading-none text-[var(--ink)]">Do now</h2>
        </div>
        <span className="rounded-full bg-[var(--brand)] px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
          {actions.length === 0 ? "All clear" : `${actions.length} ${actions.length === 1 ? "thing" : "things"}`}
        </span>
      </div>

      <div className="px-5 py-5 sm:px-6">
        {actions.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-[#cfe6da] bg-[#f4faf6] p-4" data-testid="day-shape">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-[var(--brand)]" aria-hidden />
            <div>
              <p className="font-display text-lg font-semibold text-[var(--brand)]">You&apos;re clear to trade</p>
              <p className="text-sm font-medium text-[#27543c]">Nothing needs you right now. Have a good day.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Slim lead-in: the shape of the day + an optional guided walk. Subordinate to the
                action cards below — small, muted, never a filled banner. */}
            <div className="flex flex-wrap items-center justify-between gap-3" data-testid="day-shape">
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted)]">
                <Clock className="h-4 w-4" aria-hidden />
                {day.timeLabel ? `${day.timeLabel}, one thing at a time` : "One thing at a time"}
              </p>
              <Link
                href="/admin/today/walk"
                data-testid="walk-start"
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[#c5ddd0] bg-white px-4 text-sm font-semibold text-[#0f5132] shadow-[0_1px_0_rgba(255,255,255,0.6)] transition hover:border-[#0f5132] hover:bg-[var(--brand-50)]"
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
      </div>
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
      className="group flex items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 transition duration-150 hover:-translate-y-0.5 hover:border-[#c5ddd0] hover:bg-white hover:shadow-[0_20px_34px_-24px_rgba(40,28,16,0.5)] sm:p-5"
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-[#13653e] to-[#0a3a24] font-display text-lg font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_16px_-10px_rgba(15,81,50,0.7)]"
      >
        {ordinal}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-bold leading-snug text-[var(--ink)] sm:text-[1.2rem]">{action.title}</p>
        <p className="mt-1 text-sm font-medium leading-6 text-[var(--muted)]">{action.reason}</p>
      </div>
      <ChevronRight className="h-6 w-6 shrink-0 text-[var(--faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" aria-hidden />
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
      className="group mt-6 scroll-mt-24 rounded-2xl border border-[var(--line)] bg-[var(--cream)]/40 p-5"
      data-testid="later-reserve"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Archive className="h-4 w-4 text-[var(--faint)]" aria-hidden />
          <h2 className="font-display text-lg font-semibold text-[var(--muted)]">Later</h2>
          <p className="hidden text-sm font-medium text-[var(--faint)] sm:block">Can wait — open if you want a look</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eadfce] px-3 py-1 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted)]">
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
      className="group flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white p-4 transition duration-150 hover:-translate-y-0.5 hover:border-[#cbd9cf] hover:shadow-[0_18px_30px_-24px_rgba(40,28,16,0.5)]"
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold text-[var(--ink)]">{action.title}</p>
        <p className="mt-1 line-clamp-2 text-sm font-medium leading-6 text-[var(--muted)]">{action.whyItMatters}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <MoneyChip tone={action.impactTone} label={action.impactLabel} />
          <span className="rounded-full bg-[#eadfce] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--muted)]">
            {action.dueLabel}
          </span>
        </div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-[var(--faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" aria-hidden />
    </Link>
  );
}

function MoneyChip({ tone: kind, label }: { tone: OperatorAction["impactTone"]; label: string }) {
  const tone = kind === "opportunity" ? "green" : kind === "none" ? "neutral" : "amber";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em]",
        tone === "green" && "bg-[#e3f2e9] text-[var(--brand)]",
        tone === "amber" && "bg-[#fbf1da] text-[#8b5e00]",
        tone === "neutral" && "bg-[#eadfce] text-[var(--muted)]",
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
    <details className="group mt-6 rounded-2xl border border-[var(--line)] bg-[var(--cream)]/40 p-5" data-testid="weekly-owner-summary">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <div>
          <p className="eyebrow text-[var(--faint)]">For reference</p>
          <h2 className="mt-1 font-display text-lg font-semibold text-[var(--muted)]">Your week at a glance · {weekly.rangeLabel}</h2>
        </div>
        <ChevronDown className="h-5 w-5 shrink-0 text-[var(--faint)] transition group-open:rotate-180" aria-hidden />
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
        tone === "green" && "border-[#cfe6da] bg-[#f4faf6]",
        tone === "amber" && "border-[#eed9b0] bg-[#fdf7ec]",
        tone === "neutral" && "border-[var(--line)] bg-white",
      )}
    >
      <p
        className={cn(
          "text-[0.7rem] font-bold uppercase tracking-[0.1em]",
          tone === "green" && "text-[var(--brand)]",
          tone === "amber" && "text-[#8b5e00]",
          tone === "neutral" && "text-[var(--muted)]",
        )}
      >
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">{emptyText}</p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {items.map((item) => (
            <li key={item} className="text-sm leading-6 text-[#3a322b]">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MoreDetail({ isOwner }: { isOwner: boolean }) {
  const links = [
    { href: "/admin/away", label: "Owner Away", detail: "Check the shop while out", icon: AlertTriangle, testid: "owner-away-link", ownerOnly: true },
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
    <section className="mt-8">
      <div className="flex items-center gap-3 px-1">
        <p className="eyebrow text-[var(--faint)]">More</p>
        <span aria-hidden className="rule-engraved flex-1" />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.filter((item) => !("ownerOnly" in item) || !item.ownerOnly || isOwner).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            {...(item.testid ? { "data-testid": item.testid } : {})}
            className="group flex min-h-24 flex-col rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_1px_0_rgba(255,255,255,0.6)] transition duration-150 hover:-translate-y-0.5 hover:border-[#c5ddd0] hover:shadow-[0_20px_34px_-26px_rgba(40,28,16,0.5)]"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--brand-50)] text-[var(--brand)] ring-1 ring-[#d6e8df] transition group-hover:bg-[var(--brand)] group-hover:text-white">
              <item.icon className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-3 text-base font-bold text-[var(--ink)]">{item.label}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">{item.detail}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

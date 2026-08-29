import Link from "next/link";
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Sprout,
  Sunrise,
} from "lucide-react";

import { PageFrame } from "@/components/site-header";
import { OwnerOversightPanel } from "@/components/admin-owner-away-client";
import { ReconcileClient } from "@/components/reconcile-client";
import { acknowledgeOwnerAlert } from "@/app/actions/owner-alert";
import type { DataState } from "@/lib/domain/data-result";
import { buildMorningBriefing } from "@/lib/owner-brain/brain";
import { getOperationalSnapshotV1 } from "@/lib/server/operational-snapshot";
import { getOwnerAwaySummary } from "@/lib/server/owner-away";
import { getOwnerAlertDeliveryHealth } from "@/lib/server/alert-dispatch";
import { getReconciliationItems, type ReconcileTray } from "@/lib/server/reconciliation";
import { requireStaffContext } from "@/lib/server/staff-context";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { MorningBriefing, OperatorAction } from "@/lib/owner-brain/types";
import type { GettingStarted } from "@/lib/shop-intelligence/types";
import { cn, formatDisplayDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type LinkedAlert = { id:string; summary:string; severity:string; acknowledged_at:string|null; resolved_at:string|null };
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function TodayPage({searchParams}:{searchParams:Promise<{alert?:string}>}) {
  const { profile, branchId } = await requireStaffContext("manager", { branchScoped: true });
  const linkedId=(await searchParams).alert;
  let linkedAlert:LinkedAlert|null=null;
  if(profile.role==="owner"&&linkedId&&UUID.test(linkedId)){
    const {data}=await createSupabaseServiceClient().from("owner_alerts").select("id,summary,severity,acknowledged_at,resolved_at").eq("id",linkedId).eq("branch_id",branchId).maybeSingle<LinkedAlert>();
    linkedAlert=data;
  }
  const [snapshot, ownerAway, deliveryHealth, ownerJobs] = await Promise.all([
    getOperationalSnapshotV1(branchId),
    profile.role === "owner" ? getOwnerAwaySummary(branchId) : Promise.resolve(null),
    profile.role === "owner" ? getOwnerAlertDeliveryHealth(branchId) : Promise.resolve(null),
    profile.role === "owner" ? getReconciliationItems(branchId, { markSeen: false }) : Promise.resolve(null),
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
      <main className="mx-auto max-w-4xl px-4 pb-28 pt-4 sm:px-6 sm:pt-6 lg:px-8" data-testid="owner-brain-home">
        <header className="px-1">
          <div>
            <p className="eyebrow text-[var(--brand)]">Today · {date}</p>
            <h1 className="mt-2 font-display text-[2rem] font-semibold leading-[1.04] tracking-[-0.02em] text-[var(--ink)] sm:text-[2.45rem]">
              What needs you today
            </h1>
          </div>
        </header>
        <div className="rule-engraved mt-4" />

        {linkedAlert&&<section id={`owner-alert-${linkedAlert.id}`} className="mt-4 scroll-mt-24 rounded-2xl border border-[#e1b86f] bg-[#fff7e8] p-5" data-testid="linked-owner-alert">
          <p className="eyebrow text-[#8b5e00]">Opened from notification</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-[var(--ink)]">Owner alert</h2>
          <p className="mt-2 text-sm font-medium text-[var(--muted)]">{linkedAlert.summary}</p>
          {linkedAlert.resolved_at?<p className="mt-3 text-sm font-bold text-[var(--brand)]">Resolved</p>:linkedAlert.acknowledged_at?<div className="mt-3 flex flex-wrap items-center gap-3"><p className="text-sm font-bold text-[var(--brand)]">Acknowledged — still open until resolved.</p><Link href="#owner-jobs" className="text-sm font-bold text-[var(--brand)] underline">Open owner job</Link></div>:<div className="mt-3 flex flex-wrap items-center gap-3"><form action={acknowledgeOwnerAlert}><input type="hidden" name="alertId" value={linkedAlert.id}/><button className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white">Acknowledge alert</button></form><Link href="#owner-jobs" className="text-sm font-bold text-[var(--brand)] underline">Open owner job</Link></div>}
        </section>}

        {snapshot.result.state !== "HEALTHY" && <TruthStateBanner state={snapshot.result.state} message={snapshot.result.message} />}
        {ownerAway?.settings.ownerAway && deliveryHealth ? <OwnerOversightPanel summary={ownerAway} deliveryHealth={deliveryHealth} /> : null}

        {!brain ? null : brain.setupMode ? (
          <SetupMode gettingStarted={brain.gettingStarted} />
        ) : (
          <>
            {/* Context only: three trusted sentences rendered as one compact briefing. */}
            {briefing && <MorningBriefingPanel briefing={briefing} />}

            {/* Do Now is the first and largest operating surface. Optional guidance lives
                in Menu so all three immediate decisions fit on a phone. */}
            <DoNowZone actions={brain.doNow} />

            {/* Everything below recedes. Later is collapsed and analysis lives in Menu. */}
            <LaterReserve actions={brain.later} />
          </>
        )}

        {ownerJobs && ownerJobs.count > 0 ? <OwnerJobsPanel tray={ownerJobs} focused={linkedAlert !== null} /> : null}
        {ownerAway && !ownerAway.settings.ownerAway && deliveryHealth ? <OwnerOversightPanel summary={ownerAway} deliveryHealth={deliveryHealth} /> : null}
      </main>
    </PageFrame>
  );
}

function OwnerJobsPanel({ tray, focused }: { tray: ReconcileTray; focused: boolean }) {
  return (
    <details id="owner-jobs" open={focused} className="mt-6 scroll-mt-24 rounded-2xl border border-[#e1b86f] bg-[#fffaf0] p-5" data-testid="owner-jobs-on-today">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <span>
          <span className="eyebrow text-[#8b5e00]">Needs your decision</span>
          <span className="mt-1 block font-display text-xl font-semibold text-[var(--ink)]">
            {tray.count} owner job{tray.count === 1 ? "" : "s"}
          </span>
        </span>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-[#8b5e00] ring-1 ring-[#e1b86f]">Open</span>
      </summary>
      <ReconcileClient initialItems={tray.items} />
    </details>
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

  const unavailable = state === "DEGRADED" || state === "UNAVAILABLE";
  const needsAttention = unavailable || state === "CONFIGURATION_REQUIRED" || state === "UNAUTHORISED";
  const heading = unavailable
    ? "PTM couldn't check everything right now."
    : state === "CONFIGURATION_REQUIRED"
      ? "PTM needs setting up."
      : state === "UNAUTHORISED"
        ? "You don't have access to this check."
        : label[state];

  return (
    <section
      className={cn(
        "mt-4 rounded-xl text-sm",
        needsAttention
          ? "border border-[#eccb85] bg-[#fbf1da] p-4 text-[#5a3900] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
          : "px-1 py-2 text-[var(--muted)]",
      )}
      data-testid="truth-state-banner"
    >
      <p className="font-bold">{heading}</p>
      <p className="mt-1 font-medium">{message}</p>
      {unavailable && <Link href="/admin/today" className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-white px-4 font-bold text-[#5a3900] ring-1 ring-[#eccb85]">Try again</Link>}
      {state === "CONFIGURATION_REQUIRED" && <Link href="/admin/settings" className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-white px-4 font-bold text-[#5a3900] ring-1 ring-[#eccb85]">Open settings</Link>}
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
  return (
    <section
      className="mt-3 px-1 py-2 sm:mt-4 sm:rounded-xl sm:border sm:border-[var(--line)] sm:bg-[var(--cream)]/35 sm:px-4 sm:py-3"
      data-testid="morning-briefing"
    >
      <div className="flex items-start gap-2.5">
        <Sunrise className="h-4 w-4 text-[var(--brand)]" aria-hidden />
        <div>
          <h2 className="eyebrow text-[var(--muted)]">Morning briefing</h2>
          <p className="mt-1 text-sm font-medium leading-5 text-[#3a322b] sm:leading-6">
            <span data-testid="briefing-yesterday">{briefing.yesterday}</span>{" "}
            <span data-testid="briefing-today">{briefing.today}</span>{" "}
            <span data-testid="briefing-ignore">{briefing.ignore}</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * The operating-system centre of TODAY. At most three actions, chosen by the existing
 * Action Compression Engine; there is no path to a fourth. Secondary guidance stays in
 * Menu so these decisions remain the complete first-viewport workload.
 */
function DoNowZone({ actions }: { actions: OperatorAction[] }) {
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

      <div className="px-3 py-3 sm:px-6 sm:py-5">
        {actions.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-[#cfe6da] bg-[#f4faf6] p-4" data-testid="day-shape">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-[var(--brand)]" aria-hidden />
            <div>
              <p className="font-display text-lg font-semibold text-[var(--brand)]">You&apos;re clear to trade</p>
              <p className="text-sm font-medium text-[#27543c]">Nothing needs you right now. Have a good day.</p>
            </div>
          </div>
        ) : (
          <ol className="grid gap-3" data-testid="decisions-do-now">
            {actions.map((action, index) => (
              <li key={action.id}>
                <ActionCard action={action} ordinal={index + 1} />
              </li>
            ))}
          </ol>
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
      href={`/admin/today/${encodeURIComponent(action.id)}`}
      data-testid="decision-row"
      className="group flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 transition duration-150 hover:-translate-y-0.5 hover:border-[#c5ddd0] hover:bg-white hover:shadow-[0_20px_34px_-24px_rgba(40,28,16,0.5)] sm:gap-4 sm:p-5"
    >
      <span
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-[#13653e] to-[#0a3a24] font-display text-base font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_16px_-10px_rgba(15,81,50,0.7)] sm:h-10 sm:w-10 sm:text-lg"
      >
        {ordinal}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold leading-snug text-[var(--ink)] sm:text-[1.2rem]">{action.title}</p>
        <p className="mt-1 line-clamp-2 text-sm font-medium leading-5 text-[var(--muted)] sm:leading-6">{action.reason}</p>
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
      href={`/admin/today/${encodeURIComponent(action.id)}`}
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

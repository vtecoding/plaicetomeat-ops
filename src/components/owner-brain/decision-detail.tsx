import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BookOpen, CalendarClock, CheckCircle2, ChevronDown, Coins, Lightbulb, User } from "lucide-react";

import { ACTION_VERB } from "@/lib/owner-brain/action-target";
import type { OperatorAction } from "@/lib/owner-brain/types";

/**
 * The standard action presentation, shared by the Today decision card (`today/[id]`) and
 * the V10 guided walk. Plain data in, no hooks — safe in both server and client trees.
 *
 * V15.4 — this renders an `OperatorAction` only. It has no access to scores, confidence,
 * priority or ranking evidence: those fields do not exist on the type it is handed.
 */
export function DecisionDetail({ action, headingLevel = 1 }: { action: OperatorAction; headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const staysOnDetail = action.destination.startsWith("/admin/today/");
  const ctaLabel = {
    count: "Start stock count",
    order: "Review order",
    sell: "Check stock",
    fix: "Check now",
    review: "Review details",
  }[action.actionType];

  return (
    <div>
      <section className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm sm:p-6" data-testid="decision-detail">
        <span className="inline-flex items-center rounded-full bg-[#e6f5ec] px-3 py-1 text-xs font-black uppercase tracking-[0.08em] text-[#0f5132]">
          {ACTION_VERB[action.actionType]}
        </span>
        <Heading className="mt-3 text-3xl font-black leading-tight">{action.title}</Heading>

        <div className="mt-5 grid gap-4">
          <Block heading="What happened?">{action.whatHappened}</Block>
          <Block heading="Why does it matter?">
            {action.whyItMatters}
            {action.impactTone !== "none" && <strong className="mt-2 block text-lg text-[#8b5e00]">{action.impactLabel}</strong>}
          </Block>
        </div>

        <div className="mt-5 rounded-xl border border-[#bfe3cf] bg-[#f2fbf5] p-4">
          <p className="text-xs font-black uppercase tracking-[0.08em] text-[#0f5132]">PTM recommends</p>
          <p className="mt-1 text-lg font-bold leading-7 text-[#173e2a]">{action.recommendedAction}</p>
          {staysOnDetail ? (
            <a href="#decision-evidence" className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-5 font-bold text-white sm:w-auto">
              {ctaLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          ) : (
            <Link href={action.href} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-5 font-bold text-white sm:w-auto" data-testid="recommended-action">
              {ctaLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
          <Link href="/admin/today" className="mt-3 flex min-h-11 items-center justify-center text-sm font-bold text-[var(--muted)] hover:underline sm:inline-flex sm:pl-5">
            Not now
          </Link>
        </div>
      </section>

      <Evidence action={action} />

      {action.playbook && (
        <Link
          href={`/admin/playbooks/${action.playbook.slug}`}
          className="mt-4 flex items-center gap-3 rounded-2xl border border-[#bfe3cf] bg-[#f2fbf5] p-4 shadow-sm transition hover:bg-[#eafaf0]"
        >
          <BookOpen className="h-5 w-5 shrink-0 text-[#0f5132]" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-black uppercase tracking-[0.08em] text-[#0f5132]">Learn more</span>
            <span className="block text-base font-bold text-[#0f5132]">How to: {action.playbook.title}</span>
          </span>
        </Link>
      )}
    </div>
  );
}

function Block({ heading, accent = false, children }: { heading: string; accent?: boolean; children: ReactNode }) {
  return (
    <div>
      <p className={`text-xs font-black uppercase tracking-[0.08em] ${accent ? "text-[#0f5132]" : "text-[#6c5e52]"}`}>{heading}</p>
      <p className="mt-1 text-base leading-7 text-[#3f372f]">{children}</p>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Coins; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#ece2d5] bg-[#fbfaf7] p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#0f5132]" aria-hidden />
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">{label}</p>
      </div>
      <p className="mt-1.5 text-base font-black text-[#241f1a]">{value}</p>
    </div>
  );
}

function Evidence({ action }: { action: OperatorAction }) {
  return (
    <details id="decision-evidence" className="group mt-4 scroll-mt-24 rounded-2xl border border-[#ece2d5] bg-[#fbfaf7] p-4" data-testid="decision-evidence">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-bold text-[var(--ink)]">
        <span className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-[#8b5e00]" aria-hidden />
          Why does PTM think this?
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-[var(--muted)] transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-3 border-t border-[#ece2d5] pt-4">
        <p className="flex items-start gap-2 text-sm font-semibold leading-6 text-[#3f372f]">
          <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#0f5132]" aria-hidden />
          {action.basisSummary}
        </p>
        {action.supportingFacts.length > 0 && (
          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            {action.supportingFacts.map((fact) => (
              <div key={fact.label} className="rounded-lg bg-white px-3 py-2 ring-1 ring-[#ece2d5]">
                <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[#6c5e52]">{fact.label}</dt>
                <dd className="mt-1 font-black text-[#241f1a]">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Fact icon={Coins} label="Impact" value={action.impactLabel} />
          <Fact icon={User} label="Who" value={action.owner} />
          <Fact icon={CalendarClock} label="When" value={action.dueLabel} />
        </div>
      </div>
    </details>
  );
}

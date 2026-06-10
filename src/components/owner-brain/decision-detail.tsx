import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen, CalendarClock, CheckCircle2, Coins, Lightbulb, User } from "lucide-react";

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

  return (
    <div>
      <header className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
        <span className="inline-flex items-center rounded-full bg-[#e6f5ec] px-3 py-1 text-xs font-black uppercase tracking-[0.08em] text-[#0f5132]">
          {ACTION_VERB[action.actionType]}
        </span>
        <Heading className="mt-3 text-2xl font-black leading-tight">{action.title}</Heading>
      </header>

      <section className="mt-4 grid gap-4 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" data-testid="decision-detail">
        <Block heading="What happened?">{action.whatHappened}</Block>
        <Block heading="Why it matters">{action.whyItMatters}</Block>
        <Block heading="Recommended action" accent>
          {action.recommendedAction}
        </Block>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <Fact icon={Coins} label="Money impact" value={action.impactLabel} />
        <Fact icon={User} label="Who should do it" value={action.owner} />
        <Fact icon={CalendarClock} label="When" value={action.dueLabel} />
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
    <section className="mt-4 rounded-2xl border border-[#ece2d5] bg-[#fbfaf7] p-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-[#8b5e00]" aria-hidden />
        <p className="text-xs font-black uppercase tracking-[0.08em] text-[#6c5e52]">What this is based on</p>
      </div>
      <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-[#3f372f]">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0f5132]" aria-hidden />
        {action.basisSummary}
      </p>
      {action.supportingFacts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {action.supportingFacts.map((fact) => (
            <span key={fact.label} className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-[#5c5148] ring-1 ring-[#ece2d5]">
              {fact.label}: <span className="font-black text-[#241f1a]">{fact.value}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

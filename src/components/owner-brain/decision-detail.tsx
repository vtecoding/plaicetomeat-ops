import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen, CalendarClock, CheckCircle2, Coins, Lightbulb, User } from "lucide-react";

import { CATEGORY_LABEL, DUE_WINDOW_LABEL, type OwnerDecision } from "@/lib/owner-brain/types";

const CATEGORY_TONE = {
  urgent: "red",
  important: "amber",
  opportunity: "green",
} as const;

/**
 * The standard decision presentation, shared by the Today decision card (`today/[id]`)
 * and the V10 guided walk. Plain data in, no hooks — safe in both server and client
 * trees. The heading level is configurable so each surface keeps a correct outline.
 */
export function DecisionDetail({ decision, headingLevel = 1 }: { decision: OwnerDecision; headingLevel?: 1 | 2 }) {
  const tone = CATEGORY_TONE[decision.category];
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <div>
      <header className="rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.08em] ${
            tone === "red"
              ? "bg-[#fde8e7] text-[#9f1d1d]"
              : tone === "amber"
                ? "bg-[#fff4d8] text-[#8b5e00]"
                : "bg-[#e6f5ec] text-[#0f5132]"
          }`}
        >
          {CATEGORY_LABEL[decision.category]}
        </span>
        <Heading className="mt-3 text-2xl font-black leading-tight">{decision.title}</Heading>
      </header>

      <section className="mt-4 grid gap-4 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm" data-testid="decision-detail">
        <Block heading="What happened?">{decision.whatHappened}</Block>
        <Block heading="Why it matters">{decision.whyItMatters}</Block>
        <Block heading="Recommended action" accent>
          {decision.recommendedAction}
        </Block>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <Fact icon={Coins} label="Money impact" value={decision.estimatedImpact.label} />
        <Fact icon={User} label="Who should do it" value={decision.owner} />
        <Fact icon={CalendarClock} label="When" value={DUE_WINDOW_LABEL[decision.dueWindow]} />
      </section>

      <Evidence decision={decision} />

      {decision.playbook && (
        <Link
          href={`/admin/playbooks/${decision.playbook.slug}`}
          className="mt-4 flex items-center gap-3 rounded-2xl border border-[#bfe3cf] bg-[#f2fbf5] p-4 shadow-sm transition hover:bg-[#eafaf0]"
        >
          <BookOpen className="h-5 w-5 shrink-0 text-[#0f5132]" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-black uppercase tracking-[0.08em] text-[#0f5132]">Learn more</span>
            <span className="block text-base font-bold text-[#0f5132]">How to: {decision.playbook.title}</span>
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

function Evidence({ decision }: { decision: OwnerDecision }) {
  const { basis, metrics } = decision.sourceEvidence;
  return (
    <section className="mt-4 rounded-2xl border border-[#ece2d5] bg-[#fbfaf7] p-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-[#8b5e00]" aria-hidden />
        <p className="text-xs font-black uppercase tracking-[0.08em] text-[#6c5e52]">What this is based on</p>
      </div>
      <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-[#3f372f]">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0f5132]" aria-hidden />
        {basis.summary}
      </p>
      {metrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {metrics.map((metric) => (
            <span key={metric.label} className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-[#5c5148] ring-1 ring-[#ece2d5]">
              {metric.label}: <span className="font-black text-[#241f1a]">{metric.value}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

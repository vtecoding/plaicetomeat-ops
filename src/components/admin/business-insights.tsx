import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen, CheckCircle2, Lightbulb, ShieldCheck, Sparkles } from "lucide-react";

import {
  CONFIDENCE_LABEL,
  INTEL_AREA_LABEL,
  type DataBasis,
  type Finding,
  type HealthCategory,
  type HealthScore,
  type IntelConfidence,
  type IntelSeverity,
  type ShopIntelligence,
} from "@/lib/shop-intelligence/types";
import { cn, formatCurrency } from "@/lib/utils";

// V11.3 — the shop-intelligence analysis sections (health score, coaching findings,
// weekly management report, confidence). Lifted out of the retired /admin/briefing
// page so the single analysis hub (/admin "Business Insights") can render them.
// These are ANALYSIS only — the operational narrative (today's briefing items,
// getting-started) stays on Today.

const SEVERITY_TONE: Record<IntelSeverity, "red" | "amber" | "neutral"> = {
  urgent: "red",
  warning: "amber",
  info: "neutral",
};

const SEVERITY_LABEL: Record<IntelSeverity, string> = {
  urgent: "Urgent",
  warning: "Needs attention",
  info: "Good to know",
};

const CONFIDENCE_TONE: Record<IntelConfidence, "green" | "amber" | "neutral"> = {
  high: "green",
  medium: "amber",
  low: "neutral",
};

const BAND_TONE: Record<HealthCategory["band"], "green" | "amber" | "red" | "neutral"> = {
  strong: "green",
  fair: "amber",
  needs_attention: "red",
  unknown: "neutral",
};

export function BusinessInsightsSections({ intel }: { intel: ShopIntelligence }) {
  const attention = intel.findings.filter((finding) => finding.severity !== "info");
  const habits = intel.findings.filter((finding) => finding.severity === "info");

  return (
    <>
      {/* Operational health score. */}
      <Section eyebrow="Business health" title="How the shop is doing" badge={<HealthHeadline health={intel.health} />}>
        <div className="grid gap-3 sm:grid-cols-2" data-testid="health-score">
          {intel.health.categories.map((category) => (
            <HealthBar key={category.key} category={category} />
          ))}
        </div>
        {(intel.health.strong.length > 0 || intel.health.needsAttention.length > 0) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {intel.health.strong.length > 0 && <ChipRow label="Strong" tone="green" items={intel.health.strong} />}
            {intel.health.needsAttention.length > 0 && (
              <ChipRow label="Needs attention" tone="red" items={intel.health.needsAttention} />
            )}
          </div>
        )}
      </Section>

      {/* Findings that need attention. */}
      <Section
        eyebrow="What to look at"
        title="Things to review"
        badge={<CountBadge count={attention.length} tone={attention.length === 0 ? "green" : "amber"} />}
      >
        {attention.length === 0 ? (
          <Reassurance>Nothing urgent. The shop looks in good shape.</Reassurance>
        ) : (
          <div className="grid gap-3" data-testid="findings-attention">
            {attention.map((finding) => (
              <FindingCard key={finding.id} finding={finding} />
            ))}
          </div>
        )}
      </Section>

      {/* Habits & opportunities (info-level coaching). */}
      {habits.length > 0 && (
        <Section eyebrow="Coach" title="Good habits & opportunities">
          <div className="grid gap-3" data-testid="findings-habits">
            {habits.map((finding) => (
              <FindingCard key={finding.id} finding={finding} subtle />
            ))}
          </div>
        </Section>
      )}

      {/* This week — management report. */}
      <Section eyebrow="Management report" title={`This week · ${intel.weekly.rangeLabel}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="weekly-report">
          <ReportStat label="Revenue" value={intel.weekly.revenue === null ? "Building up" : formatCurrency(intel.weekly.revenue)} />
          <ReportStat label="Top product" value={intel.weekly.topProduct ?? "No data yet"} />
          <ReportStat label="Lowest performer" value={intel.weekly.lowestProduct ?? "—"} />
          <ReportStat label="Biggest waste source" value={intel.weekly.biggestWasteSource ?? "None logged"} />
          <ReportStat label="Most at risk of running out" value={intel.weekly.mostFrequentStockRisk ?? "None"} />
          <ReportStat label="Compliance" value={intel.weekly.complianceSummary} />
        </div>
        {intel.weekly.notes.length > 0 && (
          <ul className="mt-4 grid gap-2">
            {intel.weekly.notes.map((note) => (
              <li key={note} className="flex items-start gap-2 text-sm text-[#6c5e52]">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[#8b5e00]" aria-hidden />
                {note}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Confidence explainer. */}
      <Section eyebrow="How much to trust this" title="Confidence">
        <div className="rounded-xl border border-[#ece2d5] bg-[#fbfaf7] p-4" data-testid="confidence-banner">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#0f5132]" aria-hidden />
            <ConfidenceChip basis={intel.confidence} />
          </div>
          <p className="mt-2 text-sm font-semibold text-[#3f372f]">{intel.confidence.summary}</p>
          {intel.confidence.points.length > 0 && (
            <p className="mt-1 text-sm text-[#6c5e52]">Based on: {intel.confidence.points.join(" · ")}</p>
          )}
          <Link
            href="/admin/playbooks/reading-your-briefing"
            className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[#0f5132] underline-offset-2 hover:underline"
          >
            <BookOpen className="h-4 w-4" aria-hidden />
            How to read these numbers
          </Link>
        </div>
      </Section>
    </>
  );
}

function FindingCard({ finding, subtle = false }: { finding: Finding; subtle?: boolean }) {
  const tone = SEVERITY_TONE[finding.severity];
  return (
    <article
      data-testid="finding-card"
      className={cn(
        "rounded-xl border p-4",
        subtle
          ? "border-[#ece2d5] bg-[#fbfaf7]"
          : tone === "red"
            ? "border-[#f5c2c7] bg-[#fff5f5]"
            : tone === "amber"
              ? "border-[#f4d7a1] bg-[#fff9ef]"
              : "border-[#ece2d5] bg-[#fbfaf7]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {subtle && <Sparkles className="h-4 w-4 text-[#8b5e00]" aria-hidden />}
          <h3 className="text-base font-black text-[#241f1a]">{finding.finding}</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#eee7db] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[#6c5e52]">
            {INTEL_AREA_LABEL[finding.area]}
          </span>
          <SeverityBadge severity={finding.severity} />
        </div>
      </div>

      <dl className="mt-3 grid gap-2 text-sm">
        <ExplainRow term="Why" detail={finding.explanation} />
        <ExplainRow term="If ignored" detail={finding.consequence} />
        <ExplainRow term="Do this" detail={finding.recommendedAction} accent />
      </dl>

      {finding.metrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {finding.metrics.map((metric) => (
            <span key={metric.label} className="rounded-lg bg-white/70 px-2.5 py-1 text-xs font-semibold text-[#5c5148] ring-1 ring-[#ece2d5]">
              {metric.label}: <span className="font-black text-[#241f1a]">{metric.value}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[#ece2d5] pt-3">
        <ConfidenceChip basis={finding.basis} />
        <span className="text-xs text-[#6c5e52]">{finding.basis.summary}</span>
        {finding.playbook && (
          <Link
            href={`/admin/playbooks/${finding.playbook.slug}`}
            className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-[#0f5132] underline-offset-2 hover:underline"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            How to: {finding.playbook.title}
          </Link>
        )}
      </div>
    </article>
  );
}

function ExplainRow({ term, detail, accent = false }: { term: string; detail: string; accent?: boolean }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2">
      <dt className={cn("text-xs font-black uppercase tracking-[0.06em]", accent ? "text-[#0f5132]" : "text-[#6c5e52]")}>{term}</dt>
      <dd className="text-sm leading-6 text-[#3f372f]">{detail}</dd>
    </div>
  );
}

function Section({ eyebrow, title, badge, children }: { eyebrow: string; title: string; badge?: ReactNode; children: ReactNode }) {
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

function HealthHeadline({ health }: { health: HealthScore }) {
  if (health.score === null) {
    return (
      <span className="rounded-full bg-[#eee7db] px-3 py-1 text-xs font-black uppercase tracking-[0.06em] text-[#6c5e52]">
        Not enough data
      </span>
    );
  }
  const tone = health.band === "strong" ? "green" : health.band === "fair" ? "amber" : "red";
  return (
    <div className="text-right">
      <p
        className={cn(
          "text-3xl font-black",
          tone === "green" && "text-[#0f5132]",
          tone === "amber" && "text-[#8b5e00]",
          tone === "red" && "text-[#9f1d1d]",
        )}
      >
        {health.score}
        <span className="text-base font-bold text-[#6c5e52]"> / 100</span>
      </p>
    </div>
  );
}

function HealthBar({ category }: { category: HealthCategory }) {
  const tone = BAND_TONE[category.band];
  const unknown = category.band === "unknown";
  return (
    <div className="rounded-xl border border-[#ece2d5] bg-[#fbfaf7] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black text-[#241f1a]">{category.label}</p>
        <p className="text-xs font-bold text-[#6c5e52]">{unknown ? "—" : `${category.score}/100`}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#ece2d5]">
        {!unknown && (
          <div
            className={cn(
              "h-full rounded-full",
              tone === "green" && "bg-[#0f5132]",
              tone === "amber" && "bg-[#d9a300]",
              tone === "red" && "bg-[#c0392b]",
            )}
            style={{ width: `${category.score}%` }}
          />
        )}
      </div>
      <p className="mt-1.5 text-xs text-[#6c5e52]">{category.detail}</p>
    </div>
  );
}

function ChipRow({ label, tone, items }: { label: string; tone: "green" | "red"; items: string[] }) {
  return (
    <div className={cn("rounded-xl border p-3", tone === "green" ? "border-[#bfe3cf] bg-[#f2fbf5]" : "border-[#f5c2c7] bg-[#fff5f5]")}>
      <p className={cn("text-xs font-black uppercase tracking-[0.06em]", tone === "green" ? "text-[#0f5132]" : "text-[#9f1d1d]")}>{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#3f372f] ring-1 ring-[#ece2d5]">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function ReportStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#ece2d5] bg-[#fbfaf7] p-4">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">{label}</p>
      <p className="mt-1 text-lg font-black text-[#241f1a]">{value}</p>
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

function SeverityBadge({ severity }: { severity: IntelSeverity }) {
  const tone = SEVERITY_TONE[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-[0.06em]",
        tone === "red" && "bg-[#fde8e7] text-[#9f1d1d]",
        tone === "amber" && "bg-[#fff4d8] text-[#8b5e00]",
        tone === "neutral" && "bg-[#e6f5ec] text-[#0f5132]",
      )}
    >
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

function CountBadge({ count, tone }: { count: number; tone: "green" | "amber" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.08em]",
        tone === "green" ? "bg-[#e6f5ec] text-[#0f5132]" : "bg-[#fff4d8] text-[#8b5e00]",
      )}
    >
      {count === 0 ? "All clear" : `${count} to look at`}
    </span>
  );
}

function ConfidenceChip({ basis }: { basis: DataBasis }) {
  const tone = CONFIDENCE_TONE[basis.confidence];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-[0.06em]",
        tone === "green" && "bg-[#e6f5ec] text-[#0f5132]",
        tone === "amber" && "bg-[#fff4d8] text-[#8b5e00]",
        tone === "neutral" && "bg-[#eee7db] text-[#6c5e52]",
      )}
    >
      {CONFIDENCE_LABEL[basis.confidence]}
    </span>
  );
}

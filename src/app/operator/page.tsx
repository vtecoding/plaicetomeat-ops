import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Coins, DoorOpen, FileText, HelpCircle, Moon, ShoppingBag, Trash2, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { OperatorText } from "@/app/operator/_components/operator-language";
import { ShopDayLink, ShopDayLock } from "@/app/operator/_components/shop-day-link";
import type { OperatorTranslationKey } from "@/lib/operator/i18n/resources";
import { StartDryRunCard } from "@/lib/operator/tutorial/context";
import { canPerformShopDayAction, type ShopDayPhase } from "@/lib/domain/shop-day";
import { getOwnerJobsForCurrentOwner, type ReconcileItem } from "@/lib/server/reconciliation";
import { getPersistedShopDay } from "@/lib/server/shop-day";
import { requireStaffContext } from "@/lib/server/staff-context";

// V17 Operator home — the only screen Uncle Gul starts from.
// Four big buttons (plus an optional Help). No counts, no scores, no metrics —
// just words that change with the day. The lead (brand-tinted) door is the one
// thing to do next, mirroring TODAY's "one next action" discipline.

export const dynamic = "force-dynamic";

type Door = {
  href: string;
  testId: string;
  title: OperatorTranslationKey;
  helper: OperatorTranslationKey;
  icon: LucideIcon;
  lead: boolean;
  done?: boolean;
  disabled?: boolean;
  tutorialTarget?: string;
};

export default async function OperatorHomePage() {
  const { branchId, profile } = await requireStaffContext("manager", { branchScoped: true });
  const [shopDay, ownerQueue] = await Promise.all([
    getPersistedShopDay(branchId),
    profile.role === "owner" ? getOwnerJobsForCurrentOwner({ markSeen: false }) : Promise.resolve(null),
  ]);

  const openDone = shopDay.openingStatus === "completed";
  const closeStarted = shopDay.phase === "closing";
  const closeDone = shopDay.phase === "closed";
  const tradingAllowed = canPerformShopDayAction(shopDay.phase, "serve_customer");

  // Exactly one lead door from persisted Shop Day truth.
  const lead: "open" | "serve" | "close" | null =
    shopDay.phase === "not_open" || shopDay.phase === "opening"
      ? "open"
      : shopDay.phase === "trading"
        ? "serve"
        : shopDay.phase === "closing"
          ? "close"
          : null;
  const lockedHelper = shopDay.phase === "closing" ? "day.lockedDuringClose" : shopDay.phase === "closed" ? "day.finishedToday" : "day.lockedUntilOpen";

  const doors: Door[] = [
    {
      href: "/operator/open",
      testId: "open-shop",
      title: "home.open",
      helper: openDone ? "home.doneToday" : "home.openStart",
      icon: DoorOpen,
      lead: lead === "open",
      done: openDone,
      disabled: openDone,
      tutorialTarget: "nav-open",
    },
    {
      href: "/operator/serve",
      testId: "serve-customer",
      title: "home.serve",
      helper: tradingAllowed ? "home.serveHelp" : lockedHelper,
      icon: ShoppingBag,
      lead: lead === "serve",
      disabled: !tradingAllowed,
      tutorialTarget: "nav-serve",
    },
    {
      href: "/operator/stock",
      testId: "stock-delivery",
      title: "home.stock",
      helper: tradingAllowed ? "home.stockHelp" : lockedHelper,
      icon: Truck,
      lead: false,
      disabled: !tradingAllowed,
      tutorialTarget: "nav-stock",
    },
    {
      href: "/operator/waste",
      testId: "record-waste",
      title: "page.waste.title",
      helper: tradingAllowed ? "page.waste.helper" : lockedHelper,
      icon: Trash2,
      lead: false,
      disabled: !tradingAllowed,
      tutorialTarget: "nav-waste",
    },
    {
      href: "/operator/certificate",
      testId: "paper-photo",
      title: "home.paper",
      helper: "home.paperHelp",
      icon: FileText,
      lead: false,
    },
    {
      href: "/operator/close",
      testId: "close-shop",
      title: "home.close",
      helper: closeDone ? "home.doneToday" : closeStarted ? "home.closeContinue" : "home.closeFinish",
      icon: Moon,
      lead: lead === "close",
      done: closeDone,
      disabled: shopDay.phase !== "trading" && shopDay.phase !== "closing",
      tutorialTarget: "nav-close",
    },
  ];

  return (
    <div data-testid="operator-home">
      <ShopDayStatus phase={shopDay.phase} businessDate={shopDay.businessDate} />

      {ownerQueue ? <OwnerJobsCard count={ownerQueue.count} job={ownerQueue.items[0] ?? null} /> : null}

      <OperatorText as="h2" className="mb-4 mt-7 font-display text-2xl font-semibold" k="home.question" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {doors.map((door) => (
          <DoorTile key={door.href} door={door} />
        ))}
      </div>

      <TillTile disabled={!tradingAllowed} helper={tradingAllowed ? "home.tillHelp" : lockedHelper} />

      <Link
        href="/operator/help"
        data-tutorial="nav-help"
        className="mt-4 flex min-h-[72px] items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-5 py-4 text-start shadow-sm transition active:scale-[0.99]"
      >
        <HelpCircle className="h-8 w-8 shrink-0 text-[var(--clay)]" aria-hidden />
        <span>
          <OperatorText as="span" className="block text-xl font-semibold" k="home.help" />
          <OperatorText as="span" className="block text-base text-[var(--muted)]" k="home.helpHint" />
        </span>
      </Link>

      <StartDryRunCard />
    </div>
  );
}

function DoorTile({ door }: { door: Door }) {
  const Icon = door.icon;

  const content = (
    <>
      <span className="flex items-center justify-between">
        <Icon
          className={["h-10 w-10", door.lead ? "text-[var(--brand)]" : "text-[var(--ink)]"].join(" ")}
          aria-hidden
        />
        {door.done ? <CheckCircle2 className="h-7 w-7 text-[var(--brand)]" aria-hidden /> : <ShopDayLock disabled={door.disabled === true} />}
      </span>
      <span>
        <OperatorText as="span" className="block font-display text-2xl font-semibold tracking-[-0.01em]" k={door.title} />
        <OperatorText as="span" className="mt-1 block text-base text-[var(--muted)]" k={door.helper} />
      </span>
    </>
  );

  return (
    <ShopDayLink
      href={door.href}
      disabled={door.disabled === true}
      testId={`operator-door-${door.testId}`}
      tutorialTarget={door.tutorialTarget}
      baseClass="flex min-h-[156px] flex-col justify-between rounded-2xl border px-6 py-5 shadow-sm transition"
      enabledClass={door.lead ? "border-[var(--brand)] bg-[var(--brand-50)] active:scale-[0.99]" : "border-[var(--line)] bg-[var(--card)] active:scale-[0.99]"}
      disabledClass="cursor-not-allowed border-[var(--line)] bg-[#f4f1eb] opacity-65"
    >
      {content}
    </ShopDayLink>
  );
}

function ShopDayStatus({ phase, businessDate }: { phase: ShopDayPhase; businessDate: string }) {
  const copy: Record<ShopDayPhase, [OperatorTranslationKey, OperatorTranslationKey]> = {
    not_open: ["day.notOpen.title", "day.notOpen.help"],
    opening: ["day.opening.title", "day.opening.help"],
    trading: ["day.trading.title", "day.trading.help"],
    closing: ["day.closing.title", "day.closing.help"],
    closed: ["day.closed.title", "day.closed.help"],
  };
  const [title, help] = copy[phase];
  const safe = phase === "trading" || phase === "closed";

  return (
    <section className={["rounded-3xl border p-6", safe ? "border-[#cfe6da] bg-[#f4faf6]" : "border-[#ead8ba] bg-[#fff8ec]"].join(" ")} data-testid={`shop-day-${phase}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <OperatorText as="p" className="text-xs font-bold uppercase tracking-[0.11em] text-[var(--brand)]" k="day.eyebrow" />
          <OperatorText as="h1" className="mt-1 font-display text-3xl font-semibold tracking-[-0.02em] text-[var(--ink)]" k={title} />
          <OperatorText as="p" className="mt-2 text-base font-medium text-[var(--muted)]" k={help} />
        </div>
        <time className="shrink-0 rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-[var(--muted)]" dateTime={businessDate}>{businessDate}</time>
      </div>
    </section>
  );
}

function OwnerJobsCard({ count, job }: { count: number; job: ReconcileItem | null }) {
  if (!job) {
    return (
      <section className="mt-4 flex items-center gap-3 rounded-2xl border border-[#cfe6da] bg-[#f4faf6] p-4" data-testid="owner-decisions-clear">
        <CheckCircle2 className="h-6 w-6 text-[var(--brand)]" aria-hidden />
        <OperatorText as="p" className="font-semibold text-[#27543c]" k="owner.decisions.clear" />
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-2xl border border-[#e8c9bd] bg-[#fff7f2] p-5" data-testid="owner-decision-preview">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 h-6 w-6 shrink-0 text-[var(--clay)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <OperatorText as="p" className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--clay)]" k="owner.decisions.eyebrow" />
          <OperatorText as="h2" className="mt-1 font-display text-2xl font-semibold text-[var(--ink)]" k="owner.decisions.title" />
          <p className="mt-2 text-lg font-bold text-[var(--ink)]">{job.title}</p>
          <JobFact copyKey="owner.decisions.problem" value={job.problem} />
          <JobFact copyKey="owner.decisions.why" value={job.whyItMatters} />
          <JobFact copyKey="owner.decisions.recommendation" value={job.recommendation} accent />
          <JobFact copyKey="owner.decisions.ignored" value={job.ifIgnored} />
          <Link href="/admin/reconcile" className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--brand)] px-5 font-bold text-white">
            <OperatorText k="owner.decisions.openAll" values={{ count }} />
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}

function JobFact({ copyKey, value, accent = false }: { copyKey: OperatorTranslationKey; value: string; accent?: boolean }) {
  return (
    <div className="mt-3">
      <OperatorText as="p" className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--faint)]" k={copyKey} />
      <p className={["mt-0.5 text-sm font-semibold", accent ? "text-[var(--brand)]" : "text-[var(--muted)]"].join(" ")}>{value}</p>
    </div>
  );
}

function TillTile({ disabled, helper }: { disabled: boolean; helper: OperatorTranslationKey }) {
  const content = (
    <>
      <Coins className="h-8 w-8 shrink-0 text-[var(--brand)]" aria-hidden />
      <span>
        <OperatorText as="span" className="block text-xl font-semibold" k="home.till" />
        <OperatorText as="span" className="block text-base text-[var(--muted)]" k={helper} />
      </span>
    </>
  );
  return (
    <ShopDayLink
      href="/operator/till"
      disabled={disabled}
      testId="operator-till-link"
      tutorialTarget="nav-till"
      baseClass="mt-4 flex min-h-[72px] items-center gap-4 rounded-2xl border px-5 py-4 text-start shadow-sm transition"
      enabledClass="border-[var(--line)] bg-[var(--card)] active:scale-[0.99]"
      disabledClass="cursor-not-allowed border-[var(--line)] bg-[#f4f1eb] opacity-65"
    >
      {content}
      <ShopDayLock disabled={disabled} />
    </ShopDayLink>
  );
}

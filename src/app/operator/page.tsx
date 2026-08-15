import Link from "next/link";
import { CheckCircle2, Coins, DoorOpen, FileText, HelpCircle, Moon, ShoppingBag, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { OperatorText } from "@/app/operator/_components/operator-language";
import type { OperatorTranslationKey } from "@/lib/operator/i18n/resources";
import { getTodaysChecklistState } from "@/lib/server/ops-capture";
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
};

export default async function OperatorHomePage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [opening, closing] = await Promise.all([
    getTodaysChecklistState(branchId, "opening"),
    getTodaysChecklistState(branchId, "closing"),
  ]);

  const openDone = opening.status === "completed";
  const closeStarted = closing.status === "in_progress";
  const closeDone = closing.status === "completed";

  // Exactly one lead door: open first, then trade, then close.
  const lead: "open" | "serve" | "close" = !openDone ? "open" : closeStarted ? "close" : "serve";

  const doors: Door[] = [
    {
      href: "/operator/open",
      testId: "open-shop",
      title: "home.open",
      helper: openDone ? "home.doneToday" : "home.openStart",
      icon: DoorOpen,
      lead: lead === "open",
      done: openDone,
    },
    {
      href: "/operator/serve",
      testId: "serve-customer",
      title: "home.serve",
      helper: "home.serveHelp",
      icon: ShoppingBag,
      lead: lead === "serve",
    },
    {
      href: "/operator/stock",
      testId: "stock-delivery",
      title: "home.stock",
      helper: "home.stockHelp",
      icon: Truck,
      lead: false,
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
    },
  ];

  return (
    <div data-testid="operator-home">
      <OperatorText as="h1" className="sr-only" k="home.question" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {doors.map((door) => (
          <DoorTile key={door.href} door={door} />
        ))}
      </div>

      <Link
        href="/operator/till"
        data-testid="operator-till-link"
        className="mt-4 flex min-h-[72px] items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-5 py-4 text-start shadow-sm transition active:scale-[0.99]"
      >
        <Coins className="h-8 w-8 shrink-0 text-[var(--brand)]" aria-hidden />
        <span>
          <OperatorText as="span" className="block text-xl font-semibold" k="home.till" />
          <OperatorText as="span" className="block text-base text-[var(--muted)]" k="home.tillHelp" />
        </span>
      </Link>

      <Link
        href="/operator/help"
        className="mt-4 flex min-h-[72px] items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-5 py-4 text-start shadow-sm transition active:scale-[0.99]"
      >
        <HelpCircle className="h-8 w-8 shrink-0 text-[var(--clay)]" aria-hidden />
        <span>
          <OperatorText as="span" className="block text-xl font-semibold" k="home.help" />
          <OperatorText as="span" className="block text-base text-[var(--muted)]" k="home.helpHint" />
        </span>
      </Link>
    </div>
  );
}

function DoorTile({ door }: { door: Door }) {
  const Icon = door.icon;

  return (
    <Link
      href={door.href}
      data-testid={`operator-door-${door.testId}`}
      className={[
        "flex min-h-[156px] flex-col justify-between rounded-2xl border px-6 py-5 shadow-sm transition active:scale-[0.99]",
        door.lead ? "border-[var(--brand)] bg-[var(--brand-50)]" : "border-[var(--line)] bg-[var(--card)]",
      ].join(" ")}
    >
      <span className="flex items-center justify-between">
        <Icon
          className={["h-10 w-10", door.lead ? "text-[var(--brand)]" : "text-[var(--ink)]"].join(" ")}
          aria-hidden
        />
        {door.done ? <CheckCircle2 className="h-7 w-7 text-[var(--brand)]" aria-hidden /> : null}
      </span>
      <span>
        <OperatorText as="span" className="block font-display text-2xl font-semibold tracking-[-0.01em]" k={door.title} />
        <OperatorText as="span" className="mt-1 block text-base text-[var(--muted)]" k={door.helper} />
      </span>
    </Link>
  );
}

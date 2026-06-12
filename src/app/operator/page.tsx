import Link from "next/link";
import { CheckCircle2, DoorOpen, FileText, HelpCircle, Moon, ShoppingBag, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { getTodaysChecklistState } from "@/lib/server/ops-capture";
import { requireStaffContext } from "@/lib/server/staff-context";

// V17 Operator home — the only screen Uncle Gul starts from.
// Four big buttons (plus an optional Help). No counts, no scores, no metrics —
// just words that change with the day. The lead (brand-tinted) door is the one
// thing to do next, mirroring TODAY's "one next action" discipline.

export const dynamic = "force-dynamic";

type Door = {
  href: string;
  title: string;
  helper: string;
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
      title: "Open Shop",
      helper: openDone ? "Done today" : "Start the day",
      icon: DoorOpen,
      lead: lead === "open",
      done: openDone,
    },
    {
      href: "/operator/serve",
      title: "Serve Customer",
      helper: "Sell over the counter",
      icon: ShoppingBag,
      lead: lead === "serve",
    },
    {
      href: "/operator/stock",
      title: "Stock / Delivery",
      helper: "Arrived, ran out, or waste",
      icon: Truck,
      lead: false,
    },
    {
      href: "/operator/certificate",
      title: "Paper Photo",
      helper: "Halal, supplier, or fridge",
      icon: FileText,
      lead: false,
    },
    {
      href: "/operator/close",
      title: "Close Shop",
      helper: closeDone ? "Done today" : closeStarted ? "Not finished — tap to continue" : "Finish the day",
      icon: Moon,
      lead: lead === "close",
      done: closeDone,
    },
  ];

  return (
    <div data-testid="operator-home">
      <h1 className="sr-only">What would you like to do?</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {doors.map((door) => (
          <DoorTile key={door.href} door={door} />
        ))}
      </div>

      <Link
        href="/operator/help"
        className="mt-4 flex min-h-[72px] items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-5 py-4 text-left shadow-sm transition active:scale-[0.99]"
      >
        <HelpCircle className="h-8 w-8 shrink-0 text-[var(--clay)]" aria-hidden />
        <span>
          <span className="block text-xl font-semibold">Help / Call Owner</span>
          <span className="block text-base text-[var(--muted)]">Something&rsquo;s wrong</span>
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
      data-testid={`operator-door-${door.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}
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
        <span className="block font-display text-2xl font-semibold tracking-[-0.01em]">{door.title}</span>
        <span className="mt-1 block text-base text-[var(--muted)]">{door.helper}</span>
      </span>
    </Link>
  );
}

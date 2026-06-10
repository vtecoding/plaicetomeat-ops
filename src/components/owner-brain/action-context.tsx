import Link from "next/link";
import { ArrowLeft, Target } from "lucide-react";

import { ACTION_VERB, type ActionType } from "@/lib/owner-brain/action-target";

const KNOWN_ACTION: Record<string, ActionType> = {
  count: "count",
  order: "order",
  sell: "sell",
  fix: "fix",
  review: "review",
};

/** Title-case a slug back into a product name, e.g. "chicken-breast" → "Chicken Breast". */
function slugToLabel(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * V15.2 — the "why you arrived" banner shown at the top of every action destination.
 *
 * It is rebuilt entirely from the URL (`from`, `do`, `focus`, `why`) so the context
 * survives a refresh with no server round-trip, and it always offers an explicit
 * Back-to-Today return. It renders nothing unless the operator actually came from TODAY,
 * so the destination pages behave normally when reached any other way.
 */
export function ActionContext({
  from,
  doParam,
  focus,
  why,
}: {
  from?: string;
  doParam?: string;
  focus?: string;
  why?: string;
}) {
  if (from !== "today") return null;

  const actionType = doParam ? KNOWN_ACTION[doParam] : undefined;
  const verb = actionType ? ACTION_VERB[actionType] : null;
  const item = focus ? slugToLabel(focus) : null;
  const headline = verb && item ? `${verb} ${item}` : verb ?? item ?? "Here's what to do";

  return (
    <section
      className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl border-2 border-[#0f5132] bg-[#f2fbf5] p-4 shadow-sm sm:p-5"
      data-testid="action-context"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0f5132] text-white">
          <Target className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-[#0f5132]">From Today</p>
          <p className="mt-0.5 text-lg font-black leading-snug text-[#0f5132]" data-testid="action-context-headline">
            {headline}
          </p>
          {why && <p className="mt-1 text-sm font-semibold leading-6 text-[#27543c]">{why}</p>}
        </div>
      </div>
      <Link
        href="/admin/today"
        data-testid="action-context-back"
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-[#bfe3cf] bg-white px-4 text-sm font-bold text-[#0f5132] transition hover:bg-[#eafaf0]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to today
      </Link>
    </section>
  );
}

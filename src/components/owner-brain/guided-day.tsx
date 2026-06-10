"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";

import { DecisionDetail } from "@/components/owner-brain/decision-detail";
import type { OperatorAction } from "@/lib/owner-brain/types";

/**
 * V10 guided walk. Steps the owner through Urgent + Important one at a time, so a
 * first-timer never has to decide what to look at next. It is a *review* flow: nothing
 * here changes stock, orders or prices, so we never fake a "done" tick — progress comes
 * from honestly moving through the list to "Ready for trading".
 */
export function GuidedDay({ steps, opportunityCount }: { steps: OperatorAction[]; opportunityCount: number }) {
  // index === steps.length is the finish screen. An empty list lands there immediately.
  const [index, setIndex] = useState(0);
  const total = steps.length;
  const finished = index >= total;

  if (finished) {
    return <Finish opportunityCount={opportunityCount} />;
  }

  const action = steps[index];
  const isLast = index === total - 1;

  return (
    <div data-testid="guided-day">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/today" className="inline-flex items-center gap-1 text-sm font-bold text-[#0f5132] hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Leave walk
        </Link>
        <span className="text-sm font-bold text-[#6c5e52]" data-testid="guided-progress">
          Step {index + 1} of {total}
        </span>
      </div>

      {/* Progress bar — a calm sense of "how far through am I". */}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#ece2d5]">
        <div
          className="h-full rounded-full bg-[#0f5132] transition-all"
          style={{ width: `${Math.round((index / total) * 100)}%` }}
        />
      </div>

      <div className="mt-4" data-testid="guided-step">
        <DecisionDetail action={action} headingLevel={2} />
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          data-testid="guided-back"
          className="inline-flex h-12 items-center gap-2 rounded-full border border-[#d6cdc0] bg-[#f7f3ed] px-5 text-base font-bold text-[#0f5132] transition hover:bg-[#efe8dd] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
          Back
        </button>
        <button
          type="button"
          onClick={() => setIndex((i) => i + 1)}
          data-testid="guided-next"
          className="inline-flex h-12 items-center gap-2 rounded-full bg-[#0f5132] px-6 text-base font-bold text-white transition hover:bg-[#0c3f27]"
        >
          {isLast ? "Finish" : "Next"}
          <ArrowRight className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function Finish({ opportunityCount }: { opportunityCount: number }) {
  return (
    <section
      className="rounded-2xl border border-[#bfe3cf] bg-[#f2fbf5] p-6 text-center shadow-sm"
      data-testid="guided-finish"
    >
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#0f5132] text-white">
        <CheckCircle2 className="h-7 w-7" aria-hidden />
      </span>
      <h2 className="mt-4 text-2xl font-black text-[#0f5132]">Ready for trading</h2>
      <p className="mx-auto mt-2 max-w-md text-base leading-7 text-[#27543c]">
        You&apos;ve been through everything that needed you. Have a good day on the counter.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/admin/today"
          className="inline-flex h-12 items-center gap-2 rounded-full bg-[#0f5132] px-6 text-base font-bold text-white transition hover:bg-[#0c3f27]"
        >
          Back to today
        </Link>
        {opportunityCount > 0 && (
          <Link
            href="/admin/today#opportunities"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-[#bfe3cf] bg-white px-6 text-base font-bold text-[#0f5132] transition hover:bg-[#eafaf0]"
          >
            <Sparkles className="h-5 w-5" aria-hidden />
            {opportunityCount === 1 ? "See 1 way to grow" : `See ${opportunityCount} ways to grow`}
          </Link>
        )}
      </div>
    </section>
  );
}

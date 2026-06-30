"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";

// Operator-friendly recovery for the /counter section. Self-contained because
// /counter has no layout wrapper — provides its own calm, tablet-first surface.

export default function CounterError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("counter route error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--paper)] px-5 py-10 text-center text-[var(--ink)]">
      <div data-testid="counter-error" className="flex w-full max-w-sm flex-col items-center gap-6">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--amber)]/15">
          <AlertTriangle className="h-10 w-10 text-[var(--clay)]" aria-hidden />
        </span>

        <div>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.01em]">Something went wrong</h1>
          <p className="mt-2 text-lg text-[var(--muted)]">
            That didn&rsquo;t work. You can try again or go back to the counter.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="flex min-h-[64px] items-center justify-center gap-3 rounded-2xl border border-[var(--brand)] bg-[var(--brand-50)] px-6 text-xl font-semibold text-[var(--brand-700)] shadow-sm transition active:scale-[0.99]"
          >
            <RotateCcw className="h-7 w-7" aria-hidden />
            Try again
          </button>

          <Link
            href="/counter"
            className="flex min-h-[64px] items-center justify-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-6 text-xl font-semibold shadow-sm transition active:scale-[0.99]"
          >
            <Home className="h-7 w-7" aria-hidden />
            Back to counter
          </Link>
        </div>
      </div>
    </div>
  );
}

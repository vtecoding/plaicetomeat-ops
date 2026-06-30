"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, Home, HelpCircle, RotateCcw } from "lucide-react";

// V17 Operator-friendly recovery screen. Any thrown error under /operator lands
// here instead of the raw Next.js error page. Calm, wordy, big tap targets — no
// stack traces, no technical wording. The operator always has a way home, a way
// to retry, and a way to tell the owner.

export default function OperatorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the server log / monitoring; never to the operator.
    console.error("operator route error", error);
  }, [error]);

  return (
    <div data-testid="operator-error" className="flex flex-col items-center gap-6 py-6 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--amber)]/15">
        <AlertTriangle className="h-10 w-10 text-[var(--clay)]" aria-hidden />
      </span>

      <div>
        <h1 className="font-display text-3xl font-semibold tracking-[-0.01em]">Something went wrong</h1>
        <p className="mt-2 text-lg text-[var(--muted)]">
          That didn&rsquo;t work. Nothing is broken — you can try again or go back.
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="flex min-h-[64px] items-center justify-center gap-3 rounded-2xl border border-[var(--brand)] bg-[var(--brand-50)] px-6 text-xl font-semibold text-[var(--brand-700)] shadow-sm transition active:scale-[0.99]"
        >
          <RotateCcw className="h-7 w-7" aria-hidden />
          Try again
        </button>

        <Link
          href="/operator"
          className="flex min-h-[64px] items-center justify-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-6 text-xl font-semibold shadow-sm transition active:scale-[0.99]"
        >
          <Home className="h-7 w-7" aria-hidden />
          Go back to Operator Home
        </Link>

        <Link
          href="/operator/help"
          className="flex min-h-[64px] items-center justify-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-6 text-xl font-semibold shadow-sm transition active:scale-[0.99]"
        >
          <HelpCircle className="h-7 w-7 text-[var(--clay)]" aria-hidden />
          Tell owner
        </Link>
      </div>
    </div>
  );
}

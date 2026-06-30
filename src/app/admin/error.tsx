"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";

// Section-level recovery for /admin so the owner gets a calm, branded screen
// (with a way back to TODAY and a retry) instead of the raw Next.js error page.

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("admin route error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--paper)] px-5 py-10 text-center text-[var(--ink)]">
      <div data-testid="admin-error" className="flex w-full max-w-md flex-col items-center gap-6">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--amber)]/15">
          <AlertTriangle className="h-9 w-9 text-[var(--clay)]" aria-hidden />
        </span>

        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.01em]">Something went wrong</h1>
          <p className="mt-2 text-base text-[var(--muted)]">
            This screen had a problem. Try again, or go back to Today.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => reset()}
            className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--brand)] bg-[var(--brand-50)] px-5 text-lg font-semibold text-[var(--brand-700)] shadow-sm transition active:scale-[0.99]"
          >
            <RotateCcw className="h-6 w-6" aria-hidden />
            Try again
          </button>
          <Link
            href="/admin/today"
            className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--card)] px-5 text-lg font-semibold shadow-sm transition active:scale-[0.99]"
          >
            <Home className="h-6 w-6" aria-hidden />
            Back to Today
          </Link>
        </div>
      </div>
    </div>
  );
}

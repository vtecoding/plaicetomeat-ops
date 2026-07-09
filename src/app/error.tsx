"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

// Root error boundary. /admin, /operator and /counter each have their own
// error.tsx, so this one mostly faces the public storefront (shop, basket,
// checkout, order status, login). Calm copy, no technical detail, and a way
// back that works for a signed-out visitor.

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("route error", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <main className="mx-auto flex max-w-lg flex-col px-4 py-16 sm:px-6">
        <section data-testid="route-error" className="rounded-lg border border-[#ded6ca] bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-7 w-7 shrink-0 text-[#92510a]" aria-hidden />
            <div>
              <h1 className="text-2xl font-semibold">Something went wrong</h1>
              <p className="mt-2 text-sm leading-6 text-[#6c5e52]">
                This page had a problem. Try once more, or go back to the start.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#0f5132] px-4 text-center text-sm font-bold leading-tight text-white transition hover:bg-[#0c4128]"
            >
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#d6cdc0] bg-white px-4 text-center text-sm font-bold leading-tight text-[#0f5132] transition hover:bg-[#f3efe8]"
            >
              Go back to the start
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

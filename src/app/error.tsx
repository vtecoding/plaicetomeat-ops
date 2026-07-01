"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <main className="mx-auto flex max-w-lg flex-col px-4 py-16 sm:px-6">
        <section className="rounded-lg border border-[#ded6ca] bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-7 w-7 shrink-0 text-[#92510a]" aria-hidden />
            <div>
              <h1 className="text-2xl font-black">This could not be found</h1>
              <p className="mt-2 text-sm leading-6 text-[#6c5e52]">
                Something went wrong while opening this screen. Try once more, or go back to Today.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#d6cdc0] bg-white px-4 text-center text-sm font-bold leading-tight text-[#0f5132] transition hover:bg-[#f3efe8]"
            >
              Try again
            </button>
            <Link
              href="/admin/today"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#0f5132] px-4 text-center text-sm font-bold leading-tight text-white transition hover:bg-[#0c4128]"
            >
              Go back to Today
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#d6cdc0] bg-white px-4 text-center text-sm font-bold leading-tight text-[#0f5132] transition hover:bg-[#f3efe8]"
            >
              Tell owner / go home
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

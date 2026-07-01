import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";

import { PageFrame } from "@/components/site-header";

export const metadata: Metadata = {
  title: "This could not be found",
  robots: { index: false, follow: false },
};

export default function NotFoundPage() {
  return (
    <PageFrame>
      <main className="mx-auto flex max-w-lg flex-col px-4 py-16 sm:px-6">
        <section className="rounded-lg border border-[#ded6ca] bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <SearchX className="mt-0.5 h-7 w-7 shrink-0 text-[#92510a]" aria-hidden />
            <div>
              <h1 className="text-2xl font-black">This could not be found</h1>
              <p className="mt-2 text-sm leading-6 text-[#6c5e52]">
                The link may be old, or the item may have been removed.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
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
    </PageFrame>
  );
}

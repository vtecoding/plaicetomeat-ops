import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { PageFrame } from "@/components/site-header";

export const metadata: Metadata = {
  title: "No access",
  robots: { index: false, follow: false },
};

// V12.2 — explicit "you don't have access" destination. Authority failures send
// staff here instead of silently bouncing them to the home page, so the reason is
// visible and a wrong-account sign-in is obvious.
export default function UnauthorisedPage() {
  return (
    <PageFrame>
      <main className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
        <div className="rounded-lg border border-[#ded6ca] bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-7 w-7 shrink-0 text-[#92510a]" aria-hidden />
            <div>
              <h1 className="text-2xl font-black">You don&apos;t have access to this</h1>
              <p className="mt-2 text-sm leading-6 text-[#6c5e52]">
                Your account is signed in, but it isn&apos;t allowed to open this screen. This can happen if
                you don&apos;t have the right role, or if no branch has been set on your account yet.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-full bg-[#0f5132] px-4 text-sm font-bold text-white transition hover:bg-[#0c4128]"
            >
              Back to the home page
            </Link>
            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-full border border-[#d6cdc0] bg-white px-4 text-sm font-bold text-[#0f5132] transition hover:bg-[#f3efe8]"
            >
              Sign in with a different account
            </Link>
          </div>

          <p className="mt-4 text-xs text-[#8a7d70]">
            If you think this is a mistake, ask the shop owner to check your role and branch.
          </p>
        </div>
      </main>
    </PageFrame>
  );
}

import Link from "next/link";
import { Compass, Home } from "lucide-react";

// Friendly catch-all for bad routes / unknown ids (notFound()). Renders inside
// the root layout, so design tokens are available. Calm, big tap targets, always
// a way back — never the raw Next.js 404.

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--paper)] px-5 py-10 text-center text-[var(--ink)]">
      <div data-testid="not-found" className="flex w-full max-w-sm flex-col items-center gap-6">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--brand-50)]">
          <Compass className="h-10 w-10 text-[var(--brand)]" aria-hidden />
        </span>

        <div>
          <h1 className="font-display text-3xl font-semibold tracking-[-0.01em]">We can&rsquo;t find that</h1>
          <p className="mt-2 text-lg text-[var(--muted)]">
            That page or item isn&rsquo;t here. Let&rsquo;s get you back.
          </p>
        </div>

        <Link
          href="/operator"
          className="flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl border border-[var(--brand)] bg-[var(--brand-50)] px-6 text-xl font-semibold text-[var(--brand-700)] shadow-sm transition active:scale-[0.99]"
        >
          <Home className="h-7 w-7" aria-hidden />
          Go to start
        </Link>
      </div>
    </div>
  );
}

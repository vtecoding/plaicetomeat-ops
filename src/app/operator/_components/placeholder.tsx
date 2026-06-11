import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Phase 1 stub for an Operator workflow that lands in a later phase. Kept
// deliberately plain and reassuring — no jargon, one big way back home.

export function OperatorPlaceholder({ title, line }: { title: string; line: string }) {
  return (
    <div data-testid="operator-placeholder">
      <Link
        href="/operator"
        className="mb-6 inline-flex min-h-[56px] items-center gap-2 text-lg font-semibold text-[var(--brand)]"
      >
        <ArrowLeft className="h-6 w-6" aria-hidden />
        Back
      </Link>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-6 py-8 text-center shadow-sm">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em]">{title}</h1>
        <p className="mt-3 text-lg text-[var(--muted)]">{line}</p>
        <p className="mt-2 text-base text-[var(--muted)]">We&rsquo;re still building this part.</p>
      </div>
    </div>
  );
}

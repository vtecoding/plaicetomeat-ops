"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, Home, HelpCircle, RotateCcw } from "lucide-react";
import { useOperatorI18n } from "@/lib/operator/i18n/context";

// V17 Operator-friendly recovery screen. Any thrown error under /operator lands
// here instead of the raw Next.js error page. Calm, wordy, big tap targets — no
// stack traces, no technical wording. The operator always has a way home, a way
// to retry, and a way to tell the owner.
// The keyed English fallback remains "Something went wrong"; Pashto is selected at render time.

export default function OperatorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useOperatorI18n();
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
        <h1 className="font-display text-3xl font-semibold tracking-[-0.01em]">{t("error.route.title")}</h1>
        <p className="mt-2 text-lg text-[var(--muted)]">
          {t("error.route.help")}
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="flex min-h-[64px] items-center justify-center gap-3 rounded-2xl border border-[var(--brand)] bg-[var(--brand-50)] px-6 text-xl font-semibold text-[var(--brand-700)] shadow-sm transition active:scale-[0.99]"
        >
          <RotateCcw className="h-7 w-7" aria-hidden />
          {t("common.tryAgain")}
        </button>

        <Link
          href="/operator"
          className="flex min-h-[64px] items-center justify-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-6 text-xl font-semibold shadow-sm transition active:scale-[0.99]"
        >
          <Home className="h-7 w-7" aria-hidden />
          {t("error.route.home")}
        </Link>

        <Link
          href="/operator/help"
          className="flex min-h-[64px] items-center justify-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] px-6 text-xl font-semibold shadow-sm transition active:scale-[0.99]"
        >
          <HelpCircle className="h-7 w-7 text-[var(--clay)]" aria-hidden />
          {t("common.tellOwner")}
        </Link>
      </div>
    </div>
  );
}

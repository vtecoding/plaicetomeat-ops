"use client";

import { Languages } from "lucide-react";
import type { ReactNode } from "react";

import { useOperatorI18n } from "@/lib/operator/i18n/context";

export function OperatorLanguageControl() {
  const { locale, setLocale, t } = useOperatorI18n();

  return (
    <div
      className="inline-flex min-h-11 items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--paper)] p-1"
      role="group"
      aria-label={t("language.label")}
      dir="ltr"
      data-testid="operator-language-control"
    >
      <Languages className="mx-1 h-4 w-4 text-[var(--muted)]" aria-hidden />
      <button
        type="button"
        lang="en"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
        className="min-h-9 rounded-full px-3 text-sm font-semibold aria-pressed:bg-[var(--brand)] aria-pressed:text-white"
      >
        English
      </button>
      <span aria-hidden className="text-[var(--faint)]">|</span>
      <button
        type="button"
        lang="ps-AF"
        dir="rtl"
        aria-pressed={locale === "ps-AF"}
        onClick={() => setLocale("ps-AF")}
        className="min-h-9 rounded-full px-3 text-base font-semibold aria-pressed:bg-[var(--brand)] aria-pressed:text-white"
      >
        پښتو
      </button>
    </div>
  );
}

export function OperatorLocaleSurface({ children }: { children: ReactNode }) {
  const { locale, dir } = useOperatorI18n();
  return (
    <div
      className="operator-locale flex min-h-screen flex-col bg-[var(--paper)] text-[var(--ink)]"
      lang={locale}
      dir={dir}
      data-operator-locale={locale}
    >
      {children}
    </div>
  );
}

export function OperatorLoginSurface({ children }: { children: ReactNode }) {
  const { locale, dir } = useOperatorI18n();
  return <div className="min-h-screen overflow-x-hidden" lang={locale} dir={dir}>{children}</div>;
}

export function OperatorText({
  k,
  values,
  as: Tag = "span",
  className,
}: {
  k: Parameters<ReturnType<typeof useOperatorI18n>["t"]>[0];
  values?: Record<string, string | number>;
  as?: "span" | "p" | "h1" | "h2";
  className?: string;
}) {
  const { t } = useOperatorI18n();
  return <Tag className={className}>{t(k, values)}</Tag>;
}

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Shared operator-screen layout primitives — the "craft butcher" design language as
 * reusable parts, so every admin/operator screen reads like TODAY instead of an ad-hoc card.
 */

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)] transition-all hover:gap-2.5 hover:text-[var(--brand-700)]"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden /> {children}
    </Link>
  );
}

/** Editorial page header: small-caps eyebrow, serif title, optional subtitle + actions. */
export function Masthead({
  eyebrow,
  title,
  subtitle,
  back,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  back?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("px-1", className)}>
      {back}
      <div className={cn("flex flex-wrap items-end justify-between gap-4", back ? "mt-4" : "")}>
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow text-[var(--brand)]">{eyebrow}</p>}
          <h1 className="mt-2 font-display text-[1.9rem] font-semibold leading-[1.05] tracking-[-0.02em] text-[var(--ink)] sm:text-[2.3rem]">
            {title}
          </h1>
          {subtitle && <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[var(--muted)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="rule-engraved mt-5" />
    </header>
  );
}

/** A raised paper card — the standard content surface. */
export function Surface({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[0_1px_0_rgba(255,255,255,0.7),0_18px_40px_-34px_rgba(40,28,16,0.4)]",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A section heading with a serif title and optional supporting line. */
export function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold tracking-[-0.01em] text-[var(--ink)]">{title}</h2>
      {subtitle && <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{subtitle}</p>}
    </div>
  );
}

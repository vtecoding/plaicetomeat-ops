"use client";

import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

import { useOperatorDryRun } from "@/lib/operator/tutorial/context";

export function ShopDayLink({
  href,
  disabled,
  testId,
  tutorialTarget,
  baseClass,
  enabledClass,
  disabledClass,
  children,
}: {
  href: string;
  disabled: boolean;
  testId: string;
  tutorialTarget?: string;
  baseClass: string;
  enabledClass: string;
  disabledClass: string;
  children: ReactNode;
}) {
  const dryRun = useOperatorDryRun();
  const unavailable = disabled && !dryRun.active;
  const className = `${baseClass} ${unavailable ? disabledClass : enabledClass}`;

  if (unavailable) {
    return <div aria-disabled="true" data-testid={testId} className={className}>{children}</div>;
  }

  return <Link href={href} data-testid={testId} data-tutorial={tutorialTarget} className={className}>{children}</Link>;
}

export function ShopDayLock({ disabled }: { disabled: boolean }) {
  const dryRun = useOperatorDryRun();
  if (!disabled || dryRun.active) return null;
  return <LockKeyhole className="h-6 w-6 text-[var(--faint)]" aria-hidden />;
}

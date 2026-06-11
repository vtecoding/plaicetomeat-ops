import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";
import { requireStaffContext } from "@/lib/server/staff-context";

// V17 Operator Mode shell. The single guided front door for a low-tech operator.
// No admin navigation, no dashboards — just a big, calm, tablet-first surface.
//
// Authority is belt-and-braces: the middleware already locks operator accounts to
// /operator, and we re-check manager rank here so the page can never render for a
// counter-staff session. Authority rank is unchanged — operator adapters resolve
// as `manager` exactly like the owner pathway.

export const dynamic = "force-dynamic";

export default async function OperatorLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireStaffContext("manager");
  const firstName = profile.fullName?.trim().split(/\s+/)[0] ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--paper)] text-[var(--ink)]">
      <header className="border-b border-[var(--line)] bg-[var(--card)]/80 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4">
          <div>
            <p className="eyebrow text-[var(--brand)]">PlaiceToMeat</p>
            <p className="font-display text-xl font-semibold tracking-[-0.01em]">
              {firstName ? `Hello, ${firstName}` : "Welcome"}
            </p>
          </div>
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-6 pb-20">{children}</main>
    </div>
  );
}

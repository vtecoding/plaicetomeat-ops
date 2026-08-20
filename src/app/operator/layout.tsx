import type { ReactNode } from "react";

import { OperatorLanguageControl, OperatorLocaleSurface, OperatorScriptStyleControl, OperatorText } from "@/app/operator/_components/operator-language";
import { LogoutButton } from "@/components/logout-button";
import { OperatorLocaleProvider } from "@/lib/operator/i18n/context";
import { OperatorDryRunProvider } from "@/lib/operator/tutorial/context";
import { getOperatorLocale, getOperatorScriptStyle } from "@/lib/operator/i18n/server";
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
  const [locale, scriptStyle] = await Promise.all([getOperatorLocale(), getOperatorScriptStyle()]);
  const firstName = profile.fullName?.trim().split(/\s+/)[0] ?? null;

  return (
    <OperatorLocaleProvider initialLocale={locale} initialScriptStyle={scriptStyle} applyDocumentDirection>
      <OperatorLocaleSurface>
        <OperatorDryRunProvider>
        <header className="border-b border-[var(--line)] bg-[var(--card)]/80 px-5 py-4 backdrop-blur">
          <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow text-[var(--brand)]">PlaiceToMeat</p>
              <p className="font-display text-xl font-semibold tracking-[-0.01em]">
                {firstName ? <OperatorText k="shell.hello" values={{ name: firstName }} /> : <OperatorText k="shell.welcome" />}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <OperatorLanguageControl />
              <OperatorScriptStyleControl />
              <LogoutButton />
            </div>
          </div>
        </header>

          <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-6 pb-20">{children}</main>
        </OperatorDryRunProvider>
      </OperatorLocaleSurface>
    </OperatorLocaleProvider>
  );
}

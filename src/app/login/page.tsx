import { redirect } from "next/navigation";

import { OperatorLanguageControl, OperatorLoginSurface, OperatorScriptStyleControl, OperatorText } from "@/app/operator/_components/operator-language";
import { LoginForm } from "@/components/login-form";
import { PasswordResetRequest } from "@/components/password-reset-request";
import { resolvePostLoginPath, sanitizeReturnTo } from "@/lib/domain/auth";
import { OperatorLocaleProvider } from "@/lib/operator/i18n/context";
import { translateOperator } from "@/lib/operator/i18n/resources";
import { getOperatorLocale, getOperatorScriptStyle } from "@/lib/operator/i18n/server";
import { getCurrentProfile } from "@/lib/server/auth";

export async function generateMetadata() {
  const locale = await getOperatorLocale();
  return { title: translateOperator(locale, "login.title"), robots: { index: false, follow: false } };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const params = await searchParams;
  const returnTo = sanitizeReturnTo(params.returnTo) ?? undefined;
  const [locale, scriptStyle] = await Promise.all([getOperatorLocale(), getOperatorScriptStyle()]);

  const profile = await getCurrentProfile();

  if (profile) {
    redirect(resolvePostLoginPath(profile.role, returnTo, profile.operatorMode));
  }

  return (
    <OperatorLocaleProvider initialLocale={locale} initialScriptStyle={scriptStyle} applyDocumentDirection>
      <OperatorLoginSurface>
        <header className="border-b border-[var(--line)] bg-[var(--card)]/80 px-4 py-3">
          <div className="mx-auto flex max-w-md flex-wrap items-center justify-between gap-3">
            <span className="font-display text-xl font-semibold">PlaiceToMeat</span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <OperatorLanguageControl />
              <OperatorScriptStyleControl />
            </div>
          </div>
        </header>
        <main className="mx-auto flex max-w-md flex-col px-4 py-12 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[0_1px_0_rgba(255,255,255,0.7),0_40px_80px_-50px_rgba(40,28,16,0.5)]">
          <div className="border-b border-[var(--line)] bg-gradient-to-b from-[var(--brand-50)] to-transparent px-6 py-6">
            <OperatorText as="p" className="eyebrow text-[var(--brand)]" k="login.eyebrow" />
            <OperatorText as="h1" className="mt-2 font-display text-3xl font-semibold tracking-[-0.02em] text-[var(--ink)]" k="login.title" />
            <OperatorText as="p" className="mt-2 text-sm font-medium text-[var(--muted)]" k="login.help" />
          </div>

          <div className="px-6 py-6">
            <LoginForm returnTo={returnTo} />

            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <PasswordResetRequest />
            </div>
          </div>
        </div>
        </main>
      </OperatorLoginSurface>
    </OperatorLocaleProvider>
  );
}

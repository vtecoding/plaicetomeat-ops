import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { PasswordResetRequest } from "@/components/password-reset-request";
import { PageFrame } from "@/components/site-header";
import { resolvePostLoginPath, sanitizeReturnTo } from "@/lib/domain/auth";
import { getCurrentProfile } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Staff login",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const params = await searchParams;
  const returnTo = sanitizeReturnTo(params.returnTo) ?? undefined;

  const profile = await getCurrentProfile();

  if (profile) {
    redirect(resolvePostLoginPath(profile.role, returnTo, profile.operatorMode));
  }

  return (
    <PageFrame>
      <main className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[0_1px_0_rgba(255,255,255,0.7),0_40px_80px_-50px_rgba(40,28,16,0.5)]">
          <div className="border-b border-[var(--line)] bg-gradient-to-b from-[var(--brand-50)] to-transparent px-6 py-6">
            <p className="eyebrow text-[var(--brand)]">Staff &amp; back office</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.02em] text-[var(--ink)]">Sign in</h1>
            <p className="mt-2 text-sm font-medium text-[var(--muted)]">
              Counter and admin tools are restricted to PlaiceToMeat staff accounts.
            </p>
          </div>

          <div className="px-6 py-6">
            <LoginForm returnTo={returnTo} />

            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <PasswordResetRequest />
            </div>
          </div>
        </div>
      </main>
    </PageFrame>
  );
}

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
    redirect(resolvePostLoginPath(profile.role, returnTo));
  }

  return (
    <PageFrame>
      <main className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
        <div className="rounded-lg border border-[#ded6ca] bg-white p-6 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Staff &amp; back office</p>
          <h1 className="mt-2 text-2xl font-black">Sign in</h1>
          <p className="mt-2 text-sm text-[#6c5e52]">
            Counter and admin tools are restricted to PlaiceToMeat staff accounts.
          </p>

          <div className="mt-6">
            <LoginForm returnTo={returnTo} />
          </div>

          <div className="mt-4 border-t border-[#eee5d8] pt-4">
            <PasswordResetRequest />
          </div>
        </div>
      </main>
    </PageFrame>
  );
}

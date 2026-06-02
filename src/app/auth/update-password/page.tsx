import type { Metadata } from "next";

import { PageFrame } from "@/components/site-header";
import { UpdatePasswordForm } from "@/components/update-password-form";

export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function UpdatePasswordPage() {
  return (
    <PageFrame>
      <main className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
        <div className="rounded-lg border border-[#ded6ca] bg-white p-6 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Account</p>
          <h1 className="mt-2 text-2xl font-black">Set a new password</h1>
          <p className="mt-2 text-sm text-[#6c5e52]">
            Choose a new password for your PlaiceToMeat account. Keep it private — don&apos;t share or write it down.
          </p>

          <div className="mt-6">
            <UpdatePasswordForm />
          </div>
        </div>
      </main>
    </PageFrame>
  );
}

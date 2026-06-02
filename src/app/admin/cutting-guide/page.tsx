import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Scissors } from "lucide-react";

import { CarcassCalculator } from "@/components/carcass-calculator";
import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";

export const metadata = { title: "Cutting & Pricing Guide" };
export const dynamic = "force-dynamic";

export default async function CuttingGuidePage() {
  const profile = await getCurrentProfile();
  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm font-bold text-[#0f5132]">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to dashboard
        </Link>

        <div className="mt-4 flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#0f5132] text-white">
            <Scissors className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Cutting &amp; Pricing Guide</p>
            <h1 className="mt-1 text-3xl font-black">What&apos;s a whole animal worth?</h1>
            <p className="mt-1 text-sm leading-6 text-[#6c5e52]">
              Pick an animal, enter what you paid, and see exactly how it breaks down into cuts — how much of each you
              get, what each is best used for, and what to charge to actually make money. The most important number is
              your <strong>real meat cost</strong>: after bone and fat, your meat costs more per kg than the carcass did.
            </p>
          </div>
        </div>

        <section className="mt-8 rounded-2xl border border-[#ded6ca] bg-white p-5 shadow-sm sm:p-6">
          <CarcassCalculator />
        </section>

        <p className="mt-6 text-sm text-[#6c5e52]">
          Tip: once you know a cut&apos;s suggested price, set it in{" "}
          <Link href="/admin/products" className="font-bold text-[#0f5132]">
            Products &amp; Prices
          </Link>{" "}
          — then the dashboard can show your real profit per product.
        </p>
      </main>
    </PageFrame>
  );
}

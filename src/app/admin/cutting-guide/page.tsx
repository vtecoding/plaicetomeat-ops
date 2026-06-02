import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CarcassCalculator } from "@/components/carcass-calculator";
import { PageFrame } from "@/components/site-header";
import { MANAGER_ROLES } from "@/lib/domain/route-access";
import { getCurrentProfile } from "@/lib/server/auth";
import { getAllProducts, getPublicBranch } from "@/lib/server/catalog";

export const metadata = { title: "Cutting & Pricing Guide" };
export const dynamic = "force-dynamic";

export default async function CuttingGuidePage() {
  const profile = await getCurrentProfile();
  if (!profile || !MANAGER_ROLES.includes(profile.role)) {
    redirect("/");
  }

  const branch = await getPublicBranch();
  const products = (await getAllProducts(profile.branchId ?? branch.id)).map((p) => ({ id: p.id, name: p.name }));

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm font-bold text-[#0f5132]">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to dashboard
        </Link>

        <div className="mt-4">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Cutting &amp; Pricing Guide</p>
          <h1 className="mt-1 text-3xl font-black">Carcass pricing calculator</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6c5e52]">
            Bought a carcass? Enter the weight and what you paid, then get clear recommended prices for each cut.
          </p>
        </div>

        <section className="mt-8">
          <CarcassCalculator products={products} />
        </section>

        <p className="mt-6 text-sm text-[#6c5e52]">
          When you are ready to sync a simulator price, open the advanced product section or update{" "}
          <Link href="/admin/products" className="font-bold text-[#0f5132]">
            Products &amp; Prices
          </Link>.
        </p>
      </main>
    </PageFrame>
  );
}

import Link from "next/link";

import { CarcassCalculator } from "@/components/carcass-calculator";
import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead } from "@/components/ui/page";
import { getAllProducts, getProductCostMap } from "@/lib/server/catalog";
import { getSuppliers } from "@/lib/server/compliance-inventory";
import { requireStaffContext } from "@/lib/server/staff-context";

export const metadata = { title: "Cutting & Pricing Guide" };
export const dynamic = "force-dynamic";

export default async function CuttingGuidePage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const [allProducts, costMap, supplierRows] = await Promise.all([
    getAllProducts(branchId),
    getProductCostMap(branchId),
    getSuppliers(branchId, { publicOnly: true }),
  ]);
  const products = allProducts.map((p) => ({
    id: p.id,
    name: p.name,
    pricePerUnit: p.pricePerUnit,
    costPerKg: costMap.get(p.id) ?? null,
  }));
  const suppliers = supplierRows.map((s) => ({ id: s.id, name: s.name }));

  return (
    <PageFrame>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Masthead
          back={<BackLink href="/admin">Back to dashboard</BackLink>}
          eyebrow="Cutting & Pricing Guide"
          title="What's a whole animal worth?"
          subtitle="Pick an animal, enter what arrived, then check the estimate against what you actually cut. Stock should only be added after the real weights are confirmed."
        />

        <div className="mt-6 rounded-md border border-[#f0d8a8] bg-[#fdf6e9] px-4 py-3 text-sm text-[#92510a]" data-testid="yield-estimate-disclaimer">
          <p className="font-bold">Yield estimates — butcher sign-off required</p>
          <p className="mt-1">
            All yield percentages on this page are system assumptions, not verified measurements.
            Until a butcher has reviewed and approved them on the{" "}
            <a href="/admin/validation/pricing" className="font-bold underline">
              Butcher pricing sign-off
            </a>{" "}
            page, treat all cut pricing as estimates only.
          </p>
        </div>

        <section className="mt-8">
          <CarcassCalculator products={products} branchId={branchId} suppliers={suppliers} />
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

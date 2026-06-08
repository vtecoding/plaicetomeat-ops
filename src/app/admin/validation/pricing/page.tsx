import { ShieldAlert } from "lucide-react";

import { PricingValidationClient } from "@/components/pricing-validation-client";
import { PageFrame } from "@/components/site-header";
import { getPricingValidations } from "@/lib/server/pricing-validation";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function PricingValidationPage() {
  const { branchId } = await requireStaffContext("manager", { branchScoped: true });
  const result = await getPricingValidations(branchId);

  const unavailable = result.state === "UNAVAILABLE" || result.state === "CONFIGURATION_REQUIRED";
  const records = result.data ?? [];

  return (
    <PageFrame>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Validation · V13.1</p>
          <h1 className="mt-2 text-3xl font-black">Butcher pricing sign-off</h1>
          <p className="mt-2 max-w-3xl text-sm text-[#6c5e52]">
            Sit a real butcher in front of this. For each cut, compare what the system recommends with
            what the butcher knows from the block — yields, trim and wastage assumptions, and the price
            they&apos;d actually charge. Record <strong>Approved</strong> or <strong>Changes required</strong>
            for every cut. The result becomes the launch sign-off evidence.
          </p>
        </div>

        {unavailable ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-[#f0c66e] bg-[#fff6df] p-5 text-sm text-[#5a3900]" data-testid="pricing-validation-unavailable">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-black">Pricing validation is unavailable right now.</p>
              <p className="mt-1">{result.message}</p>
            </div>
          </div>
        ) : (
          <PricingValidationClient initialRecords={records} />
        )}
      </main>
    </PageFrame>
  );
}

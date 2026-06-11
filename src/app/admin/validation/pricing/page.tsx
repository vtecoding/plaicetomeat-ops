import { ShieldAlert } from "lucide-react";

import { PricingValidationClient } from "@/components/pricing-validation-client";
import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead } from "@/components/ui/page";
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
        <Masthead
          back={<BackLink href="/admin">Back to dashboard</BackLink>}
          eyebrow="Validation"
          title="Butcher pricing sign-off"
          subtitle="For each cut, mark Approved or Changes required against the butcher's real yield and price. This becomes the launch sign-off evidence."
        />

        {unavailable ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-[#f0c66e] bg-[#fff6df] p-5 text-sm text-[#5a3900]" data-testid="pricing-validation-unavailable">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-bold">Pricing validation is unavailable right now.</p>
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

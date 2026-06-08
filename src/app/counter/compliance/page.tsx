import { ShieldAlert } from "lucide-react";

import { ComplianceClient } from "@/components/compliance-client";
import { PageFrame } from "@/components/site-header";
import { getComplianceDayResult } from "@/lib/server/compliance";
import { requireStaffContext } from "@/lib/server/staff-context";

export const dynamic = "force-dynamic";

export default async function CounterCompliancePage() {
  const { branchId } = await requireStaffContext("staff", { branchScoped: true });
  const result = await getComplianceDayResult(branchId);

  // Honest truth state: a configuration/connectivity failure must NOT be disguised
  // as an empty or fabricated log. NO_DATA is a real, expected "nothing yet today".
  const unavailable = result.state === "UNAVAILABLE" || result.state === "CONFIGURATION_REQUIRED";
  const day = result.data ?? { log: null, readings: [] };

  return (
    <PageFrame>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Compliance vault</p>
          <h1 className="mt-2 text-3xl font-black">Daily log</h1>
          <p className="mt-2 text-sm text-[#6c5e52]">Record today&apos;s fridge and freezer temperatures and your end-of-day checks.</p>
        </div>

        {unavailable ? (
          <div
            className="mt-6 flex items-start gap-3 rounded-lg border border-[#f0c66e] bg-[#fff6df] p-5 text-sm text-[#5a3900]"
            data-testid="compliance-unavailable"
          >
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-black">Compliance records are unavailable right now.</p>
              <p className="mt-1">{result.message}</p>
            </div>
          </div>
        ) : (
          <ComplianceClient branchId={branchId} log={day.log} readings={day.readings} />
        )}
      </main>
    </PageFrame>
  );
}

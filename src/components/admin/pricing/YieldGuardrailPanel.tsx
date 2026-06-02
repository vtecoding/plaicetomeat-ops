import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { MassIntegrity, YieldAssessment } from "@/lib/domain/yield-guardrails";

type YieldGuardrailPanelProps = {
  assessments: readonly YieldAssessment[];
  massIntegrity: MassIntegrity;
  selectedCutId: string | null;
};

export function YieldGuardrailPanel({ assessments, massIntegrity, selectedCutId }: YieldGuardrailPanelProps) {
  const selected = assessments.find((assessment) => assessment.cutId === selectedCutId) ?? assessments[0] ?? null;
  const warnings = assessments.filter((assessment) => assessment.status !== "normal").slice(0, 4);

  return (
    <section className="rounded-xl border border-[#ded6ca] bg-white p-4" data-testid="yield-guardrail-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#1f1b16]">Yield guardrails</p>
          <p className="text-xs leading-5 text-[#6c5e52]">Warnings only. Saving is not blocked.</p>
        </div>
        <Badge tone={massIntegrity.ok ? "green" : "amber"}>{massIntegrity.ok ? "Mass accounted" : "Mass warning"}</Badge>
      </div>

      <div className="mt-3 rounded-lg border border-[#ded6ca] bg-[#fbfaf7] p-3">
        <StatusIcon warning={!massIntegrity.ok} />
        <p className="mt-2 text-sm leading-6 text-[#5c5148]">{massIntegrity.explanation}</p>
        <p className="mt-1 text-xs text-[#8a7d70]">
          Raw {massIntegrity.rawWeightKg}kg = moisture {massIntegrity.moistureLossKg}kg + saleable {massIntegrity.saleableKg}kg + waste{" "}
          {massIntegrity.wasteKg}kg.
        </p>
      </div>

      {selected ? (
        <div className="mt-3 rounded-lg border border-[#ded6ca] bg-white p-3">
          <div className="flex items-center gap-2">
            <StatusIcon warning={selected.severity === "warning" || selected.status === "low_yield"} />
            <p className="text-sm font-black text-[#1f1b16]">{selected.cutName}</p>
          </div>
          <p className="mt-2 text-sm leading-6 text-[#5c5148]">{selected.explanation}</p>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {warnings.map((warning) => (
            <p key={warning.cutId} className="rounded-md bg-[#fdf6e9] px-3 py-2 text-xs leading-5 text-[#92510a]">
              {warning.explanation}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-md bg-[#f2fbf5] px-3 py-2 text-xs leading-5 text-[#0f5132]">
          All configured cut yields are inside expected ranges.
        </p>
      )}
    </section>
  );
}

function StatusIcon({ warning }: { warning: boolean }) {
  if (warning) return <AlertTriangle className="inline h-4 w-4 text-[#92510a]" aria-hidden />;
  return <CheckCircle2 className="inline h-4 w-4 text-[#0f5132]" aria-hidden />;
}

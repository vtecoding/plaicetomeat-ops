import { Badge } from "@/components/ui/badge";
import type { MassIntegrity, YieldAssessment } from "@/lib/domain/yield-guardrails";

type YieldGuardrailPanelProps = {
  assessments: readonly YieldAssessment[];
  massIntegrity: MassIntegrity;
  selectedCutId: string | null;
};

export function YieldGuardrailPanel({ assessments, massIntegrity, selectedCutId }: YieldGuardrailPanelProps) {
  const selected = assessments.find((assessment) => assessment.cutId === selectedCutId) ?? null;
  const warnings = assessments.filter((assessment) => assessment.status !== "normal");
  const selectedWarning = selected && selected.status !== "normal" ? selected : null;

  if (massIntegrity.ok && warnings.length === 0) {
    return (
      <section className="rounded-xl border border-[#b7dcc8] bg-[#e8f6ee] p-3" data-testid="yield-guardrail-panel">
        <p className="text-xs font-bold text-[#0f5132]">No pricing warnings</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[#f0d8a8] bg-[#fff8e8] p-4" data-testid="yield-guardrail-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#1f1b16]">Pricing warnings</p>
          <p className="text-xs leading-5 text-[#6c5e52]">Check these before using the price.</p>
        </div>
        <Badge tone="amber">Review</Badge>
      </div>

      {!massIntegrity.ok ? <p className="mt-3 text-sm leading-6 text-[#7a4b00]">{massIntegrity.explanation}</p> : null}

      {selectedWarning ? (
        <p className="mt-3 rounded-lg bg-white p-3 text-sm leading-6 text-[#7a4b00]">{plainWarning(selectedWarning.explanation)}</p>
      ) : null}

      <div className="mt-3 grid gap-2">
        {warnings.slice(0, 4).map((warning) => (
          <p key={warning.cutId} className="rounded-md bg-white px-3 py-2 text-xs leading-5 text-[#7a4b00]">
            {plainWarning(warning.explanation)}
          </p>
        ))}
      </div>
    </section>
  );
}

function plainWarning(message: string) {
  return message.replace(/yield/gi, "expected weight");
}

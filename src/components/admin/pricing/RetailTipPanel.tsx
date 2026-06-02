import { Lightbulb } from "lucide-react";

import type { RetailTip } from "@/lib/domain/yield-guardrails";

type RetailTipPanelProps = {
  tips: readonly RetailTip[];
};

export function RetailTipPanel({ tips }: RetailTipPanelProps) {
  return (
    <section className="rounded-xl border border-[#ded6ca] bg-white p-4" data-testid="retail-tip-panel">
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[#0f5132]" aria-hidden />
        <div>
          <p className="text-sm font-black text-[#1f1b16]">Smart retail tips</p>
          <p className="text-xs leading-5 text-[#6c5e52]">Every tip says why it appeared. No weather API or AI is used.</p>
        </div>
      </div>

      {tips.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {tips.map((tip) => (
            <article key={`${tip.cutId}-${tip.message}`} className="rounded-lg bg-[#f7f3ed] p-3">
              <p className="text-sm leading-6 text-[#1f1b16]">{tip.message}</p>
              <p className="mt-1 text-xs leading-5 text-[#6c5e52]">Why: {tip.reason}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-[#f7f3ed] p-3 text-sm leading-6 text-[#6c5e52]">
          No contextual retail tips triggered for this breakdown yet.
        </p>
      )}
    </section>
  );
}

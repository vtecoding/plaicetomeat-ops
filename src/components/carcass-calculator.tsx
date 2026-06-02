"use client";

import { AlertTriangle, Beef, Bird, Info } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { calculateCarcassBreakdown } from "@/lib/butchery/carcass-breakdown";
import { CUT_SHEETS } from "@/lib/butchery/cut-sheets";
import { cn, formatCurrency } from "@/lib/utils";

const TIER_LABEL: Record<string, { label: string; className: string }> = {
  premium: { label: "Premium", className: "bg-[#0f5132] text-white" },
  mid: { label: "Mid", className: "bg-[#e7dca8] text-[#5c4a12]" },
  value: { label: "Value", className: "bg-[#efe8dd] text-[#6c5e52]" },
  stock: { label: "Stock", className: "bg-[#efe8dd] text-[#8a7d70]" },
};

export function CarcassCalculator() {
  const [animalId, setAnimalId] = useState(CUT_SHEETS[0].id);
  const sheet = useMemo(() => CUT_SHEETS.find((s) => s.id === animalId) ?? CUT_SHEETS[0], [animalId]);

  const [weight, setWeight] = useState(String(sheet.typicalCarcassKg));
  const [cost, setCost] = useState("");
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  function selectAnimal(id: string) {
    const next = CUT_SHEETS.find((s) => s.id === id) ?? CUT_SHEETS[0];
    setAnimalId(id);
    setWeight(String(next.typicalCarcassKg));
    setOverrides({});
  }

  const result = useMemo(
    () =>
      calculateCarcassBreakdown({
        sheet,
        carcassWeightKg: Number(weight),
        carcassCost: Number(cost),
        marginOverrides: overrides,
      }),
    [sheet, weight, cost, overrides],
  );

  const hasCost = cost.trim() !== "" && Number(cost) > 0;

  return (
    <div className="grid gap-6">
      {/* Animal picker */}
      <div>
        <p className="text-sm font-bold text-[#5c5148]">1. Which animal?</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CUT_SHEETS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => selectAnimal(s.id)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-black transition",
                s.id === animalId
                  ? "border-[#0f5132] bg-[#0f5132] text-white"
                  : "border-[#ded6ca] bg-white text-[#5c5148] hover:bg-[#f7f3ed]",
              )}
            >
              {s.animal === "Chicken" ? <Bird className="h-4 w-4" aria-hidden /> : <Beef className="h-4 w-4" aria-hidden />}
              {s.animal}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-[#8a7d70]">{sheet.sourcingTip}</p>
      </div>

      {/* Inputs */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-sm font-bold text-[#5c5148]">2. Carcass weight (kg)</span>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder={String(sheet.typicalCarcassKg)}
          />
          <span className="text-xs text-[#8a7d70]">
            Typical {sheet.animal.toLowerCase()}: {sheet.typicalCarcassKgRange[0]}–{sheet.typicalCarcassKgRange[1]}kg
          </span>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-bold text-[#5c5148]">3. What you paid (total £)</span>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="e.g. 108"
          />
          <span className="text-xs text-[#8a7d70]">The total price for the whole carcass.</span>
        </label>
      </div>

      {!hasCost || !result.ok ? (
        <p className="rounded-lg border border-[#ded6ca] bg-[#f7f3ed] p-4 text-sm text-[#6c5e52]">
          {hasCost && !result.ok
            ? result.message
            : "Enter what you paid to see the breakdown, suggested prices and profit."}
        </p>
      ) : (
        <>
          {/* The teaching headline */}
          <section className="grid gap-3 sm:grid-cols-3">
            <Stat label="You paid (per kg of carcass)" value={`${formatCurrency(result.costPerKgCarcass)}/kg`} tone="neutral" />
            <Stat
              label="Your REAL meat cost"
              value={`${formatCurrency(result.blendedCostPerKgSaleable)}/kg`}
              tone="amber"
              hint={`${result.wastePct}% (${result.wasteKg}kg) is bone & fat you can't sell`}
            />
            <Stat
              label="Sell it all → profit"
              value={formatCurrency(result.totalProfit)}
              tone="green"
              hint={`${formatCurrency(result.totalSuggestedRevenue)} revenue · ${result.overallMarginPct}% margin`}
            />
          </section>

          <div className="flex items-start gap-3 rounded-xl border border-[#f0d8a8] bg-[#fdf6e9] p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#92510a]" aria-hidden />
            <p className="text-sm leading-6 text-[#92510a]">
              <strong>Don&apos;t price at what you paid.</strong> If you sold every cut at{" "}
              {formatCurrency(result.costPerKgCarcass)}/kg (the carcass price), you&apos;d{" "}
              <strong>lose {formatCurrency(result.lossIfPricedAtCarcassRate)}</strong> on this animal — because{" "}
              {result.wasteKg}kg is bone and fat. Always price from your real meat cost of{" "}
              {formatCurrency(result.blendedCostPerKgSaleable)}/kg or more.
            </p>
          </div>

          {/* Cut breakdown */}
          <section>
            <p className="text-sm font-bold text-[#5c5148]">How it cuts up &amp; what to charge</p>
            <p className="text-xs text-[#8a7d70]">
              Suggested prices use typical margins for each cut — adjust the margin to match your shop.
            </p>
            <div className="mt-3 grid gap-3">
              {result.rows.map((row) => (
                <article
                  key={row.id}
                  className={cn(
                    "rounded-xl border p-4",
                    row.isWaste ? "border-dashed border-[#ded6ca] bg-[#f7f3ed]" : "border-[#ded6ca] bg-white",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-black">{row.name}</h3>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", TIER_LABEL[row.tier]?.className)}>
                        {TIER_LABEL[row.tier]?.label}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">{row.bone}</span>
                    </div>
                    <span className="text-sm font-black">{row.weightKg}kg</span>
                  </div>

                  {row.isWaste ? (
                    <p className="mt-2 text-xs text-[#8a7d70]">{row.tip}</p>
                  ) : (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Mini label="Suggested price" value={`${formatCurrency(row.suggestedPricePerKg!)}/kg`} strong />
                        <Mini label="This cut sells for" value={formatCurrency(row.lineRevenue!)} />
                        <Mini label="Profit on this cut" value={formatCurrency(row.lineProfit!)} />
                        <label className="grid gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">Margin %</span>
                          <input
                            type="number"
                            min={0}
                            max={95}
                            step="1"
                            value={Math.round((row.marginPct ?? 0) * 100)}
                            onChange={(e) => {
                              const pct = Number(e.target.value);
                              setOverrides((prev) => ({ ...prev, [row.id]: Number.isFinite(pct) ? pct / 100 : 0 }));
                            }}
                            className="w-full rounded-md border border-[#d6cdc0] bg-white px-2 py-1 text-sm font-bold"
                            aria-label={`Margin for ${row.name}`}
                          />
                        </label>
                      </div>
                      <p className="mt-3 flex items-start gap-1.5 text-xs text-[#5c5148]">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0f5132]" aria-hidden />
                        <span>
                          <strong>{row.bestUse}.</strong> {row.tip}
                        </span>
                      </p>
                    </>
                  )}
                </article>
              ))}
            </div>
          </section>

          <p className="text-xs leading-5 text-[#8a7d70]">
            Yields are typical UK averages and vary by breed, fat cover and how tightly you trim. Use them as a starting
            point and tune to your own shop. Nothing here is a guaranteed price.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "neutral" | "amber" | "green";
}) {
  const toneClass =
    tone === "green"
      ? { border: "#bfe3cf", bg: "#f2fbf5", text: "#0f5132" }
      : tone === "amber"
        ? { border: "#f0d8a8", bg: "#fdf6e9", text: "#92510a" }
        : { border: "#ded6ca", bg: "#ffffff", text: "#1f1b16" };
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: toneClass.border, backgroundColor: toneClass.bg }}>
      <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#6c5e52]">{label}</p>
      <p className="mt-1 text-2xl font-black" style={{ color: toneClass.text }}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-[#6c5e52]">{hint}</p> : null}
    </div>
  );
}

function Mini({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md bg-[#f7f3ed] p-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">{label}</p>
      <p className={cn("mt-0.5 text-sm", strong ? "font-black text-[#0f5132]" : "font-bold")}>{value}</p>
    </div>
  );
}

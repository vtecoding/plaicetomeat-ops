"use client";

import { AlertTriangle, Beef, Bird, Droplets, Info } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { commitCutToProduct } from "@/app/actions/admin-products";
import { CutMapPanel } from "@/components/admin/pricing/CutMapPanel";
import { RetailTipPanel } from "@/components/admin/pricing/RetailTipPanel";
import { YieldGuardrailPanel } from "@/components/admin/pricing/YieldGuardrailPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calculateCarcassBreakdown, type MarginBand } from "@/lib/butchery/carcass-breakdown";
import { CUT_SHEETS } from "@/lib/butchery/cut-sheets";
import { findCutMapRegion } from "@/lib/domain/cut-map-data";
import { calculateYieldGuardrails, generateRetailTips } from "@/lib/domain/yield-guardrails";
import { cn, formatCurrency } from "@/lib/utils";

type ProductOption = { id: string; name: string };

const TIER_LABEL: Record<string, { label: string; className: string }> = {
  premium: { label: "Premium", className: "bg-[#0f5132] text-white" },
  mid: { label: "Mid", className: "bg-[#e7dca8] text-[#5c4a12]" },
  value: { label: "Value", className: "bg-[#efe8dd] text-[#6c5e52]" },
  stock: { label: "Stock", className: "bg-[#efe8dd] text-[#8a7d70]" },
};

const BAND_COLOR: Record<MarginBand, string> = {
  danger: "#b42318",
  low: "#92510a",
  healthy: "#0f5132",
};
const BAND_DOT: Record<MarginBand, string> = { danger: "🔴", low: "🟡", healthy: "🟢" };

export function CarcassCalculator({ products = [] }: { products?: ProductOption[] }) {
  const [animalId, setAnimalId] = useState(CUT_SHEETS[0].id);
  const sheet = useMemo(() => CUT_SHEETS.find((s) => s.id === animalId) ?? CUT_SHEETS[0], [animalId]);

  const [weight, setWeight] = useState(String(sheet.typicalCarcassKg));
  const [cost, setCost] = useState("");
  const [daysHung, setDaysHung] = useState("0");
  const [marginNudge, setMarginNudge] = useState(0); // delta applied to every cut's default margin
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [selectedCutId, setSelectedCutId] = useState(sheet.cuts.find((cut) => !cut.isWaste)?.id ?? sheet.cuts[0]?.id ?? null);

  function selectAnimal(id: string) {
    const next = CUT_SHEETS.find((s) => s.id === id) ?? CUT_SHEETS[0];
    setAnimalId(id);
    setWeight(String(next.typicalCarcassKg));
    setDaysHung("0");
    setMarginNudge(0);
    setOverrides({});
    setSelectedCutId(next.cuts.find((cut) => !cut.isWaste)?.id ?? next.cuts[0]?.id ?? null);
  }

  // Effective margin per cut = explicit override, else the cut's default shifted by the master nudge.
  const effectiveMargins = useMemo(() => {
    const map: Record<string, number> = {};
    for (const cut of sheet.cuts) {
      if (cut.isWaste) continue;
      map[cut.id] = overrides[cut.id] ?? Math.min(0.95, Math.max(0, cut.defaultMarginPct + marginNudge));
    }
    return map;
  }, [sheet, overrides, marginNudge]);

  const result = useMemo(
    () =>
      calculateCarcassBreakdown({
        sheet,
        carcassWeightKg: Number(weight),
        carcassCost: Number(cost),
        daysHung: Number(daysHung),
        marginOverrides: effectiveMargins,
      }),
    [sheet, weight, cost, daysHung, effectiveMargins],
  );

  const hasCost = cost.trim() !== "" && Number(cost) > 0;
  const selectedRow = result.ok
    ? result.rows.find((row) => row.id === selectedCutId) ?? result.rows.find((row) => !row.isWaste) ?? result.rows[0] ?? null
    : null;

  const v62Guidance = useMemo(() => {
    if (!result.ok) return null;

    return calculateYieldGuardrails({
      animalType: sheet.id,
      rawWeightKg: result.carcassWeightKg,
      processedWeightKg: result.processedWeightKg,
      moistureLossKg: result.moistureLossKg,
      cuts: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        weightKg: row.weightKg,
        isWaste: row.isWaste,
        marginPct: row.marginPct,
        band: row.band,
        bestUse: row.bestUse,
        tier: row.tier,
      })),
    });
  }, [result, sheet.id]);

  const retailTips = useMemo(() => {
    if (!result.ok) return [];

    return generateRetailTips({
      animalType: sheet.id,
      cuts: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        weightKg: row.weightKg,
        isWaste: row.isWaste,
        marginPct: row.marginPct,
        band: row.band,
        bestUse: row.bestUse,
        tier: row.tier,
      })),
      assessments: v62Guidance?.assessments,
    });
  }, [result, sheet.id, v62Guidance]);

  function selectMapRegion(regionId: string) {
    if (!result.ok) {
      setSelectedCutId(regionId);
      return;
    }

    const matchingRow =
      result.rows.find((row) => row.id === regionId) ??
      result.rows.find((row) => findCutMapRegion(sheet.id, row.id)?.id === regionId || findCutMapRegion(sheet.id, row.name)?.id === regionId);
    setSelectedCutId(matchingRow?.id ?? regionId);
  }

  return (
    <div className="grid gap-6">
      {/* 1. Animal */}
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

      {/* 2. Intake */}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-bold text-[#5c5148]">Carcass weight (kg)</span>
          <Input type="number" inputMode="decimal" min={0} step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder={String(sheet.typicalCarcassKg)} />
          <span className="text-xs text-[#8a7d70]">Typical {sheet.typicalCarcassKgRange[0]}–{sheet.typicalCarcassKgRange[1]}kg</span>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-bold text-[#5c5148]">What you paid (total £)</span>
          <Input type="number" inputMode="decimal" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="e.g. 108" />
          <span className="text-xs text-[#8a7d70]">For the whole carcass.</span>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-bold text-[#5c5148]">Days hung in chiller</span>
          <Input type="number" inputMode="numeric" min={0} step="1" value={daysHung} onChange={(e) => setDaysHung(e.target.value)} placeholder="0" />
          <span className="text-xs text-[#8a7d70]">
            {sheet.dailyShrinkagePct === 0 ? "Processed fresh — no weight loss" : `Loses ~${(sheet.dailyShrinkagePct * 100).toFixed(1)}%/day`}
          </span>
        </label>
      </div>

      {!hasCost || !result.ok ? (
        <p className="rounded-lg border border-[#ded6ca] bg-[#f7f3ed] p-4 text-sm text-[#6c5e52]">
          {hasCost && !result.ok ? result.message : "Enter what you paid to see the breakdown, suggested prices and profit."}
        </p>
      ) : (
        <>
          {result.moistureLossKg > 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-[#cfe2ef] bg-[#f0f7fc] p-3 text-sm text-[#2a5a78]">
              <Droplets className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                Hung {result.daysHung} day{result.daysHung === 1 ? "" : "s"} → lost <strong>{result.moistureLossKg}kg</strong> of
                water → you&apos;re actually cutting <strong>{result.processedWeightKg}kg</strong>.
              </span>
            </div>
          ) : null}

          {/* Teaching headline */}
          <section className="grid gap-3 sm:grid-cols-3">
            <Stat label="You paid (per kg of carcass)" value={`${formatCurrency(result.costPerKgCarcass)}/kg`} tone="neutral" />
            <Stat label="Your REAL meat cost" value={`${formatCurrency(result.blendedCostPerKgSaleable)}/kg`} tone="amber" hint={`${result.wastePct}% (${result.wasteKg}kg) is bone & fat you can't sell`} />
            <Stat label="Sell it all → profit" value={formatCurrency(result.totalProfit)} tone="green" hint={`${formatCurrency(result.totalSuggestedRevenue)} revenue`} />
          </section>

          <div className="flex items-start gap-3 rounded-xl border border-[#f0d8a8] bg-[#fdf6e9] p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#92510a]" aria-hidden />
            <p className="text-sm leading-6 text-[#92510a]">
              <strong>Don&apos;t price at what you paid.</strong> Sold at {formatCurrency(result.costPerKgCarcass)}/kg (the carcass
              price) you&apos;d <strong>lose {formatCurrency(result.lossIfPricedAtCarcassRate)}</strong> — price from your real meat
              cost of {formatCurrency(result.blendedCostPerKgSaleable)}/kg or more.
            </p>
          </div>

          {v62Guidance ? (
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(290px,0.85fr)]">
              <CutMapPanel
                animalType={sheet.id}
                selectedCutId={selectedRow?.id ?? selectedCutId}
                selectedCutName={selectedRow?.name ?? null}
                onSelectCut={selectMapRegion}
              />
              <div className="grid gap-4">
                <YieldGuardrailPanel
                  assessments={v62Guidance.assessments}
                  massIntegrity={v62Guidance.massIntegrity}
                  selectedCutId={selectedRow?.id ?? selectedCutId}
                />
                <RetailTipPanel tips={retailTips} />
              </div>
            </section>
          ) : null}

          {/* Master margin slider */}
          <section className="rounded-xl border border-[#ded6ca] bg-[#fbfaf7] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-black">Nudge all prices</p>
                <p className="text-xs text-[#8a7d70]">Slide to make everything cheaper or pricier at once. Tune individual cuts below.</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">Overall margin</p>
                <p className="text-2xl font-black" style={{ color: BAND_COLOR[result.overallBand] }}>
                  {BAND_DOT[result.overallBand]} {result.overallMarginPct}%
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs font-bold text-[#8a7d70]">Cheaper</span>
              <input
                type="range"
                min={-20}
                max={20}
                step={1}
                value={Math.round(marginNudge * 100)}
                onChange={(e) => {
                  setMarginNudge(Number(e.target.value) / 100);
                  setOverrides({}); // a master nudge resets individual tweaks
                }}
                className="h-2 w-full cursor-pointer accent-[#0f5132]"
                aria-label="Nudge all margins"
              />
              <span className="text-xs font-bold text-[#8a7d70]">Pricier</span>
            </div>
          </section>

          {/* Cut breakdown */}
          <section>
            <p className="text-sm font-bold text-[#5c5148]">How it cuts up &amp; what to charge</p>
            <p className="text-xs text-[#8a7d70]">
              <span className="font-bold" style={{ color: BAND_COLOR.healthy }}>🟢 30%+</span> healthy ·{" "}
              <span className="font-bold" style={{ color: BAND_COLOR.low }}>🟡 15–29%</span> low ·{" "}
              <span className="font-bold" style={{ color: BAND_COLOR.danger }}>🔴 under 15%</span> losing money
            </p>
            <div className="mt-3 grid gap-3">
              {result.rows.map((row) => (
                <article
                  key={row.id}
                  data-testid={`cut-row-${row.id}`}
                  className={cn(
                    "rounded-xl border p-4",
                    row.isWaste ? "border-dashed border-[#ded6ca] bg-[#f7f3ed]" : "border-[#ded6ca] bg-white",
                    selectedCutId === row.id && "border-[#0f5132] ring-2 ring-[#0f5132]/20",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-black">
                        <button
                          type="button"
                          className="rounded-sm text-left underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f5132]"
                          aria-label={`Select ${row.name} on cut map`}
                          aria-pressed={selectedCutId === row.id}
                          onClick={() => setSelectedCutId(row.id)}
                        >
                          {row.name}
                        </button>
                      </h3>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", TIER_LABEL[row.tier]?.className)}>{TIER_LABEL[row.tier]?.label}</span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">{row.bone}</span>
                    </div>
                    <span className="text-sm font-black">{row.weightKg}kg</span>
                  </div>

                  {row.isWaste ? (
                    <p className="mt-2 text-xs text-[#8a7d70]">{row.tip}</p>
                  ) : (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Mini label="Suggested price" value={`${formatCurrency(row.suggestedPricePerKg!)}/kg`} color={BAND_COLOR[row.band!]} strong />
                        <Mini label="This cut sells for" value={formatCurrency(row.lineRevenue!)} />
                        <Mini label="Profit on this cut" value={formatCurrency(row.lineProfit!)} />
                        <label className="grid gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">
                            Margin {BAND_DOT[row.band!]}
                          </span>
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
                            className="w-full rounded-md border px-2 py-1 text-sm font-black"
                            style={{ color: BAND_COLOR[row.band!], borderColor: "#d6cdc0" }}
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
                      {products.length > 0 ? (
                        <CommitRow
                          products={products}
                          pricePerKg={row.suggestedPricePerKg!}
                          costPerKg={result.blendedCostPerKgSaleable}
                        />
                      ) : null}
                    </>
                  )}
                </article>
              ))}
            </div>
          </section>

          <p className="text-xs leading-5 text-[#8a7d70]">
            Yields and hang-loss are typical UK averages and vary by breed, fat cover and how tightly you trim — tune them to your
            own shop. The cost shown is your honest blended cost; only the price changes per cut. Nothing here is a guaranteed price.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: "neutral" | "amber" | "green" }) {
  const t =
    tone === "green"
      ? { border: "#bfe3cf", bg: "#f2fbf5", text: "#0f5132" }
      : tone === "amber"
        ? { border: "#f0d8a8", bg: "#fdf6e9", text: "#92510a" }
        : { border: "#ded6ca", bg: "#ffffff", text: "#1f1b16" };
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: t.border, backgroundColor: t.bg }}>
      <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#6c5e52]">{label}</p>
      <p className="mt-1 text-2xl font-black" style={{ color: t.text }}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[#6c5e52]">{hint}</p> : null}
    </div>
  );
}

function Mini({ label, value, strong = false, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <div className="rounded-md bg-[#f7f3ed] p-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">{label}</p>
      <p className={cn("mt-0.5 text-sm", strong ? "font-black" : "font-bold")} style={color && strong ? { color } : undefined}>
        {value}
      </p>
    </div>
  );
}

function CommitRow({
  products,
  pricePerKg,
  costPerKg,
}: {
  products: ProductOption[];
  pricePerKg: number;
  costPerKg: number;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const targetProductId = productId || products[0]?.id || "";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#ded6ca] bg-[#fbfaf7] p-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Choose product to update</span>
        <select
          value={targetProductId}
          onChange={(event) => setProductId(event.target.value)}
          data-testid="commit-product-select"
          className="h-9 w-full rounded-md border border-[#d6cdc0] bg-white px-2 text-xs font-bold text-[#5c5148]"
        >
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="commit-product-save"
        disabled={isPending || !targetProductId}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await commitCutToProduct({ productId: targetProductId, pricePerKg, costPerKg });
            setMessage(result.message);
          });
        }}
      >
        {isPending ? "Saving..." : "Save price"}
      </Button>
      {message ? <p className="basis-full text-xs font-bold text-[#0f5132]">{message}</p> : null}
    </div>
  );
}

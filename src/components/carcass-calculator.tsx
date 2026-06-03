"use client";

import { FormEvent, type ReactNode, useEffect, useMemo, useState, useTransition } from "react";

import { commitCutToProduct } from "@/app/actions/admin-products";
import { CarcassIntakeReview, type IntakeSupplierOption } from "@/components/admin/pricing/CarcassIntakeReview";
import { CutMapPanel } from "@/components/admin/pricing/CutMapPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calculateCarcassBreakdown, type CutBreakdownRow, type MarginBand } from "@/lib/butchery/carcass-breakdown";
import { CUT_SHEETS } from "@/lib/butchery/cut-sheets";
import { findCutMapRegion, getToolGuidance } from "@/lib/domain/cut-map-data";
import { calculateYieldGuardrails, type YieldAssessment } from "@/lib/domain/yield-guardrails";
import { cn, formatCurrency } from "@/lib/utils";

type ProductOption = { id: string; name: string; pricePerUnit?: number; costPerKg?: number | null };

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

export function CarcassCalculator({
  products = [],
  branchId,
  suppliers = [],
}: {
  products?: ProductOption[];
  branchId: string;
  suppliers?: IntakeSupplierOption[];
}) {
  const [animalId, setAnimalId] = useState(CUT_SHEETS[0].id);
  const sheet = useMemo(() => CUT_SHEETS.find((s) => s.id === animalId) ?? CUT_SHEETS[0], [animalId]);

  const [weight, setWeight] = useState(String(sheet.typicalCarcassKg));
  const [cost, setCost] = useState("");
  const [daysHung, setDaysHung] = useState("0");
  const [marginNudge, setMarginNudge] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [selectedCutId, setSelectedCutId] = useState(sheet.cuts.find((cut) => !cut.isWaste)?.id ?? sheet.cuts[0]?.id ?? null);
  const [detailCutId, setDetailCutId] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hasCalculated, setHasCalculated] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function selectAnimal(id: string) {
    const next = CUT_SHEETS.find((s) => s.id === id) ?? CUT_SHEETS[0];
    setAnimalId(id);
    setWeight(String(next.typicalCarcassKg));
    setDaysHung("0");
    setMarginNudge(0);
    setOverrides({});
    setSelectedCutId(next.cuts.find((cut) => !cut.isWaste)?.id ?? next.cuts[0]?.id ?? null);
    setDetailCutId(null);
    setHasCalculated(false);
    setSubmitError(null);
  }

  function updateInput(setter: (value: string) => void, value: string) {
    setter(value);
    setHasCalculated(false);
    setSubmitError(null);
  }

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

  const validationError = validateInputs(weight, cost, daysHung);
  const showResult = hasCalculated && !validationError && result.ok;

  const guidance = useMemo(() => {
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

  const warningByCut = useMemo(() => {
    const map = new Map<string, YieldAssessment>();
    for (const assessment of guidance?.assessments ?? []) {
      if (assessment.status !== "normal") map.set(assessment.cutId, assessment);
    }
    return map;
  }, [guidance]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateInputs(weight, cost, daysHung);
    if (error) {
      setSubmitError(error);
      setHasCalculated(false);
      return;
    }

    if (!result.ok) {
      setSubmitError(result.message);
      setHasCalculated(false);
      return;
    }

    setSubmitError(null);
    setHasCalculated(true);
  }

  function openCut(row: CutBreakdownRow) {
    setSelectedCutId(row.id);
    setDetailCutId(row.id);
  }

  const detailRow = showResult ? result.rows.find((row) => row.id === detailCutId) ?? null : null;
  const visibleRows = showResult ? result.rows.filter((row) => !row.isWaste) : [];
  const wasteRows = showResult ? result.rows.filter((row) => row.isWaste) : [];

  return (
    <div className="grid gap-6">
      {showResult ? (
        <CalculatedInputSummary
          animalName={result.animalName}
          weightKg={result.carcassWeightKg}
          cost={result.carcassCost}
          daysHung={result.daysHung}
          onChange={() => {
            setHasCalculated(false);
            setDetailCutId(null);
          }}
        />
      ) : (
        <form className="rounded-xl border border-[#ded6ca] bg-white p-4 sm:p-5" onSubmit={handleSubmit}>
          <div>
            <p className="text-lg font-black text-[#1f1b16]">Carcass pricing calculator</p>
            <p className="mt-1 text-sm leading-6 text-[#6c5e52]">Enter the animal, weight and total paid. The prices appear after calculation.</p>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-bold text-[#5c5148]">Animal</span>
              <select
                value={animalId}
                onChange={(event) => selectAnimal(event.target.value)}
                className="h-11 rounded-md border border-[#cfc7bb] bg-white px-3 text-sm font-bold text-[#231f20] outline-none transition focus:border-[#0f5132] focus:ring-2 focus:ring-[#0f5132]/15"
              >
                {CUT_SHEETS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.animal}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-bold text-[#5c5148]">Carcass weight kg</span>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.1"
                value={weight}
                onChange={(event) => updateInput(setWeight, event.target.value)}
                placeholder={String(sheet.typicalCarcassKg)}
              />
              <span className="text-xs text-[#8a7d70]">Typical {sheet.typicalCarcassKgRange[0]}-{sheet.typicalCarcassKgRange[1]}kg</span>
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-bold text-[#5c5148]">Total paid GBP</span>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={cost}
                onChange={(event) => updateInput(setCost, event.target.value)}
                placeholder="e.g. 108"
              />
              <span className="text-xs text-[#8a7d70]">For the whole carcass.</span>
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-bold text-[#5c5148]">Days hung in chiller</span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step="1"
                value={daysHung}
                onChange={(event) => updateInput(setDaysHung, event.target.value)}
                placeholder="0"
              />
              <span className="text-xs text-[#8a7d70]">
                {sheet.dailyShrinkagePct === 0 ? "Processed fresh" : `About ${(sheet.dailyShrinkagePct * 100).toFixed(1)}% weight loss per day`}
              </span>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" data-testid="calculate-selling-prices">
              Calculate selling prices
            </Button>
            {submitError ? <p className="text-sm font-bold text-[#b42318]">{submitError}</p> : null}
          </div>
        </form>
      )}

      {!showResult ? (
        <section className="rounded-xl border border-[#ded6ca] bg-[#f7f3ed] p-4 sm:p-5" data-testid="pricing-helper-panel">
          <p className="text-sm font-black text-[#1f1b16]">How this helps</p>
          <ol className="mt-3 grid gap-2.5">
            <HelperStep n={1} text="Enter what you paid for the whole carcass." />
            <HelperStep n={2} text="The app adjusts for bone, fat, trim and moisture loss." />
            <HelperStep n={3} text="You get a suggested selling price for each cut." />
          </ol>
          <p className="mt-3 text-xs leading-5 text-[#8a7d70]">No price advice is shown until the numbers are valid.</p>
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-[#ded6ca] bg-[#fbfaf7] p-4 sm:p-5" data-testid="pricing-result-summary">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.06em] text-[#0f5132]">{result.animalName} pricing result</p>
                <h2 className="mt-1 text-2xl font-black text-[#1f1b16]">Sell from the real meat cost, not the carcass price.</h2>
              </div>
              <div className="rounded-lg bg-white px-3 py-2 text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">Overall margin</p>
                <p className="text-2xl font-black" style={{ color: BAND_COLOR[result.overallBand] }}>
                  {result.overallMarginPct}%
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <SummaryStat label="You paid" value={formatCurrency(result.carcassCost)} />
              <SummaryStat label="Carcass weight" value={`${result.carcassWeightKg}kg`} />
              <SummaryStat label="Real meat cost" value={`${formatCurrency(result.blendedCostPerKgSaleable)}/kg`} strong />
              <SummaryStat label="Expected profit" value={formatCurrency(result.totalProfit)} />
              <SummaryStat label="All sold revenue" value={formatCurrency(result.totalSuggestedRevenue)} />
            </div>

            <div className="mt-4 rounded-lg border border-[#f0d8a8] bg-[#fff8e8] p-3 text-sm leading-6 text-[#7a4b00]">
              Do not price from carcass cost. Your real meat cost is higher after bone, fat and moisture loss.
            </div>

            {result.moistureLossKg > 0 ? (
              <p className="mt-3 text-sm text-[#6c5e52]">
                Hung {result.daysHung} day{result.daysHung === 1 ? "" : "s"}: {result.moistureLossKg}kg moisture loss, so you are cutting{" "}
                {result.processedWeightKg}kg.
              </p>
            ) : null}

            {guidance && !guidance.massIntegrity.ok ? (
              <div className="mt-3 rounded-lg border border-[#f0d8a8] bg-[#fff8e8] p-3 text-sm leading-6 text-[#7a4b00]" data-testid="pricing-warning-panel">
                {guidance.massIntegrity.explanation}
              </div>
            ) : null}
          </section>

          <section data-testid="recommended-price-cards">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-[#1f1b16]">Recommended prices</h2>
                <p className="text-sm text-[#6c5e52]">Use these as counter prices, then adjust only if the shop needs it.</p>
              </div>
              {warningByCut.size === 0 ? <p className="text-xs font-bold text-[#0f5132]">No pricing warnings</p> : null}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {visibleRows.map((row) => {
                const warning = warningByCut.get(row.id);
                return (
                  <article
                    key={row.id}
                    data-testid={`cut-row-${row.id}`}
                    className={cn(
                      "rounded-xl border bg-white p-4 shadow-sm",
                      selectedCutId === row.id ? "border-[#0f5132] ring-2 ring-[#0f5132]/15" : "border-[#ded6ca]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-black text-[#1f1b16]">{row.name}</h3>
                        <p className="mt-1 text-xs font-bold uppercase tracking-[0.06em] text-[#8a7d70]">{row.bone}</p>
                      </div>
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", TIER_LABEL[row.tier]?.className)}>
                        {TIER_LABEL[row.tier]?.label}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <PriceMetric label="Recommended price" value={`${formatCurrency(row.suggestedPricePerKg!)}/kg`} color={BAND_COLOR[row.band!]} main />
                      <PriceMetric label="Margin" value={`${Math.round((row.marginPct ?? 0) * 100)}%`} />
                      <PriceMetric label="Expected weight" value={`${row.weightKg}kg`} />
                      <PriceMetric label="Expected profit" value={formatCurrency(row.lineProfit!)} />
                    </div>

                    {warning ? (
                      <p className="mt-3 rounded-lg border border-[#f0d8a8] bg-[#fff8e8] p-3 text-sm leading-6 text-[#7a4b00]" data-testid={`pricing-warning-${row.id}`}>
                        {plainWarning(warning.explanation)}
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => openCut(row)}>
                        View cut
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setAdjustOpen(true);
                          setSelectedCutId(row.id);
                        }}
                      >
                        Adjust price
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <CarcassIntakeReview
            breakdown={result}
            animalId={animalId}
            daysHung={Number(daysHung) || 0}
            branchId={branchId}
            products={products}
            suppliers={suppliers}
            marginOverrides={effectiveMargins}
          />

          <Collapsible title="Adjust prices" open={adjustOpen} onOpenChange={setAdjustOpen}>
            <p className="text-sm text-[#6c5e52]">Move all prices up or down, then fine-tune individual cuts.</p>
            <div className="mt-4 flex items-center gap-3">
              <span className="text-xs font-bold text-[#8a7d70]">Lower</span>
              <input
                type="range"
                min={-20}
                max={20}
                step={1}
                value={Math.round(marginNudge * 100)}
                onChange={(event) => {
                  setMarginNudge(Number(event.target.value) / 100);
                  setOverrides({});
                }}
                className="h-2 w-full cursor-pointer accent-[#0f5132]"
                aria-label="Nudge all margins"
              />
              <span className="text-xs font-bold text-[#8a7d70]">Higher</span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {visibleRows.map((row) => (
                <label key={row.id} className="grid gap-1 rounded-lg border border-[#ded6ca] bg-white p-3">
                  <span className="text-sm font-black text-[#1f1b16]">{row.name}</span>
                  <span className="text-xs text-[#6c5e52]">Margin percentage</span>
                  <input
                    type="number"
                    min={0}
                    max={95}
                    step="1"
                    value={Math.round((row.marginPct ?? 0) * 100)}
                    onChange={(event) => {
                      const pct = Number(event.target.value);
                      setOverrides((prev) => ({ ...prev, [row.id]: Number.isFinite(pct) ? pct / 100 : 0 }));
                    }}
                    className="h-10 rounded-md border border-[#d6cdc0] px-2 text-sm font-black"
                    aria-label={`Margin for ${row.name}`}
                  />
                </label>
              ))}
            </div>
          </Collapsible>

          {products.length > 0 ? (
            <Collapsible title="Advanced: connect cuts to products" open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <p className="text-sm text-[#6c5e52]">Use this later when you want simulator prices to match Products & Prices.</p>
              <div className="mt-4 grid gap-3">
                {visibleRows.map((row) => (
                  <AdvancedProductRow
                    key={row.id}
                    row={row}
                    products={products}
                    costPerKg={result.blendedCostPerKgSaleable}
                  />
                ))}
              </div>
            </Collapsible>
          ) : null}

          {wasteRows.length > 0 ? (
            <p className="text-xs leading-5 text-[#8a7d70]">
              Not priced for sale: {wasteRows.map((row) => `${row.name} (${row.weightKg}kg)`).join(", ")}.
            </p>
          ) : null}

          {detailRow ? (
            <CutDetailDrawer
              row={detailRow}
              animalType={sheet.id}
              selectedCutId={selectedCutId}
              onSelectCut={(regionId) => {
                const matchingRow =
                  result.rows.find((row) => row.id === regionId) ??
                  result.rows.find((row) => findCutMapRegion(sheet.id, row.id)?.id === regionId || findCutMapRegion(sheet.id, row.name)?.id === regionId);
                const nextId = matchingRow?.id ?? regionId;
                setSelectedCutId(nextId);
                setDetailCutId(nextId);
              }}
              warning={warningByCut.get(detailRow.id)}
              onClose={() => setDetailCutId(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function validateInputs(weight: string, cost: string, daysHung: string) {
  const weightValue = Number(weight);
  const costValue = Number(cost);
  const daysValue = Number(daysHung);

  if (!Number.isFinite(weightValue) || weightValue <= 0) return "Enter a carcass weight above 0kg.";
  if (!Number.isFinite(costValue) || costValue <= 0) return "Enter the total amount paid, above GBP 0.";
  if (!Number.isFinite(daysValue) || daysValue < 0) return "Days hung cannot be negative.";
  return null;
}

function HelperStep({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0f5132] text-xs font-black text-white">{n}</span>
      <span className="text-sm leading-6 text-[#5c5148]">{text}</span>
    </li>
  );
}

function SummaryStat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">{label}</p>
      <p className={cn("mt-1 text-lg font-black", strong ? "text-[#0f5132]" : "text-[#1f1b16]")}>{value}</p>
    </div>
  );
}

function CalculatedInputSummary({
  animalName,
  weightKg,
  cost,
  daysHung,
  onChange,
}: {
  animalName: string;
  weightKg: number;
  cost: number;
  daysHung: number;
  onChange: () => void;
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ded6ca] bg-white p-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#8a7d70]">Calculated from</p>
        <p className="mt-1 text-sm font-black text-[#1f1b16]">
          {animalName} - {weightKg}kg - {formatCurrency(cost)} paid - {daysHung} day{daysHung === 1 ? "" : "s"} hung
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onChange}>
        Change numbers
      </Button>
    </section>
  );
}

function PriceMetric({ label, value, main = false, color }: { label: string; value: string; main?: boolean; color?: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">{label}</p>
      <p className={cn("mt-1 font-black", main ? "text-3xl" : "text-lg")} style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  );
}

function Collapsible({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#ded6ca] bg-[#fbfaf7] p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left text-base font-black text-[#1f1b16] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f5132]"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span>{title}</span>
        <span aria-hidden>{open ? "Close" : "Open"}</span>
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

function CutDetailDrawer({
  row,
  animalType,
  selectedCutId,
  warning,
  onSelectCut,
  onClose,
}: {
  row: CutBreakdownRow;
  animalType: string;
  selectedCutId: string | null;
  warning?: YieldAssessment;
  onSelectCut: (cutId: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const guidance = getToolGuidance(row.id) ?? getToolGuidance(row.name);
  const difficultyLabel = guidance ? capitalize(guidance.difficulty) : null;
  const isSold = row.suggestedPricePerKg != null && row.marginPct != null;

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/40 p-3 sm:items-start sm:justify-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="grid max-h-full w-full max-w-2xl content-start gap-4 overflow-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cut-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 1. Cut name + close */}
        <div className="flex items-start justify-between gap-4">
          <h2 id="cut-detail-title" className="text-2xl font-black text-[#1f1b16]">
            {row.name} of {animalType}
          </h2>
          <Button type="button" variant="outline" size="sm" onClick={onClose} aria-label="Close cut detail">
            Close
          </Button>
        </div>

        {/* 2–5. Commercial facts, then difficulty / caution */}
        {isSold ? (
          <div className="rounded-xl border border-[#ded6ca] bg-[#fbfaf7] p-4">
            <p className="text-3xl font-black text-[#0f5132]" data-testid="cut-detail-price">
              {formatCurrency(row.suggestedPricePerKg!)}/kg <span className="text-base font-bold text-[#6c5e52]">recommended</span>
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <DetailFact label="Margin" value={`${Math.round((row.marginPct ?? 0) * 100)}%`} />
              <DetailFact label="Expected weight" value={`${row.weightKg}kg`} />
              <DetailFact label="Expected profit" value={formatCurrency(row.lineProfit ?? 0)} />
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[#ded6ca] bg-[#fbfaf7] p-4">
            <p className="text-lg font-black text-[#6c5e52]">Not priced for sale</p>
            <p className="mt-1 text-sm text-[#6c5e52]">Expected weight {row.weightKg}kg.</p>
          </div>
        )}

        <dl className="grid gap-2 rounded-xl border border-[#ded6ca] bg-white p-4" data-testid="cut-detail-facts">
          {difficultyLabel ? <DetailLine label="Difficulty" value={difficultyLabel} /> : null}
          {row.bestUse ? <DetailLine label="Use" value={row.bestUse} /> : null}
          {guidance ? <DetailLine label="Caution" value={guidance.caution} /> : null}
        </dl>

        {warning ? (
          <p className="rounded-lg border border-[#f0d8a8] bg-[#fff8e8] p-3 text-sm leading-6 text-[#7a4b00]" data-testid="cut-detail-warning">
            {plainWarning(warning.explanation)}
          </p>
        ) : null}

        {/* 6. Map */}
        <CutMapPanel animalType={animalType} selectedCutId={selectedCutId} selectedCutName={row.name} onSelectCut={onSelectCut} />

        {/* 7. Tool badges */}
        {guidance ? (
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[#8a7d70]">Tools typically used</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {guidance.tools.map((tool) => (
                <Badge key={tool}>{tool}</Badge>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#8a7d70]">{label}</p>
      <p className="mt-1 text-lg font-black text-[#1f1b16]">{value}</p>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm leading-6">
      <dt className="shrink-0 font-black text-[#1f1b16]">{label}:</dt>
      <dd className="text-[#5c5148]">{value}</dd>
    </div>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function AdvancedProductRow({ row, products, costPerKg }: { row: CutBreakdownRow; products: ProductOption[]; costPerKg: number }) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const targetProductId = productId || products[0]?.id || "";

  return (
    <div className="grid gap-2 rounded-lg border border-[#ded6ca] bg-white p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" data-testid={`advanced-product-row-${row.id}`}>
      <div>
        <p className="text-sm font-black text-[#1f1b16]">{row.name}</p>
        <p className="text-xs text-[#6c5e52]">Simulator price {formatCurrency(row.suggestedPricePerKg ?? 0)}/kg</p>
      </div>
      <label className="grid gap-1">
        <span className="text-xs font-bold text-[#6c5e52]">Product</span>
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
            const result = await commitCutToProduct({ productId: targetProductId, pricePerKg: row.suggestedPricePerKg ?? 0, costPerKg });
            setMessage(result.message);
          });
        }}
      >
        {isPending ? "Saving..." : "Save price"}
      </Button>
      {message ? <p className="text-xs font-bold text-[#0f5132] sm:col-span-3">{message}</p> : null}
    </div>
  );
}

function plainWarning(message: string) {
  return message.replace(/yield/gi, "expected weight");
}

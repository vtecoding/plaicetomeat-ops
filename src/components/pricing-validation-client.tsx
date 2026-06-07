"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck } from "lucide-react";

import { recordPricingValidation } from "@/app/actions/pricing-validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  buildSystemRecommendation,
  classifyVariance,
  computeVariancePct,
  defaultCarcassInput,
  speciesLabel,
  summariseOverallSignoff,
  validationSpecies,
  type PricingValidationDecision,
  type PricingValidationRecord,
  type SignoffVerdict,
  type SpeciesId,
  type SystemCutRecommendation,
} from "@/lib/butchery/pricing-validation";

function keyFor(species: SpeciesId, cutId: string) {
  return `${species}:${cutId}`;
}

const VERDICT_TONE: Record<SignoffVerdict, "green" | "red" | "amber"> = {
  APPROVED: "green",
  CHANGES_REQUIRED: "red",
  INCOMPLETE: "amber",
};

const VERDICT_LABEL: Record<SignoffVerdict, string> = {
  APPROVED: "Approved",
  CHANGES_REQUIRED: "Changes required",
  INCOMPLETE: "Not finished",
};

const VARIANCE_TONE = { aligned: "green", minor: "amber", major: "red", unknown: "neutral" } as const;

export function PricingValidationClient({ initialRecords }: { initialRecords: PricingValidationRecord[] }) {
  const router = useRouter();
  const [records, setRecords] = useState(() => new Map(initialRecords.map((r) => [keyFor(r.species, r.cutId), r] as const)));
  const [butcherName, setButcherName] = useState(initialRecords.find((r) => r.butcherName)?.butcherName ?? "");

  const overall = useMemo(() => summariseOverallSignoff([...records.values()]), [records]);

  function onSaved(record: PricingValidationRecord) {
    setRecords((prev) => {
      const next = new Map(prev);
      next.set(keyFor(record.species, record.cutId), record);
      return next;
    });
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-8">
      <section className="grid gap-4 rounded-lg border border-[#ded6ca] bg-white p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-6 w-6 shrink-0 text-[#0f5132]" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-[#6c5e52]">Overall sign-off</p>
            <p className="text-lg font-black">
              {overall.approvedCount} of {overall.totalExpected} saleable cuts approved
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3" data-testid="overall-verdict">
          {overall.changesCount > 0 && (
            <span className="text-sm font-semibold text-[#9f2318]">{overall.changesCount} need changes</span>
          )}
          <Badge tone={VERDICT_TONE[overall.verdict]} className="px-3 py-1.5 text-sm">
            {VERDICT_LABEL[overall.verdict]}
          </Badge>
        </div>
      </section>

      <section className="grid gap-2 rounded-lg border border-[#ded6ca] bg-white p-5 sm:max-w-md">
        <label className="text-sm font-semibold" htmlFor="butcherName">Butcher signing off</label>
        <Input
          id="butcherName"
          name="butcherName"
          value={butcherName}
          placeholder="e.g. Yusuf (head butcher)"
          onChange={(e) => setButcherName(e.target.value)}
        />
        <p className="text-xs text-[#8a7c6c]">Recorded with each cut you save. The audit log already captures who keyed it in.</p>
      </section>

      {validationSpecies().map((sheet) => (
        <SpeciesSection
          key={sheet.id}
          species={sheet.id as SpeciesId}
          records={records}
          butcherName={butcherName}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}

function SpeciesSection({
  species,
  records,
  butcherName,
  onSaved,
}: {
  species: SpeciesId;
  records: Map<string, PricingValidationRecord>;
  butcherName: string;
  onSaved: (record: PricingValidationRecord) => void;
}) {
  const initial = defaultCarcassInput(species);
  const [weight, setWeight] = useState(String(initial.carcassWeightKg));
  const [cost, setCost] = useState(String(initial.carcassCost));

  const systemRows = useMemo(() => {
    const w = Number(weight);
    const c = Number(cost);
    if (!Number.isFinite(w) || !Number.isFinite(c)) return null;
    return buildSystemRecommendation({ species, carcassWeightKg: w, carcassCost: c });
  }, [species, weight, cost]);

  return (
    <section className="rounded-lg border border-[#ded6ca] bg-white p-5" data-testid={`species-${species}`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-xl font-black">{speciesLabel(species)}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <label className="text-xs font-semibold text-[#6c5e52]" htmlFor={`${species}-weight`}>Carcass weight (kg)</label>
            <Input id={`${species}-weight`} className="w-28" type="number" step="0.1" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <label className="text-xs font-semibold text-[#6c5e52]" htmlFor={`${species}-cost`}>Carcass cost (£)</label>
            <Input id={`${species}-cost`} className="w-28" type="number" step="0.01" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
        </div>
      </div>

      {systemRows === null ? (
        <p className="mt-4 rounded-lg border border-[#f0c66e] bg-[#fff6df] p-3 text-sm text-[#5a3900]">
          Enter a valid carcass weight and cost to see the system recommendation.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {systemRows.map((row) => (
            <CutRow
              key={row.cutId}
              species={species}
              system={row}
              saved={records.get(keyFor(species, row.cutId)) ?? null}
              butcherName={butcherName}
              onSaved={onSaved}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CutRow({
  species,
  system,
  saved,
  butcherName,
  onSaved,
}: {
  species: SpeciesId;
  system: SystemCutRecommendation;
  saved: PricingValidationRecord | null;
  butcherName: string;
  onSaved: (record: PricingValidationRecord) => void;
}) {
  const [butcherYield, setButcherYield] = useState(saved?.butcherYieldPct != null ? String(round(saved.butcherYieldPct * 100, 1)) : "");
  const [butcherPrice, setButcherPrice] = useState(saved?.butcherPricePerKg != null ? String(saved.butcherPricePerKg) : "");
  const [decision, setDecision] = useState<PricingValidationDecision>(saved?.decision ?? "pending");
  const [notes, setNotes] = useState(saved?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(saved?.decision != null && saved.decision !== "pending");

  const butcherPriceNum = butcherPrice.trim() === "" ? null : Number(butcherPrice);
  const variance = computeVariancePct(system.suggestedPricePerKg, Number.isFinite(butcherPriceNum as number) ? butcherPriceNum : null);
  const band = classifyVariance(variance);

  async function save() {
    setBusy(true);
    setError(null);
    setSavedTick(false);

    const yieldNum = butcherYield.trim() === "" ? null : Number(butcherYield) / 100;
    const priceNum = butcherPrice.trim() === "" ? null : Number(butcherPrice);

    if (decision !== "pending" && (yieldNum === null || priceNum === null || Number.isNaN(yieldNum) || Number.isNaN(priceNum))) {
      setError("Enter the butcher yield and price before approving or requesting changes.");
      setBusy(false);
      return;
    }

    const res = await recordPricingValidation({
      species,
      cutId: system.cutId,
      cutName: system.cutName,
      systemYieldPct: system.yieldPct,
      systemCostPerKg: system.costPerKgSaleable,
      systemPricePerKg: system.suggestedPricePerKg,
      systemMarginPct: system.marginPct,
      butcherYieldPct: yieldNum,
      butcherPricePerKg: priceNum,
      decision,
      notes: notes.trim() === "" ? null : notes,
      butcherName: butcherName.trim() === "" ? null : butcherName,
    });

    if (!res.ok) {
      setError(res.message);
      setBusy(false);
      return;
    }

    onSaved({
      species,
      cutId: system.cutId,
      cutName: system.cutName,
      systemYieldPct: system.yieldPct,
      systemCostPerKg: system.costPerKgSaleable,
      systemPricePerKg: system.suggestedPricePerKg,
      systemMarginPct: system.marginPct,
      butcherYieldPct: yieldNum,
      butcherPricePerKg: priceNum,
      variancePct: variance,
      decision,
      notes: notes.trim() === "" ? null : notes,
      butcherName: butcherName.trim() === "" ? null : butcherName,
      reviewedAt: new Date().toISOString(),
    });
    setSavedTick(true);
    setBusy(false);
  }

  return (
    <div className="rounded-lg border border-[#eee5d8] bg-[#fbfaf7] p-4" data-testid={`cut-${species}-${system.cutId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-black">{system.cutName}</p>
        <DecisionBadge decision={decision} savedTick={savedTick} />
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <Stat label="System yield" value={`${round(system.yieldPct * 100, 1)}%`} />
        <Stat label="Saleable cost" value={`£${system.costPerKgSaleable.toFixed(2)}/kg`} />
        <Stat label="System price" value={`£${system.suggestedPricePerKg.toFixed(2)}/kg`} />
        <Stat label="Target margin" value={`${round(system.marginPct * 100, 0)}%`} />
      </dl>

      <div className="mt-4 grid gap-3 sm:grid-cols-[repeat(2,minmax(0,7rem))_auto_1fr]">
        <div className="grid gap-1">
          <label className="text-xs font-semibold text-[#6c5e52]" htmlFor={`${species}-${system.cutId}-by`}>Butcher yield %</label>
          <Input id={`${species}-${system.cutId}-by`} type="number" step="0.1" inputMode="decimal" value={butcherYield} onChange={(e) => setButcherYield(e.target.value)} disabled={busy} />
        </div>
        <div className="grid gap-1">
          <label className="text-xs font-semibold text-[#6c5e52]" htmlFor={`${species}-${system.cutId}-bp`}>Butcher £/kg</label>
          <Input id={`${species}-${system.cutId}-bp`} type="number" step="0.01" inputMode="decimal" value={butcherPrice} onChange={(e) => setButcherPrice(e.target.value)} disabled={busy} />
        </div>
        <div className="grid gap-1">
          <span className="text-xs font-semibold text-[#6c5e52]">Variance</span>
          <span className="flex h-9 items-center" data-testid={`variance-${species}-${system.cutId}`}>
            <Badge tone={VARIANCE_TONE[band]}>{variance === null ? "—" : `${variance > 0 ? "+" : ""}${variance}%`}</Badge>
          </span>
        </div>
        <div className="grid gap-1">
          <label className="text-xs font-semibold text-[#6c5e52]" htmlFor={`${species}-${system.cutId}-dec`}>Verdict</label>
          <Select id={`${species}-${system.cutId}-dec`} value={decision} onChange={(e) => setDecision(e.target.value as PricingValidationDecision)} disabled={busy}>
            <option value="pending">Not reviewed</option>
            <option value="approved">Approved</option>
            <option value="changes_required">Changes required</option>
          </Select>
        </div>
      </div>

      <div className="mt-3 grid gap-1">
        <label className="text-xs font-semibold text-[#6c5e52]" htmlFor={`${species}-${system.cutId}-notes`}>Notes</label>
        <Textarea id={`${species}-${system.cutId}-notes`} rows={2} value={notes} placeholder="What the butcher would change, and why" onChange={(e) => setNotes(e.target.value)} disabled={busy} />
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-[#f5c2c7] bg-[#fff5f5] p-2 text-sm font-semibold text-[#9f1d1d]">{error}</p>
      )}

      <div className="mt-3">
        <Button type="button" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save verdict"}
        </Button>
      </div>
    </div>
  );
}

function DecisionBadge({ decision, savedTick }: { decision: PricingValidationDecision; savedTick: boolean }) {
  if (decision === "approved") {
    return (
      <Badge tone="green" className="gap-1">
        {savedTick && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />} Approved
      </Badge>
    );
  }
  if (decision === "changes_required") return <Badge tone="red">Changes required</Badge>;
  return <Badge tone="neutral">Not reviewed</Badge>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-[#8a7c6c]">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}

function round(value: number, dp: number) {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck, Thermometer } from "lucide-react";

import { completeComplianceDay, recordComplianceReading } from "@/app/actions/compliance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { validateComplianceCompletion } from "@/lib/domain/compliance";
import type { ComplianceLog, ComplianceReading, ComplianceReadingType } from "@/lib/domain/types";

export function ComplianceClient({
  branchId,
  log,
  readings,
}: {
  branchId: string;
  log: ComplianceLog | null;
  readings: ComplianceReading[];
}) {
  const router = useRouter();

  const [readingType, setReadingType] = useState<ComplianceReadingType>("opening");
  const [chiller, setChiller] = useState("");
  const [freezer, setFreezer] = useState("");
  const [display, setDisplay] = useState("");

  const [cleaning, setCleaning] = useState(log?.cleaningCompleted ?? false);
  const [sanitisation, setSanitisation] = useState(log?.sanitisationCompleted ?? false);
  const [waste, setWaste] = useState(log?.wasteChecked ?? false);

  const [busy, setBusy] = useState<"reading" | "complete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const completed = log?.status === "completed";

  // Client-side hint only; the RPC re-validates authoritatively server-side.
  const draftLog: ComplianceLog = {
    id: log?.id ?? "draft",
    branchId,
    logDate: log?.logDate ?? "",
    cleaningCompleted: cleaning,
    sanitisationCompleted: sanitisation,
    wasteChecked: waste,
    status: log?.status ?? "open",
  };
  const validation = validateComplianceCompletion(draftLog, readings);

  async function addReading() {
    setBusy("reading");
    setError(null);
    setNotice(null);

    const toNum = (v: string) => (v.trim() === "" ? null : Number(v));
    const chillerNum = toNum(chiller);
    const freezerNum = toNum(freezer);

    if (chillerNum === null || freezerNum === null || Number.isNaN(chillerNum) || Number.isNaN(freezerNum)) {
      setError("Enter the chiller and freezer temperatures.");
      setBusy(null);
      return;
    }

    const res = await recordComplianceReading({
      branchId,
      readingType,
      chillerTempC: chillerNum,
      freezerTempC: freezerNum,
      displayTempC: display.trim() === "" ? null : Number(display),
    });

    if (!res.ok) {
      setError(res.message);
      setBusy(null);
      return;
    }

    setChiller("");
    setFreezer("");
    setDisplay("");
    setNotice("Reading recorded.");
    setBusy(null);
    router.refresh();
  }

  async function complete() {
    setBusy("complete");
    setError(null);
    setNotice(null);

    const res = await completeComplianceDay({
      branchId,
      cleaningCompleted: cleaning,
      sanitisationCompleted: sanitisation,
      wasteChecked: waste,
    });

    if (!res.ok) {
      setError(res.message);
      setBusy(null);
      return;
    }

    setNotice("Daily log completed.");
    setBusy(null);
    router.refresh();
  }

  return (
    <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="rounded-lg border border-[#ded6ca] bg-white p-6">
        <div className="flex items-center gap-3">
          <Thermometer className="h-6 w-6 text-[#0f5132]" aria-hidden />
          <h2 className="text-xl font-black">Temperature reading</h2>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="readingType">Reading type</label>
            <Select
              id="readingType"
              name="readingType"
              value={readingType}
              onChange={(e) => setReadingType(e.target.value as ComplianceReadingType)}
              disabled={busy !== null || completed}
            >
              <option value="opening">Opening</option>
              <option value="midday">Midday</option>
              <option value="closing">Closing</option>
              <option value="ad_hoc">Ad hoc</option>
            </Select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="chiller">Chiller temp C</label>
            <Input id="chiller" name="chiller" type="number" step="0.1" inputMode="decimal" value={chiller} onChange={(e) => setChiller(e.target.value)} disabled={busy !== null || completed} />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="freezer">Freezer temp C</label>
            <Input id="freezer" name="freezer" type="number" step="0.1" inputMode="decimal" value={freezer} onChange={(e) => setFreezer(e.target.value)} disabled={busy !== null || completed} />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-semibold" htmlFor="display">Display temp C (optional)</label>
            <Input id="display" name="display" type="number" step="0.1" inputMode="decimal" value={display} onChange={(e) => setDisplay(e.target.value)} disabled={busy !== null || completed} />
          </div>
          <div className="sm:col-span-2">
            <Button type="button" onClick={addReading} disabled={busy !== null || completed}>
              <Thermometer className="h-4 w-4" aria-hidden />
              {busy === "reading" ? "Saving…" : "Add reading"}
            </Button>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-[#f5c2c7] bg-[#fff5f5] p-3 text-sm font-semibold text-[#9f1d1d]" data-testid="compliance-error">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="mt-4 rounded-lg border border-[#bfe3cf] bg-[#f2fbf5] p-3 text-sm font-semibold text-[#0f5132]" data-testid="compliance-notice">
            {notice}
          </p>
        )}

        <div className="mt-8">
          <h3 className="font-black">Recorded today</h3>
          {readings.length === 0 ? (
            <p className="mt-3 rounded-lg border border-[#eee5d8] bg-[#fbfaf7] p-4 text-sm font-semibold text-[#6c5e52]" data-testid="compliance-empty">
              No temperature readings recorded yet today.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-[#eee5d8] rounded-lg border border-[#eee5d8]" data-testid="compliance-readings">
              {readings.map((reading) => (
                <div key={reading.id} className="grid gap-2 p-4 text-sm sm:grid-cols-4">
                  <p className="font-bold capitalize">{reading.readingType.replace("_", " ")}</p>
                  <p>Chiller {reading.chillerTempC}C</p>
                  <p>Freezer {reading.freezerTempC}C</p>
                  <p>Display {reading.displayTempC ?? "-"}C</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <aside className="rounded-lg border border-[#ded6ca] bg-white p-5">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-6 w-6 text-[#0f5132]" aria-hidden />
          <h2 className="text-xl font-black">Completion checks</h2>
        </div>

        {completed ? (
          <p className="mt-5 flex items-center gap-2 rounded-lg border border-[#bfe3cf] bg-[#f2fbf5] p-4 text-sm font-bold text-[#0f5132]" data-testid="compliance-completed">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            Today&apos;s log is complete.
          </p>
        ) : (
          <>
            <div className="mt-5 space-y-3 text-sm">
              {([
                ["Cleaning completed", cleaning, setCleaning] as const,
                ["Sanitisation completed", sanitisation, setSanitisation] as const,
                ["Waste checked", waste, setWaste] as const,
              ]).map(([label, checked, setChecked]) => (
                <label key={label} className="flex items-center gap-3 rounded-md bg-[#fbfaf7] p-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[#0f5132]"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                    disabled={busy !== null}
                  />
                  <span className="font-semibold">{label}</span>
                </label>
              ))}
            </div>
            {!validation.valid && (
              <div className="mt-5 rounded-lg border border-[#f0c66e] bg-[#fff6df] p-4 text-sm text-[#5a3900]" data-testid="compliance-validation">
                {validation.errors[0]}
              </div>
            )}
            <Button type="button" className="mt-5 w-full" onClick={complete} disabled={busy !== null || !validation.valid}>
              {busy === "complete" ? "Completing…" : "Mark completed"}
            </Button>
          </>
        )}
      </aside>
    </section>
  );
}

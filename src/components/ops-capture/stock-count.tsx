"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ClipboardCheck, PlayCircle } from "lucide-react";

import { applyStockCountLine, completeChecklist, recordStockCountLine, startOrResumeChecklist } from "@/app/actions/ops-capture";
import { stockVarianceKg } from "@/lib/ops-capture/progress";
import type { StockCountBatch, StockCountLineState } from "@/lib/server/ops-capture";
import { cn } from "@/lib/utils";

type Lines = Record<string, StockCountLineState>;

/** Slug ↔ name, mirrors the slug used to build the operator-action id (operator-guidance). */
function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function StockCount({
  branchId,
  initialSessionId,
  batches,
  initialLines,
  focusSlug = null,
}: {
  branchId: string;
  initialSessionId: string | null;
  batches: StockCountBatch[];
  initialLines: Lines;
  /** V15.2 — when the operator arrived to count a specific item, its slug. Highlighted + scrolled to. */
  focusSlug?: string | null;
}) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [lines, setLines] = useState<Lines>(initialLines);
  const [inputs, setInputs] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const [batchId, line] of Object.entries(initialLines)) seed[batchId] = String(line.countedKg);
    return seed;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  async function start() {
    setBusy("start");
    setError(null);
    const res = await startOrResumeChecklist({ branchId, kind: "stock_count" });
    if (!res.ok || !res.id) setError(res.ok ? "Could not start." : res.message);
    else setSessionId(res.id);
    setBusy(null);
  }

  async function saveCount(batch: StockCountBatch) {
    if (!sessionId) return;
    const raw = inputs[batch.batchId];
    if (raw === undefined || raw.trim() === "") return;
    setBusy(batch.batchId);
    setError(null);

    const counted = Number(raw);
    const res = await recordStockCountLine({ sessionId, batchId: batch.batchId, countedWeightKg: counted });
    if (!res.ok || !res.id) {
      setError(res.ok ? "Could not record this count." : res.message);
      setBusy(null);
      return;
    }
    setLines((prev) => ({
      ...prev,
      [batch.batchId]: { lineId: res.id!, countedKg: counted, systemKg: batch.remainingKg, applied: false },
    }));
    setBusy(null);
  }

  async function applyCount(batchId: string) {
    if (!sessionId) return;
    const line = lines[batchId];
    if (!line) return;
    setBusy(batchId);
    setError(null);

    const res = await applyStockCountLine({ sessionId, lineId: line.lineId });
    if (!res.ok) {
      setError(res.message);
      setBusy(null);
      return;
    }
    setLines((prev) => ({ ...prev, [batchId]: { ...prev[batchId], applied: true } }));
    setBusy(null);
  }

  async function finish() {
    if (!sessionId) return;
    setBusy("finish");
    const res = await completeChecklist({ sessionId });
    if (!res.ok) {
      setError(res.message);
      setBusy(null);
      return;
    }
    setFinished(true);
    setBusy(null);
  }

  if (finished) {
    return (
      <section className="rounded-2xl border border-[#bfe3cf] bg-[#f2fbf5] p-6 text-center shadow-sm" data-testid="stock-count-finish">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#0f5132] text-white">
          <CheckCircle2 className="h-7 w-7" aria-hidden />
        </span>
        <h2 className="mt-4 text-2xl font-black text-[#0f5132]">Stock count done</h2>
        <p className="mx-auto mt-2 max-w-md text-base leading-7 text-[#27543c]">
          Your counts are saved. Any corrections were applied with a full record of what changed and why.
        </p>
        <Link href="/admin/today" className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#0f5132] px-6 text-base font-bold text-white transition hover:bg-[#0c3f27]">
          Back to today
        </Link>
      </section>
    );
  }

  if (!sessionId) {
    return (
      <section className="rounded-2xl border border-[#ded6ca] bg-white p-6 shadow-sm" data-testid="stock-count-intro">
        <p className="text-base leading-7 text-[#3f372f]">
          Walk the fridge and weigh what&apos;s actually left. The system shows what it thinks you have — if your count
          differs, you can correct it, and the change is recorded with a reason. Counting on its own never changes your stock.
        </p>
        <button
          type="button"
          onClick={start}
          disabled={busy === "start"}
          data-testid="stock-count-start"
          className="mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-[#0f5132] px-6 text-base font-bold text-white transition hover:bg-[#0c3f27] disabled:opacity-50"
        >
          <PlayCircle className="h-5 w-5" aria-hidden />
          Start stock count
        </button>
      </section>
    );
  }

  return (
    <div data-testid="stock-count">
      <div className="flex items-center justify-between gap-3">
        <Link href="/admin/today" className="inline-flex items-center gap-1 text-sm font-bold text-[#0f5132] hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to today
        </Link>
        <span className="text-sm font-bold text-[#6c5e52]">{batches.length === 1 ? "1 item to count" : `${batches.length} items to count`}</span>
      </div>

      {error && <p className="mt-3 rounded-xl border border-[#f5c2c7] bg-[#fff5f5] p-3 text-sm font-semibold text-[#9f1d1d]" data-testid="stock-count-error">{error}</p>}

      {batches.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-[#f2fbf5] p-4 text-sm font-semibold text-[#0f5132]">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          No stock to count right now.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {batches.map((batch) => (
            <li key={batch.batchId}>
              <BatchRow
                batch={batch}
                line={lines[batch.batchId] ?? null}
                value={inputs[batch.batchId] ?? ""}
                busy={busy === batch.batchId}
                focused={focusSlug !== null && slug(batch.productName) === focusSlug}
                onChange={(v) => setInputs((p) => ({ ...p, [batch.batchId]: v }))}
                onSave={() => saveCount(batch)}
                onApply={() => applyCount(batch.batchId)}
              />
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={finish}
        disabled={busy === "finish"}
        data-testid="stock-count-complete"
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0f5132] px-6 text-base font-bold text-white transition hover:bg-[#0c3f27] disabled:opacity-50"
      >
        <ClipboardCheck className="h-5 w-5" aria-hidden />
        Finish stock count
      </button>
    </div>
  );
}

function BatchRow({
  batch,
  line,
  value,
  busy,
  focused,
  onChange,
  onSave,
  onApply,
}: {
  batch: StockCountBatch;
  line: StockCountLineState | null;
  value: string;
  busy: boolean;
  focused: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onApply: () => void;
}) {
  const systemKg = line ? line.systemKg : batch.remainingKg;
  const variance = line ? stockVarianceKg(line.systemKg, line.countedKg) : null;
  const matches = variance === 0;
  const ref = useRef<HTMLDivElement>(null);

  // V15.2 — when the operator tapped a TODAY action to count this item, bring it into view.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused]);

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl border bg-white p-4 shadow-sm",
        focused ? "border-[#0f5132] ring-2 ring-[#0f5132]/40" : "border-[#ded6ca]",
      )}
      data-testid="stock-count-batch"
      data-focused={focused ? "true" : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-black text-[#241f1a]">{batch.productName}</p>
        <span className="text-sm font-semibold text-[#6c5e52]">
          System thinks: <span className="font-black text-[#241f1a]">{systemKg} kg</span>
        </span>
      </div>

      {line?.applied ? (
        <p className="mt-3 flex items-center gap-2 text-sm font-bold text-[#0f5132]" data-testid="count-applied">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          {matches ? `Counted ${line.countedKg} kg — matched, no change.` : `Adjusted to ${line.countedKg} kg.`}
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-end gap-2">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-[0.06em] text-[#6c5e52]">Counted</span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  data-testid="count-input"
                  className="h-11 w-28 rounded-xl border border-[#d6cdc0] bg-[#fbfaf7] px-3 text-base font-bold text-[#241f1a] outline-none focus:border-[#0f5132]"
                />
                <span className="text-base font-bold text-[#6c5e52]">kg</span>
              </div>
            </label>
            <button
              type="button"
              onClick={onSave}
              disabled={busy || value.trim() === ""}
              data-testid="save-count-btn"
              className="inline-flex h-11 items-center justify-center rounded-full border border-[#d6cdc0] bg-[#f7f3ed] px-5 text-base font-bold text-[#0f5132] transition hover:bg-[#efe8dd] disabled:opacity-50"
            >
              Save count
            </button>
          </div>

          {line && variance !== null && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.04em]",
                  matches ? "bg-[#e6f5ec] text-[#0f5132]" : "bg-[#fff4d8] text-[#8b5e00]",
                )}
                data-testid="count-variance"
              >
                {matches ? "Matches the system" : `${variance > 0 ? "+" : ""}${variance} kg vs system`}
              </span>
              <button
                type="button"
                onClick={onApply}
                disabled={busy}
                data-testid="apply-count-btn"
                className="inline-flex h-10 items-center justify-center rounded-full bg-[#0f5132] px-5 text-sm font-bold text-white transition hover:bg-[#0c3f27] disabled:opacity-50"
              >
                {matches ? "Confirm" : "Apply correction"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

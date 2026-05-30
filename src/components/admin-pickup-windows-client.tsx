"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import {
  createPickupWindow,
  setPickupWindowActive,
  updatePickupWindow,
  type AdminScheduleResult,
} from "@/app/actions/admin-schedule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PickupWindow } from "@/lib/domain/types";
import { formatTimeRange } from "@/lib/utils";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

type Feedback = { tone: "ok" | "error"; message: string } | null;

export function AdminPickupWindowsClient({
  branchId,
  initialWindows,
}: {
  branchId: string;
  initialWindows: PickupWindow[];
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  function announce(r: AdminScheduleResult) {
    setFeedback(r.ok ? { tone: "ok", message: r.message } : { tone: "error", message: r.message });
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
          <h1 className="mt-2 text-3xl font-black">Pickup windows</h1>
        </div>
        <Button type="button" data-testid="add-window-button" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "Close" : "Add window"}
        </Button>
      </div>

      {feedback && (
        <div
          role="status"
          data-testid="window-feedback"
          className={
            "mt-4 flex items-center gap-2 rounded-lg border p-3 text-sm " +
            (feedback.tone === "ok"
              ? "border-[#0f5132]/30 bg-[#e6efe9] text-[#0f5132]"
              : "border-[#f0c66e] bg-[#fff6df] text-[#5a3900]")
          }
        >
          {feedback.tone === "ok" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {showAdd && (
        <AddWindowForm
          branchId={branchId}
          onResult={(r) => {
            announce(r);
            if (r.ok) setShowAdd(false);
          }}
        />
      )}

      <div className="mt-8 grid gap-4">
        {initialWindows.length === 0 && (
          <p className="rounded-lg border border-[#ded6ca] bg-white p-5 text-sm text-[#6c5e52]">No pickup windows yet.</p>
        )}
        {initialWindows.map((window) => (
          <WindowRow key={window.id} window={window} onResult={announce} />
        ))}
      </div>
    </div>
  );
}

function AddWindowForm({ branchId, onResult }: { branchId: string; onResult: (r: AdminScheduleResult) => void }) {
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("14:00");
  const [capacity, setCapacity] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function submit() {
    startTransition(async () => {
      const result = await createPickupWindow({
        branchId,
        label,
        startTime,
        endTime,
        maxOrders: capacity === "" ? null : Number(capacity),
        daysOfWeek: days,
      });
      onResult(result);
      if (result.ok) {
        setLabel("");
      }
    });
  }

  return (
    <form
      className="mt-6 grid gap-4 rounded-lg border border-[#ded6ca] bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className="text-lg font-black">New pickup window</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Label
          <Input data-testid="new-window-label" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={60} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Capacity (optional)
          <Input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" min="0" inputMode="numeric" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Start
          <Input data-testid="new-window-start" value={startTime} onChange={(e) => setStartTime(e.target.value)} type="time" required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          End
          <Input data-testid="new-window-end" value={endTime} onChange={(e) => setEndTime(e.target.value)} type="time" required />
        </label>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">Days</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <label key={d.value} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={days.includes(d.value)} onChange={() => toggleDay(d.value)} />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" data-testid="new-window-submit" disabled={isPending}>
          {isPending ? "Creating…" : "Create window"}
        </Button>
      </div>
    </form>
  );
}

function WindowRow({ window, onResult }: { window: PickupWindow; onResult: (r: AdminScheduleResult) => void }) {
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState(window.label);
  const [startTime, setStartTime] = useState(window.startTime);
  const [endTime, setEndTime] = useState(window.endTime);
  const [active, setActive] = useState(window.isActive);

  function save() {
    startTransition(async () => {
      const result = await updatePickupWindow({
        windowId: window.id,
        label,
        startTime,
        endTime,
        maxOrders: window.maxOrders,
        daysOfWeek: window.daysOfWeek,
        windowType: window.windowType,
      });
      onResult(result);
    });
  }

  function toggleActive() {
    startTransition(async () => {
      const result = await setPickupWindowActive({ windowId: window.id, isActive: !active });
      onResult(result);
      if (result.ok) setActive(!active);
    });
  }

  return (
    <article data-testid="window-row" data-label={window.label} className="rounded-lg border border-[#ded6ca] bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Label
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </label>
        <p className="self-end text-sm text-[#6c5e52]">{formatTimeRange(window.startTime, window.endTime)}</p>
        <label className="grid gap-1 text-sm font-semibold">
          Start
          <Input value={startTime} onChange={(e) => setStartTime(e.target.value)} type="time" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          End
          <Input value={endTime} onChange={(e) => setEndTime(e.target.value)} type="time" />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant={active ? "secondary" : "default"}
            data-testid="window-toggle-active"
            disabled={isPending}
            onClick={toggleActive}
          >
            {active ? "Disable" : "Enable"}
          </Button>
          <span
            data-testid="window-active-state"
            className={
              "rounded-full px-3 py-1 text-xs font-bold " +
              (active ? "bg-[#e6efe9] text-[#0f5132]" : "bg-[#fde8e6] text-[#b42318]")
            }
          >
            {active ? "Enabled" : "Disabled"}
          </span>
        </div>
        <Button type="button" data-testid="window-save" disabled={isPending} onClick={save}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </article>
  );
}

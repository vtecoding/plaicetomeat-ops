"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, CheckCircle2, ClipboardCheck, Receipt, Trash2 } from "lucide-react";

import { confirmWasteReason, resolveDeliveryCost, resolveOwnerAlert } from "@/app/actions/reconcile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Item = {
  alertId: string;
  kind: string;
  action: "inline-cost" | "confirm-reason" | "link" | "note-resolve";
  autoResolve: "stock-touch" | "checklist-step-complete" | "opening-complete" | "certificate-renewal-or-window" | null;
  title: string;
  summary: string;
  severity: "warning" | "critical";
  createdAt: string;
  fullHref: string | null;
  batchId: string | null;
  productName: string | null;
  supplierName: string | null;
  receivedDate: string | null;
  quantityKg: number | null;
  currentCost: number | null;
  reasonLabel: string | null;
};

export function ReconcileClient({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState(initialItems);

  function clear(alertId: string) {
    setItems((prev) => prev.filter((item) => item.alertId !== alertId));
  }

  if (items.length === 0) {
    return (
      <section className="mt-6 flex items-center gap-3 rounded-2xl border border-[#cfe6da] bg-[#f4faf6] p-6" data-testid="reconcile-empty">
        <CheckCircle2 className="h-7 w-7 shrink-0 text-[var(--brand)]" aria-hidden />
        <div>
          <p className="font-display text-lg font-semibold text-[var(--brand)]">All clear</p>
          <p className="text-sm font-medium text-[#27543c]">Nothing to reconcile right now.</p>
        </div>
      </section>
    );
  }

  const groups = items.reduce<Array<{ kind: string; title: string; items: Item[] }>>((all, item) => {
    const existing = all.find((group) => group.kind === item.kind);
    if (existing) existing.items.push(item);
    else all.push({ kind: item.kind, title: item.title, items: [item] });
    return all;
  }, []);

  return (
    <div className="mt-6 grid gap-7" data-testid="reconcile-list">
      {groups.map((group) => (
        <section key={group.kind} data-testid={`owner-job-group-${group.kind}`}>
          <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
            <h2 className="font-display text-xl font-semibold text-[var(--ink)]">{group.title}</h2>
            <span className="text-sm font-bold text-[var(--muted)]">
              {group.items.length} {group.items.length === 1 ? "job" : "jobs"}
            </span>
          </div>
          <ol className="grid gap-4">
            {group.items.map((item) => (
              <li key={item.alertId}>
                {item.action === "inline-cost" ? (
                  <DeliveryCostCard item={item} onDone={() => clear(item.alertId)} />
                ) : item.action === "confirm-reason" ? (
                  <WasteReasonCard item={item} onDone={() => clear(item.alertId)} />
                ) : (
                  <GeneralJobCard item={item} onDone={() => clear(item.alertId)} />
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Shell({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-[0_1px_0_rgba(255,255,255,0.7)]">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--brand-50)] text-[var(--brand)] ring-1 ring-[#d6e8df]">{icon}</span>
        <h2 className="font-display text-lg font-semibold text-[var(--ink)]">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col">
          <dt className="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[var(--faint)]">{label}</dt>
          <dd className="font-semibold text-[var(--ink)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FullDetails({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--brand)]">
      Open full details
      <ArrowUpRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

function DeliveryCostCard({ item, onDone }: { item: Item; onDone: () => void }) {
  const [cost, setCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    const value = Number(cost);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter the invoice cost.");
      return;
    }
    if (!item.batchId) {
      setError("This delivery can't be found. Open full details.");
      return;
    }
    setError(null);
    start(async () => {
      const res = await resolveDeliveryCost({ alertId: item.alertId, batchId: item.batchId!, invoiceCost: value });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onDone();
    });
  }

  return (
    <Shell icon={<Receipt className="h-5 w-5" aria-hidden />} title={item.title}>
      <Facts
        rows={[
          ["Product", item.productName ?? "Not sure"],
          ["Supplier", item.supplierName ?? "Not sure"],
          ["Delivered", item.receivedDate ?? "—"],
          ["Amount", item.quantityKg != null ? `${item.quantityKg} kg` : "—"],
        ]}
      />
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="text-xs font-semibold text-[var(--muted)]">Invoice cost</span>
          <span className="flex items-center gap-2">
            <span className="text-lg font-semibold text-[var(--muted)]">£</span>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              disabled={pending}
              className="w-32"
              data-testid={`reconcile-cost-${item.alertId}`}
            />
          </span>
        </label>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save & Resolve"}
        </Button>
        <FullDetails href={item.fullHref} />
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-[var(--clay)]">{error}</p>}
    </Shell>
  );
}

function WasteReasonCard({ item, onDone }: { item: Item; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      const res = await confirmWasteReason({ alertId: item.alertId });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onDone();
    });
  }

  return (
    <Shell icon={<Trash2 className="h-5 w-5" aria-hidden />} title={item.title}>
      <p className="text-sm font-medium text-[var(--muted)]">{item.summary}</p>
      <div className="mt-3">
        <Facts
          rows={[
            ["Amount", item.quantityKg != null ? `${item.quantityKg} kg` : "—"],
            ["Reason given", item.reasonLabel ?? "Needs a look"],
          ]}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={confirm} disabled={pending}>
          <Check className="mr-1.5 h-4 w-4" aria-hidden />
          {pending ? "Saving…" : "Confirm & Resolve"}
        </Button>
        <FullDetails href={item.fullHref} />
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-[var(--clay)]">{error}</p>}
    </Shell>
  );
}

function GeneralJobCard({ item, onDone }: { item: Item; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function resolve() {
    setError(null);
    start(async () => {
      const res = await resolveOwnerAlert({ alertId: item.alertId, note });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onDone();
    });
  }

  return (
    <Shell
      icon={item.severity === "critical" ? <AlertTriangle className="h-5 w-5" aria-hidden /> : <ClipboardCheck className="h-5 w-5" aria-hidden />}
      title={item.title}
    >
      {item.severity === "critical" ? (
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--clay)]">Urgent</p>
      ) : null}
      <p className="text-sm font-medium text-[var(--muted)]">{item.summary}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <FullDetails href={item.fullHref} />
        <span className="text-xs font-medium text-[var(--faint)]">
          Raised {new Date(item.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
      {item.autoResolve ? (
        <p className="mt-4 text-sm font-semibold text-[var(--brand)]">
          Complete the linked work. This job will clear automatically.
        </p>
      ) : (
        <>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-semibold text-[var(--muted)]">What did you do?</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          disabled={pending}
          className="w-full rounded-xl border border-[var(--line)] bg-white p-3 text-sm outline-none focus:border-[var(--brand)]"
          data-testid={`owner-job-note-${item.alertId}`}
        />
      </label>
      <Button type="button" className="mt-3" onClick={resolve} disabled={pending} data-testid={`owner-job-resolve-${item.alertId}`}>
        <Check className="mr-1.5 h-4 w-4" aria-hidden />
        {pending ? "Saving…" : "Resolve with note"}
      </Button>
        </>
      )}
      {error && <p className="mt-3 text-sm font-semibold text-[var(--clay)]">{error}</p>}
    </Shell>
  );
}

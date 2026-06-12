"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, FileText } from "lucide-react";

import { capturePaperPhoto } from "@/app/actions/operator/certificate";

type PaperKind = "halal" | "supplier" | "fridge" | "other";
type Mode = "pick" | "photo" | "done";

const choices: Array<{ id: PaperKind; label: string }> = [
  { id: "halal", label: "Halal paper" },
  { id: "supplier", label: "Supplier paper" },
  { id: "fridge", label: "Fridge paper" },
  { id: "other", label: "Other paper" },
];

export function OperatorCertificateFlow() {
  const [runId, setRunId] = useState("");
  const [mode, setMode] = useState<Mode>("pick");
  const [paperKind, setPaperKind] = useState<PaperKind>("halal");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }, []);

  function restart() {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    setMode("pick");
    setPaperKind("halal");
    setResult(null);
    setError(null);
  }

  function savePhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("paperKind", paperKind);
      formData.set("runId", runId);
      const res = await capturePaperPhoto(formData);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult(res.message);
      setMode("done");
    });
  }

  return (
    <div data-testid="operator-certificate-flow">
      <Link href="/operator" className="mb-5 inline-flex min-h-[56px] items-center gap-2 text-lg font-semibold text-[var(--brand)]">
        <ArrowLeft className="h-6 w-6" aria-hidden />
        Go back
      </Link>

      {mode === "pick" && (
        <Panel title="What paper is it?">
          {choices.map((choice) => (
            <BigButton key={choice.id} onClick={() => { setPaperKind(choice.id); setMode("photo"); }} label={choice.label} />
          ))}
        </Panel>
      )}

      {mode === "photo" && (
        <Panel title="Take photo">
          <label className="flex min-h-[72px] cursor-pointer items-center justify-center rounded-2xl bg-[var(--brand)] px-6 text-xl font-semibold text-white transition active:scale-[0.99]">
            Take or choose photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={isPending || !runId}
              onChange={(event) => savePhoto(event.target.files?.[0])}
            />
          </label>
          <BigButton onClick={() => setMode("pick")} label="Go back" muted />
          {isPending ? <p className="text-base font-semibold text-[var(--muted)]">Saving photo...</p> : null}
        </Panel>
      )}

      {mode === "done" && (
        <Panel title="Done">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white">
            <Check className="h-9 w-9" aria-hidden />
          </div>
          {result ? <p className="text-center text-lg font-semibold text-[var(--muted)]">{result}</p> : null}
          <BigButton onClick={restart} label="Take another" />
          <Link
            href="/operator"
            className="flex min-h-[64px] items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 text-lg font-semibold text-[var(--muted)]"
          >
            Go home
          </Link>
        </Panel>
      )}

      {error ? <p className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-base font-semibold text-[var(--clay)]">{error}</p> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <FileText className="mt-1 h-8 w-8 shrink-0 text-[var(--brand)]" aria-hidden />
        <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
      </div>
      <div className="mt-6 grid gap-3">{children}</div>
    </section>
  );
}

function BigButton({ label, onClick, muted, disabled }: { label: string; onClick: () => void; muted?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex min-h-[72px] w-full items-center justify-center rounded-2xl px-6 text-xl font-semibold transition active:scale-[0.99] disabled:opacity-50",
        muted ? "border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)]" : "bg-[var(--brand)] text-white",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

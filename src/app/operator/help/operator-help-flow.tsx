"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";

import { tellOwner } from "@/app/actions/operator/help";
import { HELP_PROBLEM_CHOICES, helpProblemLabel, type HelpProblemId } from "@/lib/operator/workflows/help";

type Mode = "choose" | "send" | "done";

export function OperatorHelpFlow({ ownerContact }: { ownerContact: string | null }) {
  const [mode, setMode] = useState<Mode>("choose");
  const [problem, setProblem] = useState<HelpProblemId>("other");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [isPending, startTransition] = useTransition();

  function restart() {
    setMode("choose");
    setProblem("other");
    setNote("");
    setResult(null);
    setError(null);
    setOperationId(crypto.randomUUID());
  }

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await tellOwner({ operationId, problem, note });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult(res.message);
      setMode("done");
    });
  }

  return (
    <div data-testid="operator-help-flow">
      <Link
        href="/operator"
        className="mb-5 inline-flex min-h-[56px] items-center gap-2 text-lg font-semibold text-[var(--brand)]"
      >
        <ArrowLeft className="h-6 w-6" aria-hidden />
        Back
      </Link>

      {ownerContact ? (
        <a
          href={`tel:${ownerContact.replace(/[^+\d]/g, "")}`}
          className="mb-5 flex min-h-[64px] w-full items-center justify-center rounded-2xl border-2 border-[var(--clay)] bg-[var(--paper)] px-5 text-center text-lg font-semibold text-[var(--clay)]"
          data-testid="operator-owner-call"
        >
          If it&rsquo;s urgent, ring: {ownerContact}
        </a>
      ) : null}

      {mode === "choose" && (
        <Panel title="What is wrong?" helper="Pick the closest one. The owner will be told.">
          {HELP_PROBLEM_CHOICES.map((choice) => (
            <BigButton
              key={choice.id}
              label={choice.label}
              onClick={() => {
                setProblem(choice.id);
                setMode("send");
              }}
            />
          ))}
        </Panel>
      )}

      {mode === "send" && (
        <Panel title={helpProblemLabel(problem)} helper="We will tell the owner now.">
          <label className="block">
            <span className="mb-2 block text-base font-semibold text-[var(--muted)]">
              Add a few words (if you want)
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={200}
              data-testid="operator-help-note"
              className="w-full rounded-2xl border-2 border-[var(--line)] bg-[var(--paper)] p-4 text-xl outline-none focus:border-[var(--brand)]"
            />
          </label>
          <BigButton label="Tell the owner" onClick={send} busy={isPending} />
          <BigButton label="Pick something else" onClick={() => setMode("choose")} muted />
        </Panel>
      )}

      {mode === "done" && (
        <Panel title={result ?? "Done. The owner has been told."}>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white">
            <Check className="h-9 w-9" aria-hidden />
          </div>
          <BigButton label="Tell about something else" onClick={restart} />
          <Link
            href="/operator"
            className="flex min-h-[64px] items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 text-lg font-semibold text-[var(--muted)]"
          >
            Back to home
          </Link>
        </Panel>
      )}

      {error ? (
        <p className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-base font-semibold text-[var(--clay)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Panel({ title, helper, children }: { title: string; helper?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-6 shadow-sm">
      <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
      {helper ? <p className="mt-2 text-base leading-7 text-[var(--muted)]">{helper}</p> : null}
      <div className="mt-6 grid gap-3">{children}</div>
    </section>
  );
}

function BigButton({ label, onClick, muted, busy }: { label: string; onClick: () => void; muted?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={[
        "flex min-h-[72px] w-full items-center justify-center rounded-2xl px-6 text-xl font-semibold transition active:scale-[0.99] disabled:opacity-50",
        muted ? "border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)]" : "bg-[var(--brand)] text-white",
      ].join(" ")}
    >
      {busy ? "Sending..." : label}
    </button>
  );
}

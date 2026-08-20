"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardCheck, PackageCheck, PoundSterling, RotateCcw, ShoppingCart, X } from "lucide-react";
import { useEffect, useState } from "react";
import { OWNER_TUTORIAL_STORAGE_KEY } from "@/lib/operator/tutorial/route-guard";

const STORAGE_KEY = OWNER_TUTORIAL_STORAGE_KEY;
const STEPS = [
  { target: "owner-today", title: "Start with Today", instruction: "Today is your first stop. It shows only what needs you now." },
  { target: "owner-alerts", title: "Act on exceptions", instruction: "Open urgent owner jobs first. Acknowledged means seen; resolved means the work is finished." },
  { target: "owner-stock", title: "Check stock before buying", instruction: "Use Inventory to see what is in and expiring. Use Purchasing for the suggested order." },
  { target: "owner-money", title: "Check money truth", instruction: "Yesterday’s money shows sales, till movements and whether the counted till matched." },
  { target: "owner-compliance", title: "Review proof", instruction: "Compliance shows certificate gaps. Evidence holds operator photos and handoffs that need review." },
] as const;

export function OwnerTutorial() {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const parsed = Number(sessionStorage.getItem(STORAGE_KEY));
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= STEPS.length) setStep(parsed);
    setReady(true);
  }, []);
  useEffect(() => { if (ready) sessionStorage.setItem(STORAGE_KEY, String(step)); }, [ready, step]);
  const exit = () => sessionStorage.removeItem(STORAGE_KEY);
  if (!ready) return null;
  const active = STEPS[step];

  return <main className="mx-auto max-w-4xl px-4 pb-28 pt-6 sm:px-6" data-testid="owner-tutorial" data-owner-execution-mode="dry-run">
    <div className="rounded-2xl border-2 border-[#df9d00] bg-[#fff9e5] px-5 py-4">
      <p className="text-xs font-black uppercase tracking-[.12em] text-[#694d00]">Owner tutorial · practice only</p>
      <h1 className="mt-1 font-display text-3xl font-semibold">Where to look and what needs action</h1>
      <p className="mt-2 text-[#645644]">These are fixed practice examples. No alert, stock, money, compliance or evidence record can be changed here.</p>
    </div>

    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <PracticeCard target="owner-today" active={active?.target === "owner-today"} icon={CheckCircle2} eyebrow="TODAY / Owner Brain" title="2 things need you" body="Start here. Work from top to bottom; leave Later until Do now is clear." onClick={() => setStep(1)} />
      <PracticeCard target="owner-alerts" active={active?.target === "owner-alerts"} icon={AlertTriangle} eyebrow="Owner jobs" title="Fridge reading needs review" body="Open means work remains. Acknowledge is not the same as resolve." onClick={() => setStep(2)} />
      <PracticeCard target="owner-stock" active={active?.target === "owner-stock"} icon={PackageCheck} eyebrow="Inventory → Purchasing" title="Chicken is low" body="Inventory explains what is left. Purchasing turns that truth into an order suggestion." onClick={() => setStep(3)} />
      <PracticeCard target="owner-money" active={active?.target === "owner-money"} icon={PoundSterling} eyebrow="Yesterday’s money" title="Till matched" body="Check cash, card and till movements together. A difference needs review, not guesswork." onClick={() => setStep(4)} />
      <PracticeCard target="owner-compliance" active={active?.target === "owner-compliance"} icon={ClipboardCheck} eyebrow="Compliance → Evidence" title="1 certificate due soon" body="Check the document, then review the operator’s photo or handoff evidence." onClick={() => setStep(5)} />
    </div>

    {active ? <section role="dialog" aria-live="polite" className="fixed bottom-4 left-1/2 z-50 w-[min(420px,calc(100vw-24px))] -translate-x-1/2 rounded-2xl border border-[#d6c9b6] bg-white p-5 shadow-2xl">
      <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-[#fff2bf] px-3 py-1 text-xs font-black text-[#694d00]">Step {step + 1} of {STEPS.length}</span><Link href="/admin/today" onClick={exit} aria-label="Exit Owner Tutorial" className="rounded-md p-2 hover:bg-[#f4efe7]"><X className="h-5 w-5" /></Link></div>
      <h2 className="mt-3 text-xl font-black">{active.title}</h2><p className="mt-1 text-[#4e463f]">{active.instruction}</p>
      <div className="mt-4 flex justify-between"><button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0} className="rounded-lg px-3 py-2 font-semibold disabled:opacity-40">Back</button><button type="button" onClick={() => setStep(0)} aria-label="Restart Owner Tutorial" className="rounded-lg p-2"><RotateCcw className="h-5 w-5" /></button></div>
    </section> : <section className="mt-6 rounded-2xl border border-[#c5ddd0] bg-[#f4faf6] p-6" data-testid="owner-tutorial-complete"><CheckCircle2 className="h-10 w-10 text-[var(--brand)]" /><h2 className="mt-3 font-display text-2xl font-semibold">Owner walkthrough complete</h2><p className="mt-1 text-[var(--muted)]">No real shop records changed.</p><div className="mt-5 flex flex-wrap gap-3"><Link href="/admin/today" onClick={exit} className="rounded-lg bg-[var(--brand)] px-4 py-3 font-semibold text-white">Open Today</Link><Link href="/operator" onClick={exit} className="rounded-lg border border-[var(--line)] bg-white px-4 py-3 font-semibold">Practise shop operations</Link></div></section>}
  </main>;
}

function PracticeCard({ target, active, icon: Icon, eyebrow, title, body, onClick }: { target: string; active: boolean; icon: typeof ShoppingCart; eyebrow: string; title: string; body: string; onClick: () => void }) {
  return <button type="button" data-tutorial={target} onClick={onClick} className={["min-h-48 rounded-2xl border bg-white p-5 text-start shadow-sm transition", active ? "relative z-10 border-[#df9d00] ring-4 ring-[#ffd447]" : "border-[var(--line)] opacity-70"].join(" ")}><Icon className="h-8 w-8 text-[var(--brand)]" /><span className="mt-4 block text-xs font-bold uppercase tracking-[.1em] text-[var(--brand)]">{eyebrow}</span><span className="mt-1 block font-display text-2xl font-semibold">{title}</span><span className="mt-2 block text-sm leading-6 text-[var(--muted)]">{body}</span></button>;
}

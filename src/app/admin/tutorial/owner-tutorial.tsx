"use client";

import Link from "next/link";
import { Archive, ArrowRight, Check, CheckCircle2, PackageCheck, PoundSterling, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { OWNER_TUTORIAL_STORAGE_KEY } from "@/lib/operator/tutorial/route-guard";

const STORAGE_KEY = OWNER_TUTORIAL_STORAGE_KEY;
const TOTAL_STEPS = 10;

const STEPS = [
  { target: "owner-today", title: "Start with Today", instruction: "Tap the highlighted button. Today shows only the decisions that need you now." },
  { target: "owner-stock", title: "Open the first priority", instruction: "Tap the highlighted stock issue. A priority always opens a short decision page first." },
  { target: "owner-stock-why", title: "Ask why", instruction: "Tap Why? to reveal PTM's evidence. Details stay hidden until you ask for them." },
  { target: "owner-stock-count", title: "Choose the safest action", instruction: "PTM is uncertain about the quantity. Choose what Dad should do next." },
  { target: null, title: "Stock check handed off", instruction: "Counting first creates fresh evidence. PTM would then return you to Today for the next decision." },
  { target: "owner-money", title: "Open the till decision", instruction: "Tap the £18 till difference. PTM shows what it knows without pretending to know the cause." },
  { target: "owner-money-investigate", title: "Choose the money action", instruction: "Expected and counted cash differ. Choose the next safe step." },
  { target: null, title: "Till check handed off", instruction: "Checking the till preserves the evidence. A difference is not automatically profit, loss or theft." },
  { target: "owner-later", title: "Open Later deliberately", instruction: "Tap Later. PTM keeps lower-priority work out of the way until you choose to see it." },
  { target: "owner-later-defer", title: "Defer without losing the work", instruction: "Move the practice item to Later. It remains available but stops competing with today's decisions." },
] as const;

export function OwnerTutorial() {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const active = STEPS[step];

  useEffect(() => {
    const stored = Number(sessionStorage.getItem(STORAGE_KEY) ?? "0");
    setStep(Number.isFinite(stored) ? Math.min(Math.max(stored, 0), TOTAL_STEPS) : 0);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !active?.target) return;
    const timeout = window.setTimeout(() => {
      document.querySelector(`[data-tutorial="${active.target}"]`)?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }, 100);
    return () => window.clearTimeout(timeout);
  }, [active, ready]);

  const advance = (next: number) => {
    const bounded = Math.min(Math.max(next, 0), TOTAL_STEPS);
    setFeedback(null);
    setStep(bounded);
    sessionStorage.setItem(STORAGE_KEY, String(bounded));
  };
  const restart = () => advance(0);
  const exit = () => sessionStorage.removeItem(STORAGE_KEY);
  const chapter = useMemo(() => step < 1 ? 0 : step < 5 ? 1 : step < 8 ? 2 : 3, [step]);

  if (!ready) return null;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-28 pt-6 sm:px-6" data-testid="owner-tutorial" data-owner-execution-mode="dry-run">
      <header className="rounded-2xl border-2 border-[#df9d00] bg-[#fff9e5] px-5 py-5 sm:px-6">
        <p className="text-xs font-black uppercase tracking-[.12em] text-[#694d00]">Owner practice · about 4 minutes · no real records</p>
        <h1 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">Learn one simple loop</h1>
        <p className="mt-2 max-w-3xl text-[#645644]">Today → tap a priority → understand it → take PTM&apos;s recommended action → return to Today.</p>
      </header>

      {active && (
        <section className="mt-5 rounded-2xl border border-[#cfc2af] bg-white p-5 shadow-sm" data-testid="owner-training-panel" aria-live="polite">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="rounded-full bg-[#fff2bf] px-3 py-1 text-xs font-black text-[#694d00]">Step {step + 1} of {TOTAL_STEPS}</span>
              <h2 className="mt-3 font-display text-2xl font-semibold">{active.title}</h2>
            </div>
            <Link href="/admin/today" onClick={exit} aria-label="Exit Owner Tutorial" className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-[#f4efe7]"><X className="h-5 w-5" /></Link>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2" aria-label={`Part ${chapter + 1} of 4`}>
            {["Today", "Stock", "Money", "Later"].map((label, index) => (
              <span key={label} className={["rounded-full px-2 py-1 text-center text-xs font-bold", index < chapter ? "bg-[#e5f5eb] text-[#0f6240]" : index === chapter ? "bg-[#ffd447] text-[#4f3700]" : "bg-[#eee9e1] text-[#746b62]"].join(" ")}>
                {index < chapter ? <><Check className="mr-1 inline h-3 w-3" />{label}</> : label}
              </span>
            ))}
          </div>
          <p className="mt-4 text-lg leading-7 text-[#4e463f]">{active.instruction}</p>
          <p className="mt-3 rounded-xl bg-[#fff7d6] px-3 py-2 text-sm font-bold text-[#5d4300]">
            {active.target ? "Your turn: tap the one yellow-highlighted control below." : "Read this, then tap Next."}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={() => advance(step - 1)} disabled={step === 0} className="min-h-11 rounded-lg px-3 py-2 font-semibold disabled:opacity-40">Back</button>
            <button type="button" onClick={restart} aria-label="Restart Owner Tutorial" className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-[#f4efe7]"><RotateCcw className="h-5 w-5" /></button>
            {!active.target && <button type="button" onClick={() => advance(step + 1)} className="ml-auto inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--brand)] px-5 font-bold text-white">Next <ArrowRight className="h-4 w-4" /></button>}
          </div>
        </section>
      )}

      <div className="mt-5 grid gap-4">
        <TrainingCard active={step === 0} icon={<CheckCircle2 />} eyebrow="TODAY" title="Do now — 3 things" body="PTM has already ranked the shop's work. You start with the short list, not the whole system.">
          {step === 0 && <Action target="owner-today" onClick={() => advance(1)}>Open Today practice</Action>}
        </TrainingCard>

        <TrainingCard active={step >= 1 && step <= 4} icon={<PackageCheck />} eyebrow={step === 1 ? "DO NOW · 1" : "STOCK DECISION"} title="Chicken Breast may be low" body={step === 1 ? "About £40 of stock may be wrong." : "PTM thinks the stock quantity may be wrong."}>
          {step === 1 && <Action target="owner-stock" onClick={() => advance(2)}>Open stock decision</Action>}
          {step === 2 && (
            <DecisionLayout impact="About £40 may be affected" recommendation="Count the stock.">
              <Action target="owner-stock-why" onClick={() => advance(3)} secondary>Why?</Action>
            </DecisionLayout>
          )}
          {step === 3 && (
            <DecisionLayout impact="About £40 may be affected" recommendation="Count the stock." why="The last physical count was four days ago and recent waste is unknown.">
              <DecisionGroup label="What should Dad do?" feedback={feedback}>
                <Decision target="owner-stock-count" tone="safe" onClick={() => advance(4)}>Start stock count</Decision>
                <Decision onClick={() => setFeedback("PTM is not confident enough to order 12 kg. Count first.")}>Order 12 kg now</Decision>
              </DecisionGroup>
            </DecisionLayout>
          )}
          {step === 4 && <Success>Stock count started in practice. The real flow would return you to Today when the hand-off is complete.</Success>}
        </TrainingCard>

        <TrainingCard active={step >= 5 && step <= 7} icon={<PoundSterling />} eyebrow="MONEY DECISION" title="Till needs checking" body="The till is £18 higher than PTM expected.">
          {step === 5 && <Action target="owner-money" onClick={() => advance(6)}>Open till decision</Action>}
          {step === 6 && (
            <DecisionLayout impact="Expected £412 · counted £430" recommendation="Check the till." why="PTM knows the amounts differ. It does not know the cause.">
              <DecisionGroup label="What should Dad do?" feedback={feedback}>
                <Decision target="owner-money-investigate" tone="safe" onClick={() => advance(7)}>Check till</Decision>
                <Decision onClick={() => setFeedback("PTM has no evidence that the £18 is profit. Check the till first.")}>Record £18 as profit</Decision>
              </DecisionGroup>
            </DecisionLayout>
          )}
          {step === 7 && <Success>Till review started in practice. The difference remains open until someone explains and resolves it.</Success>}
        </TrainingCard>

        <TrainingCard active={step >= 8 && step <= 9} icon={<Archive />} eyebrow="OWNER BRAIN" title="Later — 7" body="Lower-priority work stays collapsed. It is not lost, and its full backlog does not compete with Do now.">
          {step === 8 && <Action target="owner-later" onClick={() => advance(9)} secondary>Open Later</Action>}
          {step === 9 && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--cream)]/40 p-4">
              <p className="font-bold">Review product prices</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Useful this week, but no loss needs preventing today.</p>
              <div className="mt-3 grid gap-2">
                <Decision target="owner-later-defer" tone="safe" onClick={() => advance(10)}>Keep in Later</Decision>
                <Decision onClick={() => setFeedback("Moving everything into Do now defeats PTM's prioritisation. Keep this item in Later.")}>Move everything to Do now</Decision>
              </div>
              {feedback && <Feedback>{feedback}</Feedback>}
            </div>
          )}
        </TrainingCard>
      </div>

      {step >= TOTAL_STEPS && (
        <section className="mt-6 rounded-2xl border border-[#9ccfb0] bg-[#f2fbf5] p-6" data-testid="owner-tutorial-complete">
          <ShieldCheck className="h-11 w-11 text-[var(--brand)]" />
          <h2 className="mt-3 font-display text-3xl font-semibold">Owner practice complete</h2>
          <p className="mt-2 max-w-2xl text-lg text-[var(--muted)]">You used the same loop for stock and money, then kept lower-priority work in Later. No real shop records changed.</p>
          <ul className="mt-4 grid gap-2 text-sm font-semibold text-[#0f5132]"><li>✓ Open one priority</li><li>✓ Read the problem, impact and recommendation</li><li>✓ Ask Why? only when you need evidence</li><li>✓ Act or keep lower-priority work in Later</li></ul>
          <div className="mt-5 flex flex-wrap gap-3"><Link href="/admin/today" onClick={exit} className="rounded-lg bg-[var(--brand)] px-4 py-3 font-semibold text-white">Open Today</Link><button type="button" onClick={restart} className="rounded-lg border border-[var(--line)] bg-white px-4 py-3 font-semibold">Practise again</button></div>
        </section>
      )}
    </main>
  );
}

function TrainingCard({ active, icon, eyebrow, title, body, children }: { active: boolean; icon: ReactNode; eyebrow: string; title: string; body: string; children?: ReactNode }) {
  return <section className={["rounded-2xl border bg-white p-5 shadow-sm transition", active ? "border-[#df9d00] ring-4 ring-[#ffd447]" : "border-[var(--line)]"].join(" ")}><div className="h-8 w-8 text-[var(--brand)] [&>svg]:h-8 [&>svg]:w-8">{icon}</div><p className="mt-4 text-xs font-bold uppercase tracking-[.1em] text-[var(--brand)]">{eyebrow}</p><h3 className="mt-1 font-display text-2xl font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p>{children && <div className="mt-4">{children}</div>}</section>;
}

function DecisionLayout({ impact, recommendation, why, children }: { impact: string; recommendation: string; why?: string; children: ReactNode }) {
  return <div className="grid gap-3"><p className="text-lg font-black text-[#8b5e00]">{impact}</p>{why && <p className="rounded-xl bg-[#fbfaf7] p-3 text-sm font-semibold leading-6 text-[#4e463f]"><span className="block text-xs font-black uppercase tracking-[.08em] text-[#6c5e52]">Why?</span>{why}</p>}<div className="rounded-xl bg-[#eff9f3] p-3"><p className="text-xs font-black uppercase tracking-[.08em] text-[#0f6240]">PTM recommends</p><p className="mt-1 font-bold text-[#173e2a]">{recommendation}</p></div>{children}</div>;
}

function Action({ target, onClick, secondary = false, children }: { target: string; onClick: () => void; secondary?: boolean; children: ReactNode }) {
  return <button type="button" data-tutorial={target} onClick={onClick} className={["inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 font-bold ring-4 ring-[#ffd447]", secondary ? "border border-[var(--line)] bg-white text-[var(--brand)]" : "bg-[var(--brand)] text-white"].join(" ")}>{children}<ArrowRight className="h-4 w-4" /></button>;
}

function DecisionGroup({ label, feedback, children }: { label: string; feedback: string | null; children: ReactNode }) {
  return <div><p className="mb-2 font-black text-[#332c27]">{label}</p>{feedback && <Feedback>{feedback}</Feedback>}<div className="grid gap-2">{children}</div></div>;
}

function Decision({ target, tone, onClick, children }: { target?: string; tone?: "safe"; onClick: () => void; children: ReactNode }) {
  return <button type="button" data-tutorial={target} onClick={onClick} className={["min-h-12 rounded-xl border px-4 text-left font-bold", tone === "safe" ? "border-[#0f6240] bg-[#eff9f3] text-[#0f5132] ring-4 ring-[#ffd447]" : "border-[#d8cfc2] bg-white text-[#4e463f] hover:bg-[#f8f5f0]"].join(" ")}>{children}</button>;
}

function Feedback({ children }: { children: ReactNode }) {
  return <p role="alert" data-testid="owner-decision-feedback" className="mb-3 rounded-xl border border-[#e7a2a0] bg-[#fff1f1] p-3 text-sm font-semibold text-[#7a1b1b]">Not yet. Nothing changed. {children}</p>;
}

function Success({ children }: { children: ReactNode }) {
  return <p className="flex gap-2 rounded-xl bg-[#eaf7ef] p-4 font-semibold text-[#0f5132]"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />{children}</p>;
}

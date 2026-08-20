"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { GraduationCap } from "lucide-react";

import { TutorialOverlay } from "@/components/operator/tutorial-overlay";
import { useOperatorI18n } from "@/lib/operator/i18n/context";
import { advanceInstruction, changeSessionLocale, createDryRunSession, DRY_RUN_STORAGE_KEY, goBack, handleTutorialEvent, restartSession, restoreSession, serializeSession } from "./engine";
import { completeShopDaySteps } from "./scenario";
import type { DryRunSession, TutorialEvent } from "./types";

type DryRunContextValue = {
  active: boolean;
  session: DryRunSession | null;
  start: () => void;
  exit: () => void;
  emit: (name: string, value?: TutorialEvent["value"], id?: string) => boolean;
};

const DryRunContext = createContext<DryRunContextValue>({ active: false, session: null, start: () => undefined, exit: () => undefined, emit: () => false });

export function OperatorDryRunProvider({ children }: { children: ReactNode }) {
  const { locale, t } = useOperatorI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<DryRunSession | null>(null);
  const sessionRef = useRef<DryRunSession | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const commitSession = useCallback((next: DryRunSession | null) => {
    sessionRef.current = next;
    setSession(next);
    if (next) sessionStorage.setItem(DRY_RUN_STORAGE_KEY, serializeSession(next));
    else sessionStorage.removeItem(DRY_RUN_STORAGE_KEY);
  }, []);

  useEffect(() => {
    const restored = restoreSession(sessionStorage.getItem(DRY_RUN_STORAGE_KEY));
    if (restored) { sessionRef.current = restored; setSession(restored); }
    else sessionStorage.removeItem(DRY_RUN_STORAGE_KEY);
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    if (session) sessionStorage.setItem(DRY_RUN_STORAGE_KEY, serializeSession(session));
    else sessionStorage.removeItem(DRY_RUN_STORAGE_KEY);
  }, [hydrated, session]);
  useEffect(() => {
    const current = sessionRef.current;
    if (current && current.locale !== locale) commitSession(changeSessionLocale(current, locale));
  }, [commitSession, locale]);

  const step = session?.status === "active" ? completeShopDaySteps[session.currentStep] : null;
  useEffect(() => {
    if (!step || pathname === step.route) return;
    router.replace(step.route);
  }, [pathname, router, step]);
  useEffect(() => {
    if (!step) return;
    const containHistory = () => { if (window.location.pathname !== step.route) router.replace(step.route); };
    window.addEventListener("popstate", containHistory);
    return () => window.removeEventListener("popstate", containHistory);
  }, [router, step]);

  const exit = useCallback(() => {
    const current = sessionRef.current;
    if (current?.status === "active" && !window.confirm(t("dryRun.exitConfirm"))) return;
    commitSession(null);
    router.replace("/operator");
  }, [commitSession, router, t]);
  const emit = useCallback((name: string, value?: TutorialEvent["value"], id = crypto.randomUUID()) => {
    const current = sessionRef.current;
    if (!current) return false;
    const next = handleTutorialEvent(current, { id, name, value });
    if (next === current) return false;
    // Persist before navigation. The root route guard reads sessionStorage on
    // the next pathname; writing later in an effect creates a real race where
    // a slower human can be redirected back to the previous step.
    commitSession(next);
    const nextStep = next.status === "active" ? completeShopDaySteps[next.currentStep] : null;
    if (nextStep && window.location.pathname !== nextStep.route) {
      window.setTimeout(() => router.replace(nextStep.route), 0);
    }
    return true;
  }, [commitSession, router]);
  useEffect(() => {
    if (!session || session.status !== "active") return;
    const clickEvents: Record<string, [string, TutorialEvent["value"]?]> = {
      "nav-open": ["operator.open.selected"],
      "open-checklist": ["operator.open.checklist_confirmed"],
      "open-confirm": ["operator.shop.opened"],
      "nav-serve": ["operator.serve.selected"],
      "serve-product-chicken": ["operator.serve.product_added", "chicken"],
      "serve-weight": ["operator.serve.weight_entered", "2"],
      "serve-payment-cash": ["operator.serve.cash_selected"],
      "serve-confirm": ["operator.serve.confirmed"],
      "nav-stock": ["operator.stock.selected"],
      "stock-received": ["operator.stock.delivery_selected"],
      "stock-product-lamb": ["operator.stock.product_selected", "lamb"],
      "stock-expiry": ["operator.stock.expiry_entered", "2026-08-23"],
      "stock-evidence": ["operator.stock.evidence_simulated"],
      "stock-confirm": ["operator.stock.delivery_confirmed"],
      "nav-waste": ["operator.waste.selected"],
      "waste-product-chicken": ["operator.waste.product_selected", "chicken"],
      "waste-reason": ["operator.waste.reason_selected", "damaged"],
      "waste-confirm": ["operator.waste.confirmed"],
      "nav-till": ["operator.till.selected"],
      "till-confirm": ["operator.till.count_confirmed"],
      "nav-help": ["operator.help.opened"],
      "nav-close": ["operator.close.selected"],
      "close-checklist": ["operator.close.checklist_confirmed"],
      "close-confirm": ["operator.shop.closed"],
    };
    const inputEvents: Record<string, string> = {
      "open-temperature": "operator.temperature.entered",
      "open-float": "operator.till.float_entered",
      "stock-weight": "operator.stock.weight_entered",
      "waste-weight": "operator.waste.weight_entered",
      "till-count": "operator.till.count_entered",
      "close-temperature": "operator.close.temperature_entered",
      "close-till": "operator.close.till_entered",
    };
    const onClick = (event: Event) => {
      const element = (event.target as Element | null)?.closest<HTMLElement>("[data-tutorial]");
      const key = element?.dataset.tutorial;
      if (!key || !clickEvents[key]) return;
      const [name, value] = clickEvents[key];
      emit(name, value);
    };
    const onInput = (event: Event) => {
      const element = (event.target as HTMLInputElement | null)?.closest<HTMLInputElement>("[data-tutorial]");
      const key = element?.dataset.tutorial;
      if (!key || !inputEvents[key]) return;
      emit(inputEvents[key], element.value);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("change", onInput, true);
    };
  }, [emit, session]);
  const transition = useCallback((change: (current: DryRunSession) => DryRunSession) => {
    const current = sessionRef.current;
    if (!current) return;
    const next = change(current);
    commitSession(next);
    const nextStep = next.status === "active" ? completeShopDaySteps[next.currentStep] : null;
    if (nextStep && window.location.pathname !== nextStep.route) router.replace(nextStep.route);
  }, [commitSession, router]);
  const value = useMemo<DryRunContextValue>(() => ({ active: session?.status === "active", session, start: () => commitSession(createDryRunSession(locale)), exit, emit }), [commitSession, emit, exit, locale, session]);

  return <DryRunContext.Provider value={value}>
    {session ? <div className="sticky top-0 z-[900] flex min-h-10 items-center justify-center border-b-2 border-[#6b4900] bg-[#ffd447] px-4 py-2 text-center text-sm font-black tracking-wide text-[#352500]" data-testid="dry-run-banner"><GraduationCap className="mx-2 h-5 w-5 shrink-0" aria-hidden />{t("dryRun.banner")}</div> : null}
    {children}
    {session?.status === "active" && step ? <TutorialOverlay session={session} step={step} total={completeShopDaySteps.length} onBack={() => transition(goBack)} onNext={() => transition(advanceInstruction)} onExit={exit} onRestart={() => { if (window.confirm(t("dryRun.restartConfirm"))) transition(restartSession); }} onRecover={() => { transition(restartSession); router.replace("/operator"); }} /> : null}
    {session?.status === "completed" ? <div className="fixed inset-0 z-[1000] grid place-items-center bg-[#07150f]/75 p-4" data-testid="dry-run-complete"><section role="dialog" className="w-full max-w-lg rounded-2xl bg-white p-7 text-center shadow-2xl"><GraduationCap className="mx-auto h-14 w-14 text-[var(--brand)]" aria-hidden /><h2 className="mt-4 font-display text-3xl font-semibold">{t("dryRun.completeTitle")}</h2><p className="mt-2 text-lg text-[var(--muted)]">{t("dryRun.completeBody")}</p><button type="button" onClick={exit} className="mt-6 min-h-14 w-full rounded-xl bg-[var(--brand)] px-5 text-lg font-semibold text-white">{t("dryRun.returnHome")}</button></section></div> : null}
  </DryRunContext.Provider>;
}

export function useOperatorDryRun() { return useContext(DryRunContext); }

export function StartDryRunCard() {
  const { start } = useOperatorDryRun();
  const { t } = useOperatorI18n();
  return <section className="mt-4 rounded-2xl border-2 border-[#df9d00] bg-[#fff9e5] p-5 shadow-sm" data-testid="dry-run-entry">
    <div className="flex items-start gap-3"><GraduationCap className="mt-1 h-8 w-8 shrink-0 text-[#8a5d00]" aria-hidden /><div><h2 className="font-display text-2xl font-semibold">{t("dryRun.start")}</h2><p className="mt-1 text-base text-[#645644]">{t("dryRun.startHint")}</p></div></div>
    <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-sm font-semibold text-[#694d00]">{t("dryRun.startTime")}</p>
    <button type="button" onClick={start} className="mt-4 min-h-14 w-full rounded-xl bg-[#8a5d00] px-5 text-lg font-semibold text-white hover:bg-[#674600]">{t("dryRun.start")}</button>
  </section>;
}

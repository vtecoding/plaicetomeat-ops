"use client";

import { ArrowLeft, ArrowRight, Check, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useOperatorI18n } from "@/lib/operator/i18n/context";
import { completeShopDayChapters, tutorialChapterProgress } from "@/lib/operator/tutorial/scenario";
import type { DryRunSession, TutorialStep } from "@/lib/operator/tutorial/types";

type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };
type Size = { width: number; height: number };

export function TutorialOverlay({ session, step, total, onBack, onNext, onExit, onRestart, onRecover }: {
  session: DryRunSession;
  step: TutorialStep;
  total: number;
  onBack: () => void;
  onNext: () => void;
  onExit: () => void;
  onRestart: () => void;
  onRecover: () => void;
}) {
  const { dir, t } = useOperatorI18n();
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [bubbleSize, setBubbleSize] = useState<Size>({ width: 340, height: 280 });
  const bubbleRef = useRef<HTMLElement | null>(null);
  const rtl = dir === "rtl";
  const targetSelector = step.target ? `[data-tutorial="${step.target}"]` : null;

  useLayoutEffect(() => {
    setRect(null);
    setMissing(false);
    if (!targetSelector) return;
    let target: HTMLElement | null = null;
    let targetObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let poll = 0;
    let timeout = 0;
    let previous: Partial<CSSStyleDeclaration> = {};
    const position = () => {
      if (!target?.isConnected) return;
      const next = target.getBoundingClientRect();
      setRect({ top: next.top, left: next.left, right: next.right, bottom: next.bottom, width: next.width, height: next.height });
    };
    const detach = () => {
      targetObserver?.disconnect();
      targetObserver = null;
      if (target) {
        target.style.position = previous.position ?? "";
        target.style.zIndex = previous.zIndex ?? "";
        target.style.boxShadow = previous.boxShadow ?? "";
        target.style.borderRadius = previous.borderRadius ?? "";
        target.removeAttribute("aria-describedby");
      }
      target = null;
      previous = {};
    };
    const attach = (candidate: HTMLElement) => {
      if (candidate === target) { position(); return; }
      detach();
      target = candidate;
      previous.position = target.style.position;
      previous.zIndex = target.style.zIndex;
      previous.boxShadow = target.style.boxShadow;
      previous.borderRadius = target.style.borderRadius;
      target.style.position = target.style.position || "relative";
      target.style.zIndex = "1002";
      target.style.boxShadow = "0 0 0 4px #fbbf24, 0 0 0 9px rgba(251,191,36,.35)";
      target.style.borderRadius = target.style.borderRadius || "8px";
      target.setAttribute("aria-describedby", "dry-run-instruction");
      // A phone cannot place a tall instruction card beside a tall action card.
      // Aligning the action near the top reserves a stable, non-overlapping
      // instruction area below it; wider screens can keep the target centred.
      // When a last-page target cannot scroll that high, the placement solver
      // naturally uses the available space above it instead.
      target.scrollIntoView({ block: window.innerWidth < 640 ? "start" : "center", inline: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      position();
      targetObserver = new ResizeObserver(position);
      targetObserver.observe(target);
      window.setTimeout(() => target?.focus({ preventScroll: true }), 100);
      setMissing(false);
    };
    const scan = () => {
      const candidate = document.querySelector<HTMLElement>(targetSelector);
      if (candidate) attach(candidate);
      else if (target && !target.isConnected) { detach(); setRect(null); }
    };
    scan();
    mutationObserver = new MutationObserver(scan);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    poll = window.setInterval(scan, 250);
    timeout = window.setTimeout(() => {
      if (!document.querySelector(targetSelector)) {
        setMissing(true);
        if (process.env.NODE_ENV !== "production") console.error(`Tutorial target not found after navigation settled: ${step.target}\nstep: ${step.id}`);
      }
    }, 15_000);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      mutationObserver?.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      detach();
    };
  }, [retryToken, step.id, step.target, targetSelector]);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!bubble) return;
    const measure = () => setBubbleSize({ width: bubble.offsetWidth, height: bubble.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bubble);
    return () => observer.disconnect();
  }, [missing, step.id]);

  useEffect(() => {
    const allowed = (element: Element | null) => {
      const expected = targetSelector ? document.querySelector(targetSelector) : null;
      return Boolean(
        element?.closest("[data-tutorial-control], [data-testid=operator-language-control], [data-testid=operator-script-style-control]") ||
        (expected && (element === expected || expected.contains(element))),
      );
    };
    const containInteraction = (event: Event) => {
      if (allowed(event.target as Element | null)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const containKey = (event: KeyboardEvent) => {
      if (!(["Enter", " "].includes(event.key)) || allowed(event.target as Element | null)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("click", containInteraction, true);
    document.addEventListener("submit", containInteraction, true);
    document.addEventListener("keydown", containKey, true);
    return () => {
      document.removeEventListener("click", containInteraction, true);
      document.removeEventListener("submit", containInteraction, true);
      document.removeEventListener("keydown", containKey, true);
    };
  }, [targetSelector]);

  const bubbleStyle = useMemo(() => typeof window === "undefined" ? {} : getBubbleStyle(rect, step.placement ?? "bottom", rtl, bubbleSize), [bubbleSize, rect, rtl, step.placement]);
  const dimmers = rect ? getDimmers(rect) : [{ top: 0, left: 0, width: "100vw", height: "100vh" }];
  const progress = Math.round(((session.currentStep + 1) / total) * 100);
  const chapterProgress = tutorialChapterProgress(session.currentStep);
  const findingTarget = Boolean(targetSelector && !rect && !missing);
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[1000]" data-testid="tutorial-overlay">
      {dimmers.map((style, index) => <div key={index} className="pointer-events-none fixed bg-[#07150f]/72 backdrop-blur-[1px]" style={style} aria-hidden />)}
      <section ref={bubbleRef} data-tutorial-control role="dialog" aria-modal="false" aria-live="polite" aria-label={t(step.titleKey)} className="pointer-events-auto fixed z-[1004] max-h-[calc(100vh-24px)] w-[min(380px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-[#d6c9b6] bg-white p-5 text-[#231f20] shadow-2xl" style={bubbleStyle}>
        {missing ? <>
          <h2 className="text-lg font-black">{t("dryRun.recoverTitle")}</h2>
          <p className="mt-1 text-sm text-[#5c5148]">{t("dryRun.recoverBody")}</p>
          <div className="mt-4 grid gap-2">
            <Button className="min-h-12 w-full" onClick={() => { setMissing(false); setRetryToken((value) => value + 1); }}>{t("dryRun.tryAgain")}</Button>
            <Button variant="outline" className="min-h-12 w-full" onClick={onRecover}>{t("dryRun.restart")}</Button>
          </div>
        </> : <>
          <div className="flex items-center justify-between gap-3">
            <div><span className="block text-[11px] font-black uppercase tracking-[.12em] text-[#694d00]">{t("dryRun.chapter", { current: chapterProgress.chapterIndex + 1, total: completeShopDayChapters.length })}</span><span className="mt-0.5 block text-sm font-black text-[#352500]">{t(chapterProgress.chapter.titleKey)}</span></div>
            <button data-tutorial-control type="button" onClick={onExit} className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-[#f4efe7]" aria-label={t("dryRun.exit")}><X className="h-5 w-5" aria-hidden /></button>
          </div>
          <div role="progressbar" aria-label={t("dryRun.progressLabel")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-3 h-2 overflow-hidden rounded-full bg-[#eee5d8]"><div className="h-full rounded-full bg-[#df9d00] transition-[width] duration-300" style={{ width: `${progress}%` }} /></div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-bold text-[#694d00]"><span>{t("dryRun.chapterStep", { current: chapterProgress.stepInChapter, total: chapterProgress.stepsInChapter })}</span><span>{t("dryRun.step", { current: session.currentStep + 1, total })}</span></div>
          <div className="mt-2 grid grid-cols-5 gap-1.5" data-testid="dry-run-chapter-progress" aria-label={t("dryRun.chapter", { current: chapterProgress.chapterIndex + 1, total: completeShopDayChapters.length })}>{completeShopDayChapters.map((chapter, index) => <span key={chapter.id} title={t(chapter.titleKey)} className={["grid h-5 place-items-center rounded-full text-[10px] font-black", index < chapterProgress.chapterIndex ? "bg-[#0f6240] text-white" : index === chapterProgress.chapterIndex ? "bg-[#ffd447] text-[#352500] ring-2 ring-[#df9d00]" : "bg-[#eee5d8] text-[#71685e]"].join(" ")}>{index < chapterProgress.chapterIndex ? <Check className="h-3 w-3" aria-hidden /> : index + 1}</span>)}</div>
          <h2 className="mt-3 text-xl font-black">{t(step.titleKey)}</h2>
          <p id="dry-run-instruction" className="mt-1 text-[17px] font-medium leading-relaxed text-[#3f3934]">{t(step.instructionKey)}</p>
          <div className={["mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm leading-snug", step.feedbackKey ? "border border-[#e69a98] bg-[#fff1f1] text-[#7a1b1b]" : "bg-[#fff7d6] text-[#5d4300]"].join(" ")}>
            {findingTarget ? <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden /> : <span className="mt-0.5 block h-2.5 w-2.5 shrink-0 rounded-full bg-[#df9d00]" aria-hidden />}
            <span><strong className="block">{step.feedbackKey ? t("dryRun.safeStop") : step.requiredEvent ? t("dryRun.yourTurn") : t("dryRun.practiceLabel")}</strong>{findingTarget ? t("dryRun.loadingStep") : step.feedbackKey ? t(step.feedbackKey) : step.requiredEvent ? t("dryRun.noRush") : t("dryRun.readAndContinue")}</span>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button data-tutorial-control variant="ghost" className="min-h-11" onClick={onBack} disabled={session.currentStep === 0}>{rtl ? <ArrowRight className="h-4 w-4" aria-hidden /> : <ArrowLeft className="h-4 w-4" aria-hidden />}{t("dryRun.back")}</Button>
              <Button data-tutorial-control variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={onRestart} aria-label={t("dryRun.restart")}><RotateCcw className="h-4 w-4" aria-hidden /></Button>
            </div>
            {!step.requiredEvent && <Button data-tutorial-control className="min-h-11 px-5" onClick={onNext}>{step.id === "complete" ? t("dryRun.finish") : t("dryRun.next")}{rtl ? <ArrowLeft className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}</Button>}
          </div>
        </>}
      </section>
    </div>, document.body,
  );
}

function getDimmers(rect: Rect): React.CSSProperties[] {
  const pad = 8;
  const top = Math.max(0, rect.top - pad);
  const left = Math.max(0, rect.left - pad);
  const right = Math.min(window.innerWidth, rect.right + pad);
  const bottom = Math.min(window.innerHeight, rect.bottom + pad);
  return [{ top: 0, left: 0, right: 0, height: top }, { top: bottom, left: 0, right: 0, bottom: 0 }, { top, left: 0, width: left, height: Math.max(0, bottom - top) }, { top, left: right, right: 0, height: Math.max(0, bottom - top) }];
}

function getBubbleStyle(rect: Rect | null, placement: TutorialStep["placement"], rtl: boolean, measured: Size): React.CSSProperties {
  const width = Math.min(Math.max(measured.width, 340), window.innerWidth - 24);
  const height = Math.min(Math.max(measured.height, 260), window.innerHeight - 24);
  if (!rect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  const edge = 12;
  const gap = 18;
  const clamp = (value: number, maximum: number) => Math.max(edge, Math.min(value, maximum));
  const intersects = (candidate: { top: number; left: number }) => candidate.left < rect.right + gap && candidate.left + width > rect.left - gap && candidate.top < rect.bottom + gap && candidate.top + height > rect.top - gap;
  const opposite: Record<NonNullable<TutorialStep["placement"]>, NonNullable<TutorialStep["placement"]>> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const horizontal: NonNullable<TutorialStep["placement"]>[] = rtl ? ["right", "left"] : ["left", "right"];
  const vertical: NonNullable<TutorialStep["placement"]>[] = ["bottom", "top"];
  const order = [...new Set([placement ?? "bottom", opposite[placement ?? "bottom"], ...vertical, ...horizontal])] as NonNullable<TutorialStep["placement"]>[];
  const candidate = (side: NonNullable<TutorialStep["placement"]>) => {
    if (side === "top") return { top: rect.top - height - gap, left: clamp(rtl ? rect.right - width : rect.left, window.innerWidth - width - edge) };
    if (side === "bottom") return { top: rect.bottom + gap, left: clamp(rtl ? rect.right - width : rect.left, window.innerWidth - width - edge) };
    if (side === "left") return { top: clamp(rect.top, window.innerHeight - height - edge), left: rect.left - width - gap };
    return { top: clamp(rect.top, window.innerHeight - height - edge), left: rect.right + gap };
  };
  for (const side of order) {
    const next = candidate(side);
    if (next.top >= edge && next.left >= edge && next.top + height <= window.innerHeight - edge && next.left + width <= window.innerWidth - edge && !intersects(next)) return next;
  }
  // No full-size candidate fits. Dock into the larger safe vertical region and
  // constrain the dialog to that region; its existing overflow-y-auto keeps every
  // instruction/control reachable without ever covering the highlighted target.
  const above = Math.max(0, rect.top - gap - edge);
  const below = Math.max(0, window.innerHeight - rect.bottom - gap - edge);
  if (below >= above) return { top: rect.bottom + gap, left: edge, right: edge, maxHeight: below };
  return { top: edge, left: edge, right: edge, maxHeight: above };
}

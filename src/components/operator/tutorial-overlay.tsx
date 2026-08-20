"use client";

import { ArrowLeft, ArrowRight, RotateCcw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useOperatorI18n } from "@/lib/operator/i18n/context";
import type { DryRunSession, TutorialStep } from "@/lib/operator/tutorial/types";

type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

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
  const rtl = dir === "rtl";
  const targetSelector = step.target ? `[data-tutorial="${step.target}"]` : null;

  useLayoutEffect(() => {
    setRect(null);
    setMissing(false);
    if (!targetSelector) return;
    let target: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let timeout = 0;
    const previous: Partial<CSSStyleDeclaration> = {};
    const position = () => {
      if (!target?.isConnected) return;
      const next = target.getBoundingClientRect();
      setRect({ top: next.top, left: next.left, right: next.right, bottom: next.bottom, width: next.width, height: next.height });
    };
    const attach = () => {
      target = document.querySelector<HTMLElement>(targetSelector);
      if (!target) return false;
      previous.position = target.style.position;
      previous.zIndex = target.style.zIndex;
      previous.boxShadow = target.style.boxShadow;
      previous.borderRadius = target.style.borderRadius;
      target.style.position = target.style.position || "relative";
      target.style.zIndex = "1002";
      target.style.boxShadow = "0 0 0 4px #fbbf24, 0 0 0 9px rgba(251,191,36,.35)";
      target.style.borderRadius = target.style.borderRadius || "8px";
      target.setAttribute("aria-describedby", "dry-run-instruction");
      target.scrollIntoView({ block: "center", inline: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      position();
      resizeObserver = new ResizeObserver(position);
      resizeObserver.observe(target);
      window.addEventListener("resize", position);
      window.addEventListener("scroll", position, true);
      window.setTimeout(() => target?.focus({ preventScroll: true }), 100);
      return true;
    };
    if (!attach()) {
      mutationObserver = new MutationObserver(() => { if (attach()) mutationObserver?.disconnect(); });
      mutationObserver.observe(document.body, { childList: true, subtree: true });
      timeout = window.setTimeout(() => {
        mutationObserver?.disconnect();
        setMissing(true);
        if (process.env.NODE_ENV !== "production") console.error(`Tutorial target not found: ${step.target}\nstep: ${step.id}`);
      }, 4000);
    } else {
      mutationObserver = new MutationObserver(() => {
        if (!target?.isConnected) {
          setRect(null);
          setMissing(true);
          if (process.env.NODE_ENV !== "production") console.error(`Tutorial target disappeared: ${step.target}\nstep: ${step.id}`);
        }
      });
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
    return () => {
      window.clearTimeout(timeout);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      if (target) {
        target.style.position = previous.position ?? "";
        target.style.zIndex = previous.zIndex ?? "";
        target.style.boxShadow = previous.boxShadow ?? "";
        target.style.borderRadius = previous.borderRadius ?? "";
        target.removeAttribute("aria-describedby");
      }
    };
  }, [step.id, step.target, targetSelector]);

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

  const bubbleStyle = useMemo(() => getBubbleStyle(rect, step.placement ?? "bottom", rtl), [rect, rtl, step.placement]);
  const dimmers = rect ? getDimmers(rect) : [{ top: 0, left: 0, width: "100vw", height: "100vh" }];
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[1000]" data-testid="tutorial-overlay">
      {dimmers.map((style, index) => <div key={index} className="pointer-events-none fixed bg-[#07150f]/72 backdrop-blur-[1px]" style={style} aria-hidden />)}
      <section data-tutorial-control role="dialog" aria-modal="false" aria-live="polite" aria-label={t(step.titleKey)} className="pointer-events-auto fixed z-[1004] w-[min(340px,calc(100vw-24px))] rounded-2xl border border-[#d6c9b6] bg-white p-4 text-[#231f20] shadow-2xl" style={bubbleStyle}>
        {missing ? <>
          <h2 className="text-lg font-black">{t("dryRun.recoverTitle")}</h2>
          <p className="mt-1 text-sm text-[#5c5148]">{t("dryRun.recoverBody")}</p>
          <Button className="mt-4 w-full" onClick={onRecover}>{t("dryRun.returnHome")}</Button>
        </> : <>
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-full bg-[#fff2bf] px-2.5 py-1 text-xs font-black text-[#694d00]">{t("dryRun.step", { current: session.currentStep + 1, total })}</span>
            <button data-tutorial-control type="button" onClick={onExit} className="rounded-md p-1.5 hover:bg-[#f4efe7]" aria-label={t("dryRun.exit")}><X className="h-5 w-5" aria-hidden /></button>
          </div>
          <h2 className="mt-3 text-xl font-black">{t(step.titleKey)}</h2>
          <p id="dry-run-instruction" className="mt-1 text-base leading-snug text-[#4e463f]">{t(step.instructionKey)}</p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button data-tutorial-control variant="ghost" size="sm" onClick={onBack} disabled={session.currentStep === 0}>{rtl ? <ArrowRight className="h-4 w-4" aria-hidden /> : <ArrowLeft className="h-4 w-4" aria-hidden />}{t("dryRun.back")}</Button>
              <Button data-tutorial-control variant="ghost" size="icon" onClick={onRestart} aria-label={t("dryRun.restart")}><RotateCcw className="h-4 w-4" aria-hidden /></Button>
            </div>
            {!step.requiredEvent && <Button data-tutorial-control size="sm" onClick={onNext}>{step.id === "complete" ? t("dryRun.finish") : t("dryRun.next")}{rtl ? <ArrowLeft className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}</Button>}
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

function getBubbleStyle(rect: Rect | null, placement: TutorialStep["placement"], rtl: boolean): React.CSSProperties {
  const width = Math.min(340, window.innerWidth - 24);
  const height = 250;
  if (!rect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  let top = rect.bottom + 18;
  let left = rtl ? rect.right - width : rect.left;
  if (placement === "top" || top + height > window.innerHeight - 12) top = rect.top - height - 18;
  if (placement === "left") { top = rect.top; left = rect.left - width - 18; }
  if (placement === "right") { top = rect.top; left = rect.right + 18; }
  top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  return { top, left };
}

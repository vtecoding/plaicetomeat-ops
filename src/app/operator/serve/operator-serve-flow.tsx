"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ShoppingBag } from "lucide-react";

import { abandonOperatorDraft } from "@/app/actions/operator/drafts";
import { saveSimpleSale } from "@/app/actions/operator/serve";
import {
  OperatorDraftPrompt,
  OperatorDraftStatus,
  useOperatorDraftSave,
} from "@/app/operator/_components/operator-draft";
import type { UnitType } from "@/lib/domain/types";
import { parseOperatorDraftSteps, type OperatorDraftRecord } from "@/lib/operator/workflows/drafts";
import { useOperatorI18n } from "@/lib/operator/i18n/context";
import { LIVE_EXECUTION_CONTEXT } from "@/lib/operator/execution-context";
import { useOperatorDryRun } from "@/lib/operator/tutorial/context";
import { completeShopDaySteps } from "@/lib/operator/tutorial/scenario";
import { isolateLtr, operatorMoney, type OperatorTranslationKey } from "@/lib/operator/i18n/resources";
import {
  SERVE_AMOUNT_CHOICES,
  SERVE_COUNT_CHOICES,
  type ServeTile,
} from "@/lib/operator/workflows/serve";
import {
  expectedServeLineTotal,
  formatServePresetLabel,
  roundServeMoney,
} from "@/lib/operator/workflows/serve-presentation";

type Line = {
  key: string;
  productId: string | null;
  name: string;
  quantity: number;
  unitType: UnitType;
  label: string;
  priceGbp: number | null;
  unitPriceGbp: number | null;
  displayedTotalGbp: number;
};

type PendingLine = { quantity: number; label: string };
type Mode = "buy" | "other-name" | "amount" | "other-amount" | "price" | "add-more" | "pay" | "confirm" | "done";
type PayKind = "cash" | "card";

const RESUMABLE_MODES: readonly Mode[] = ["buy", "other-name", "amount", "other-amount", "price", "add-more", "pay", "confirm"];
const LAST_SAVED_STEP: Record<Mode, string> = {
  buy: "serve.addMore",
  "other-name": "serve.what",
  amount: "serve.item",
  "other-amount": "serve.amount",
  price: "serve.amount",
  "add-more": "serve.added",
  pay: "serve.addMore",
  confirm: "serve.pay",
  done: "",
};

function newRunId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isUnitType(value: unknown): value is UnitType {
  return value === "kg" || value === "each" || value === "box";
}

function restoreLines(value: unknown): Line[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const quantity = Number(row.quantity ?? row.quantityKg);
    const displayedTotalGbp = Number(row.displayedTotalGbp);
    if (
      typeof row.name !== "string" ||
      !row.name.trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !isUnitType(row.unitType) ||
      typeof row.label !== "string" ||
      !Number.isFinite(displayedTotalGbp) ||
      displayedTotalGbp <= 0
    ) return [];
    const priceGbp = row.priceGbp == null ? null : Number(row.priceGbp);
    const unitPriceGbp = row.unitPriceGbp == null ? null : Number(row.unitPriceGbp);
    return [{
      key: typeof row.key === "string" ? row.key : newRunId(),
      productId: typeof row.productId === "string" ? row.productId : null,
      name: row.name.slice(0, 80),
      quantity,
      unitType: row.unitType,
      label: row.label.slice(0, 30),
      priceGbp: priceGbp != null && Number.isFinite(priceGbp) ? priceGbp : null,
      unitPriceGbp: unitPriceGbp != null && Number.isFinite(unitPriceGbp) ? unitPriceGbp : null,
      displayedTotalGbp,
    }];
  });
}

function restorePending(value: unknown): PendingLine | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const quantity = Number(row.quantity);
  return Number.isFinite(quantity) && quantity > 0 && typeof row.label === "string"
    ? { quantity, label: row.label.slice(0, 30) }
    : null;
}

export function OperatorServeFlow({
  tiles,
  initialDraft,
}: {
  tiles: ServeTile[];
  initialDraft: OperatorDraftRecord | null;
}) {
  const { t, error: operatorError, product: productName, locale } = useOperatorI18n();
  const dryRun = useOperatorDryRun();
  const effectiveTiles = useMemo(() => dryRun.active ? [{ id: "product:dry-run-chicken", productId: "dry-run-chicken", fallbackName: "Chicken Breast Fillets", label: "Chicken Breast Fillets", unitType: "kg" as const, pricePerUnit: 7 }] : tiles, [dryRun.active, tiles]);
  const resumable = useMemo(
    () => !dryRun.active && initialDraft && parseOperatorDraftSteps(initialDraft.steps, "serve", RESUMABLE_MODES),
    [dryRun.active, initialDraft],
  );
  const [showResumePrompt, setShowResumePrompt] = useState(Boolean(resumable));
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [runId, setRunId] = useState("");
  const [mode, setMode] = useState<Mode>("buy");
  const [picked, setPicked] = useState<ServeTile | null>(null);
  const [otherName, setOtherName] = useState("");
  const [amountDigits, setAmountDigits] = useState("");
  const [pounds, setPounds] = useState("");
  const [pending, setPending] = useState<PendingLine | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [payKind, setPayKind] = useState<PayKind>("cash");
  const [result, setResult] = useState<{ total: number; needsOwner: boolean; priceUpdated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!showResumePrompt && !runId) setRunId(newRunId());
  }, [runId, showResumePrompt]);

  const tutorialStepId = dryRun.session ? completeShopDaySteps[dryRun.session.currentStep]?.id : null;
  useEffect(() => {
    if (!dryRun.active) return;
    const practiceTile = effectiveTiles[0];
    const practiceLine: Line = { key: "dry-run-line", productId: "dry-run-chicken", name: "Chicken Breast Fillets", quantity: 2, unitType: "kg", label: "2kg", priceGbp: null, unitPriceGbp: 7, displayedTotalGbp: 14 };
    if (tutorialStepId === "serve.product") setMode("buy");
    if (tutorialStepId === "serve.weight" && practiceTile) { setPicked(practiceTile); setMode("amount"); }
    if (tutorialStepId === "serve.cash") { setLines([practiceLine]); setMode("pay"); }
    if (tutorialStepId === "serve.confirm") { setLines([practiceLine]); setPayKind("cash"); setMode("confirm"); }
  }, [dryRun.active, effectiveTiles, tutorialStepId]);

  const displayedTotal = useMemo(
    () => roundServeMoney(lines.reduce((sum, line) => sum + line.displayedTotalGbp, 0)),
    [lines],
  );
  const summary = useMemo(() => lines.map((line) => {
    const amount = line.unitType === "kg"
      ? (locale === "ps-AF" ? isolateLtr(line.label) : line.label)
      : `${locale === "ps-AF" ? isolateLtr(`×${line.quantity}`) : `×${line.quantity}`}`;
    return `${productName(line.name)} ${amount} — ${operatorMoney(line.displayedTotalGbp, locale)}`;
  }), [lines, locale, productName]);

  const draftSave = useOperatorDraftSave({
    runId,
    workflow: "serve",
    mode,
    lastSavedStep: LAST_SAVED_STEP[mode],
    answers: {
      pickedId: picked?.id ?? null,
      otherName,
      amountDigits,
      pounds,
      pending,
      lines,
      payKind,
    },
    enabled: !dryRun.active && !showResumePrompt && mode !== "done" && (mode !== "buy" || lines.length > 0),
  });

  function resumeDraft() {
    if (!resumable || !initialDraft) return;
    const answers = resumable.answers;
    const savedLines = restoreLines(answers.lines);
    const savedPicked = typeof answers.pickedId === "string"
      ? effectiveTiles.find((tile) => tile.id === answers.pickedId) ?? null
      : null;
    let restoredMode = resumable.mode as Mode;
    if (["amount", "other-amount", "price"].includes(restoredMode) && !savedPicked) {
      restoredMode = savedLines.length > 0 ? "add-more" : "buy";
    }

    setRunId(initialDraft.runId);
    setMode(restoredMode);
    setPicked(savedPicked);
    setOtherName(typeof answers.otherName === "string" ? answers.otherName.slice(0, 80) : "");
    setAmountDigits(typeof answers.amountDigits === "string" ? answers.amountDigits.slice(0, 5) : "");
    setPounds(typeof answers.pounds === "string" ? answers.pounds.slice(0, 7) : "");
    setPending(restorePending(answers.pending));
    setLines(savedLines);
    setPayKind(answers.payKind === "card" ? "card" : "cash");
    setDraftError(null);
    setShowResumePrompt(false);
    draftSave.markResumed();
  }

  async function startFresh() {
    if (!initialDraft) return;
    setDraftBusy(true);
    setDraftError(null);
    const closeResult = await abandonOperatorDraft({ runId: initialDraft.runId, workflow: "serve" });
    setDraftBusy(false);
    if (!closeResult.ok) {
      setDraftError(closeResult.message);
      return;
    }
    setRunId(newRunId());
    setShowResumePrompt(false);
    draftSave.reset();
  }

  function restart() {
    setRunId(newRunId());
    setMode("buy");
    setPicked(null);
    setOtherName("");
    setAmountDigits("");
    setPounds("");
    setPending(null);
    setLines([]);
    setPayKind("cash");
    setResult(null);
    setError(null);
    draftSave.reset();
  }

  function choose(tile: ServeTile) {
    setPicked(tile);
    setOtherName(tile.id === "other" ? "" : tile.fallbackName);
    setError(null);
    setMode(tile.id === "other" ? "other-name" : "amount");
  }

  function pickAmount(quantity: number, label: string) {
    if (picked?.productId) {
      commitLine(quantity, label, null);
      return;
    }
    setPending({ quantity, label });
    setPounds("");
    setError(null);
    setMode("price");
  }

  function commitLine(quantity: number, label: string, priceGbp: number | null) {
    const name = picked?.productId ? picked.fallbackName : otherName.trim() || picked?.fallbackName || "Other";
    const unitPriceGbp = picked?.productId ? picked.pricePerUnit : null;
    const displayedTotalGbp = unitPriceGbp != null
      ? expectedServeLineTotal(quantity, unitPriceGbp)
      : roundServeMoney(priceGbp ?? 0);
    setLines((items) => [
      ...items,
      {
        key: newRunId(),
        productId: picked?.productId ?? null,
        name,
        quantity,
        unitType: picked?.unitType ?? "kg",
        label,
        priceGbp,
        unitPriceGbp,
        displayedTotalGbp,
      },
    ]);
    setPicked(null);
    setOtherName("");
    setAmountDigits("");
    setPounds("");
    setPending(null);
    setMode(dryRun.active ? "pay" : "add-more");
  }

  function addOtherAmount() {
    const value = Number(amountDigits);
    if (picked?.unitType === "each" || picked?.unitType === "box") {
      if (!Number.isInteger(value) || value < 1 || value > 99) {
        setError("i18n:serve.enterWhole");
        return;
      }
      setError(null);
      pickAmount(value, String(value));
      return;
    }
    if (!Number.isFinite(value) || value <= 0 || value > 50_000) {
      setError("i18n:serve.enterWeight");
      return;
    }
    setError(null);
    pickAmount(value / 1000, `${value}g`);
  }

  function addPrice() {
    const value = Number(pounds);
    if (!pending || !Number.isFinite(value) || value <= 0 || value > 1000) {
      setError("i18n:serve.enterPriceError");
      return;
    }
    setError(null);
    commitLine(pending.quantity, pending.label, roundServeMoney(value));
  }

  function save() {
    setError(null);
    const totalBeforeSave = displayedTotal;
    if (dryRun.active) {
      setResult({ total: totalBeforeSave, needsOwner: false, priceUpdated: false });
      setMode("done");
      return;
    }
    startTransition(async () => {
      const saveResult = await saveSimpleSale({
        runId,
        lines: lines.map((line) => ({
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          priceGbp: line.priceGbp,
        })),
        payKind,
        executionContext: LIVE_EXECUTION_CONTEXT,
      });
      if (!saveResult.ok) {
        setError(saveResult.message);
        return;
      }
      setResult({
        total: saveResult.totalGbp,
        needsOwner: saveResult.needsOwner === true,
        priceUpdated: Math.round(totalBeforeSave * 100) !== Math.round(saveResult.totalGbp * 100),
      });
      setMode("done");
    });
  }

  const isCount = picked?.unitType === "each" || picked?.unitType === "box";
  const amountTitle = t(picked?.unitType === "box" ? "serve.howManyBoxes" : picked?.unitType === "each" ? "serve.howMany" : "serve.howMuch");

  return (
    <div data-testid="operator-serve-flow">
      <Link href="/operator" className="mb-5 inline-flex min-h-[56px] items-center gap-2 text-lg font-semibold text-[var(--brand)]">
        <ArrowLeft className="operator-directional-icon h-6 w-6" aria-hidden />
        {t("common.goBack")}
      </Link>

      {showResumePrompt && resumable ? (
        <OperatorDraftPrompt
          lastSavedStep={resumable.lastSavedStep}
          onResume={resumeDraft}
          onStartFresh={() => void startFresh()}
          busy={draftBusy}
          error={draftError}
        />
      ) : (
        <>
          <OperatorDraftStatus status={draftSave.status} />

          {mode === "buy" && (
            <Panel title={t("serve.whatBought")}>
              <div className="grid gap-3 sm:grid-cols-2">
                {effectiveTiles.map((tile) => (
                  <BigButton
                    key={tile.id}
                    onClick={() => choose(tile)}
                    label={tile.id.startsWith("product:")
                      ? productName(tile.label)
                      : t(`serve.tile.${tile.id}` as OperatorTranslationKey)}
                    muted={!tile.productId && tile.id !== "other"}
                    testId={tile.productId ? `serve-product-${tile.productId}` : `serve-tile-${tile.id}`}
                    tutorialTarget={tile.fallbackName === "Chicken Breast Fillets" ? "serve-product-chicken" : undefined}
                  />
                ))}
              </div>
            </Panel>
          )}

          {mode === "other-name" && (
            <Panel title={t("serve.whatCalled")}>
              <input
                value={otherName}
                onChange={(event) => setOtherName(event.target.value)}
                autoFocus
                maxLength={80}
                className="h-20 rounded-xl border-2 border-[var(--line)] bg-[var(--paper)] px-4 text-2xl font-semibold outline-none focus:border-[var(--brand)]"
              />
              <BigButton onClick={() => setMode("amount")} label={t("common.next")} disabled={otherName.trim().length < 2} />
            </Panel>
          )}

          {mode === "amount" && (
            <Panel title={amountTitle}>
              {isCount
                ? SERVE_COUNT_CHOICES.map((count) => (
                    <BigButton
                      key={count}
                      onClick={() => pickAmount(count, String(count))}
                      label={locale === "ps-AF"
                        ? isolateLtr(formatServePresetLabel(String(count), count, picked?.pricePerUnit ?? null))
                        : formatServePresetLabel(String(count), count, picked?.pricePerUnit ?? null)}
                      testId={`serve-count-${count}`}
                    />
                  ))
                : SERVE_AMOUNT_CHOICES.map((choice) => (
                    <BigButton
                      key={choice.id}
                      onClick={() => pickAmount(choice.kg, choice.label)}
                      label={locale === "ps-AF"
                        ? isolateLtr(formatServePresetLabel(choice.label, choice.kg, picked?.pricePerUnit ?? null))
                        : formatServePresetLabel(choice.label, choice.kg, picked?.pricePerUnit ?? null)}
                      testId={`serve-weight-${choice.id}`}
                      tutorialTarget={choice.kg === 2 ? "serve-weight" : undefined}
                    />
                  ))}
              <BigButton onClick={() => setMode("other-amount")} label={t(isCount ? "serve.more" : "serve.otherAmount")} muted />
            </Panel>
          )}

          {mode === "other-amount" && (
            <Panel title={amountTitle}>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-center text-4xl font-semibold">
                <bdi dir="ltr">{amountDigits || "0"}{isCount ? "" : "g"}</bdi>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ...(isCount ? [] : ["00"])].map((digit) => (
                  <BigButton
                    key={digit}
                    onClick={() => setAmountDigits((value) => `${value}${digit}`.slice(0, isCount ? 2 : 5))}
                    label={digit}
                  />
                ))}
                <BigButton onClick={() => setAmountDigits("")} label={t("common.clear")} muted />
              </div>
              <BigButton onClick={addOtherAmount} label={t("common.next")} disabled={Number(amountDigits) <= 0} />
            </Panel>
          )}

          {mode === "price" && (
            <Panel title={t("serve.enterPrice")}>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-center text-4xl font-semibold">
                <bdi dir="ltr">£{pounds || "0"}</bdi>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map((digit) => (
                  <BigButton
                    key={digit}
                    onClick={() => setPounds((value) => {
                      if (digit === "." && value.includes(".")) return value;
                      const next = `${value}${digit}`;
                      return next.length <= 7 ? next : value;
                    })}
                    label={digit}
                  />
                ))}
                <BigButton onClick={() => setPounds("")} label={t("common.clear")} muted />
              </div>
              <BigButton onClick={addPrice} label={t("common.next")} disabled={!(Number(pounds) > 0)} />
            </Panel>
          )}

          {mode === "add-more" && (
            <Panel title={t("serve.addMore")}>
              <Summary lines={summary} total={displayedTotal} />
              <BigButton onClick={() => setMode("buy")} label={t("common.yes")} />
              <BigButton onClick={() => setMode("pay")} label={t("common.no")} muted />
            </Panel>
          )}

          {mode === "pay" && (
            <Panel title={t("serve.howPaid")}>
              <BigButton onClick={() => { setPayKind("cash"); setMode("confirm"); }} label={t("serve.cash")} tutorialTarget="serve-payment-cash" />
              <BigButton onClick={() => { setPayKind("card"); setMode("confirm"); }} label={t("serve.card")} />
            </Panel>
          )}

          {mode === "confirm" && (
            <Panel title={t("serve.saveSale")}>
              <Summary lines={[...summary, t("serve.paidBy", { method: t(payKind === "cash" ? "serve.cash" : "serve.card") })]} total={displayedTotal} />
              <BigButton onClick={save} label={t("common.save")} busy={isPending || !runId} tutorialTarget="serve-confirm" />
              <BigButton onClick={() => setMode("pay")} label={t("common.goBack")} muted />
            </Panel>
          )}

          {mode === "done" && (
            <Panel title={t("common.done")}>
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white">
                <Check className="h-9 w-9" aria-hidden />
              </div>
              {result ? (
                <p data-testid="serve-saved-total" className="text-center text-lg font-semibold text-[var(--muted)]">
                  {t(
                    result.needsOwner ? "serve.saleSavedOwner" : result.priceUpdated ? "serve.priceUpdated" : "serve.saleSaved",
                    { amount: operatorMoney(result.total, locale) },
                  )}
                </p>
              ) : null}
              <BigButton onClick={restart} label={t("serve.nextCustomer")} />
              <Link
                href="/operator"
                className="flex min-h-[64px] items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 text-lg font-semibold text-[var(--muted)]"
              >
                {t("common.goHome")}
              </Link>
            </Panel>
          )}
        </>
      )}

      {error ? <p className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-base font-semibold text-[var(--clay)]">{operatorError(error)}</p> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <ShoppingBag className="mt-1 h-8 w-8 shrink-0 text-[var(--brand)]" aria-hidden />
        <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
      </div>
      <div className="mt-6 grid gap-3">{children}</div>
    </section>
  );
}

function BigButton({
  label,
  onClick,
  muted,
  disabled,
  busy,
  testId,
  tutorialTarget,
}: {
  label: string;
  onClick: () => void;
  muted?: boolean;
  disabled?: boolean;
  busy?: boolean;
  testId?: string;
  tutorialTarget?: string;
}) {
  const { t } = useOperatorI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      data-testid={testId}
      data-tutorial={tutorialTarget}
      className={[
        "flex min-h-[72px] w-full items-center justify-center rounded-2xl px-6 text-xl font-semibold transition active:scale-[0.99] disabled:opacity-50",
        muted ? "border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)]" : "bg-[var(--brand)] text-white",
      ].join(" ")}
    >
      {busy ? t("common.saving") : label}
    </button>
  );
}

function Summary({ lines, total }: { lines: string[]; total: number }) {
  const { t, locale } = useOperatorI18n();
  return (
    <div data-testid="serve-line-summary" className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4">
      {lines.map((line, index) => (
        <p key={`${index}-${line}`} className="text-lg font-semibold text-[var(--ink)]">
          {line}
        </p>
      ))}
      <p data-testid="serve-total" className="mt-3 border-t border-[var(--line)] pt-3 text-xl font-bold text-[var(--ink)]">
        {t("serve.total", { amount: operatorMoney(total, locale) })}
      </p>
    </div>
  );
}

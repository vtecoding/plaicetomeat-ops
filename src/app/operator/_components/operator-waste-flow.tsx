"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";

import { abandonOperatorDraft } from "@/app/actions/operator/drafts";
import { uploadOperatorEvidence } from "@/app/actions/operator/evidence";
import { recordNoWaste, recordSimpleWaste } from "@/app/actions/operator/waste";
import {
  OperatorDraftPrompt,
  OperatorDraftStatus,
  useOperatorDraftSave,
} from "@/app/operator/_components/operator-draft";
import { parseOperatorDraftSteps, type OperatorDraftRecord } from "@/lib/operator/workflows/drafts";
import { WASTE_REASON_CHOICES, type WasteReasonChoice } from "@/lib/operator/workflows/waste";
import { useOperatorI18n } from "@/lib/operator/i18n/context";
import { operatorMeasure, type OperatorTranslationKey } from "@/lib/operator/i18n/resources";

type ProductOption = { id: string; name: string; unitType: string };
type Mode = "start" | "product" | "amount" | "reason" | "photo" | "confirm" | "done";
const RESUMABLE_MODES: readonly Mode[] = ["product", "amount", "reason", "photo", "confirm"];
const LAST_SAVED_STEP: Record<Mode, string> = {
  start: "",
  product: "waste.start",
  amount: "waste.product",
  reason: "waste.amount",
  photo: "waste.reason",
  confirm: "waste.photo",
  done: "",
};

export function OperatorWasteFlow({ products, initialDraft }: { products: ProductOption[]; initialDraft: OperatorDraftRecord | null }) {
  const { t, error: operatorError, product: productName, locale } = useOperatorI18n();
  const resumable = useMemo(
    () => initialDraft && parseOperatorDraftSteps(initialDraft.steps, "waste", RESUMABLE_MODES),
    [initialDraft],
  );
  const [showResumePrompt, setShowResumePrompt] = useState(Boolean(resumable));
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [runId, setRunId] = useState("");
  const [mode, setMode] = useState<Mode>("start");
  const [productId, setProductId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<WasteReasonChoice>("expired");
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoEvidenceId, setPhotoEvidenceId] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [result, setResult] = useState<"none" | "waste" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!showResumePrompt && !runId) setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }, [runId, showResumePrompt]);

  const product = useMemo(() => products.find((item) => item.id === productId) ?? null, [products, productId]);
  const unit = product?.unitType ?? "kg";
  const draftSave = useOperatorDraftSave({
    runId,
    workflow: "waste",
    mode,
    lastSavedStep: LAST_SAVED_STEP[mode],
    answers: { productId, quantity, reason, photoName, photoEvidenceId },
    enabled: !showResumePrompt && mode !== "start" && mode !== "done",
  });

  function resumeDraft() {
    if (!resumable || !initialDraft) return;
    const answers = resumable.answers;
    const savedReason = WASTE_REASON_CHOICES.find((choice) => choice.id === answers.reason)?.id;
    setRunId(initialDraft.runId);
    setMode(resumable.mode as Mode);
    setProductId(typeof answers.productId === "string" ? answers.productId : null);
    setQuantity(typeof answers.quantity === "string" ? answers.quantity : "");
    setReason(savedReason ?? "expired");
    setPhotoName(typeof answers.photoName === "string" ? answers.photoName : null);
    setPhotoEvidenceId(typeof answers.photoEvidenceId === "string" ? answers.photoEvidenceId : null);
    setDraftError(null);
    setShowResumePrompt(false);
    draftSave.markResumed();
  }

  async function startFresh() {
    if (!initialDraft) return;
    setDraftBusy(true);
    setDraftError(null);
    const result = await abandonOperatorDraft({ runId: initialDraft.runId, workflow: "waste" });
    setDraftBusy(false);
    if (!result.ok) {
      setDraftError(result.message);
      return;
    }
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    setShowResumePrompt(false);
    draftSave.reset();
  }

  function restart() {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    setMode("start");
    setProductId(null);
    setQuantity("");
    setReason("expired");
    setPhotoName(null);
    setPhotoEvidenceId(null);
    setPhotoSaving(false);
    setResult(null);
    setError(null);
    draftSave.reset();
  }

  function saveNoWaste() {
    setError(null);
    startTransition(async () => {
      const res = await recordNoWaste({ runId });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult("none");
      setMode("done");
    });
  }

  function saveWaste() {
    setError(null);
    startTransition(async () => {
      const res = await recordSimpleWaste({
        runId,
        productId,
        quantity: Number(quantity),
        reason,
        photoEvidenceId,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult("waste");
      setMode("done");
    });
  }

  async function savePhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPhotoSaving(true);
    setPhotoName(file.name);
    setPhotoEvidenceId(null);

    const formData = new FormData();
    formData.set("file", file);
    formData.set("evidenceType", "waste_photo");
    formData.set("sourceType", "operator_workflow_run");
    formData.set("sourceId", runId);
    formData.set("sourceRef", product?.name ?? "Waste photo");
    formData.set("operationId", runId);

    const res = await uploadOperatorEvidence(formData);
    setPhotoSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPhotoEvidenceId(res.id);
    setPhotoName(res.fileName);
    setMode("confirm");
  }

  return (
    <div data-testid="operator-waste-flow">
      <Link href="/operator" className="mb-5 inline-flex min-h-[56px] items-center gap-2 text-lg font-semibold text-[var(--brand)]">
        <ArrowLeft className="operator-directional-icon h-6 w-6" aria-hidden />
        {t("common.back")}
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

      {mode === "start" && (
        <Panel title={t("waste.any")}>
          <BigButton onClick={() => setMode("product")} label={t("common.yes")} />
          <BigButton onClick={saveNoWaste} label={t("common.no")} muted busy={isPending || !runId} />
        </Panel>
      )}

      {mode === "product" && (
        <Panel title={t("waste.what")}>
          <ProductGrid products={products} onPick={(id) => { setProductId(id); setMode("amount"); }} />
          <BigButton onClick={() => { setProductId(null); setMode("amount"); }} label={t("common.notSure")} muted />
        </Panel>
      )}

      {mode === "amount" && (
        <Panel title={t("waste.howMuch")} helper={product ? productName(product.name) : t("common.bestGuess")}>
          <AmountInput value={quantity} onChange={setQuantity} unit={unit} />
          <BigButton onClick={() => setMode("reason")} label={t("common.next")} disabled={Number(quantity) <= 0} />
        </Panel>
      )}

      {mode === "reason" && (
        <Panel title={t("waste.why")}>
          {WASTE_REASON_CHOICES.map((choice) => (
            <BigButton key={choice.id} onClick={() => { setReason(choice.id); setMode("photo"); }} label={t(`waste.reason.${choice.id}` as OperatorTranslationKey)} muted={choice.id === "review"} />
          ))}
        </Panel>
      )}

      {mode === "photo" && (
        <Panel title={t("waste.photo")} helper={t("common.optional")}>
          <label className="flex min-h-[72px] cursor-pointer items-center justify-center rounded-2xl bg-[var(--brand)] px-6 text-xl font-semibold text-white transition active:scale-[0.99]">
            {t("common.takePhoto")}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={photoSaving || !runId}
              onChange={(event) => void savePhoto(event.target.files?.[0])}
            />
          </label>
          <BigButton onClick={() => { setPhotoName(null); setPhotoEvidenceId(null); setMode("confirm"); }} label={t("common.skipNow")} muted />
          {photoSaving ? <p className="text-base font-semibold text-[var(--muted)]">{t("common.savingPhoto")}</p> : null}
          {photoEvidenceId && photoName ? <p className="text-base font-semibold text-[var(--muted)]">{t("common.photoSaved", { name: photoName })}</p> : null}
        </Panel>
      )}

      {mode === "confirm" && (
        <Panel title={t("waste.confirm")}>
          <Summary
            lines={[
              product ? productName(product.name) : t("stock.productUnknown"),
              operatorMeasure(quantity || "0", t(`unit.${unit}` as OperatorTranslationKey), locale),
              t(`waste.reason.${reason}` as OperatorTranslationKey),
            ]}
          />
          <BigButton onClick={saveWaste} label={t("waste.save")} busy={isPending || !runId} />
        </Panel>
      )}

      {mode === "done" && (
        <Panel title={result === "none" ? t("waste.noWasteSaved") : t("waste.saved")}>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white">
            <Check className="h-9 w-9" aria-hidden />
          </div>
          <BigButton onClick={restart} label={t("waste.another")} />
          <Link
            href="/operator"
            className="flex min-h-[64px] items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 text-lg font-semibold text-[var(--muted)]"
          >
            {t("common.backHome")}
          </Link>
        </Panel>
      )}

        </>
      )}

      {error ? <p className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-base font-semibold text-[var(--clay)]">{operatorError(error)}</p> : null}
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

function BigButton({ label, onClick, muted, disabled, busy }: { label: string; onClick: () => void; muted?: boolean; disabled?: boolean; busy?: boolean }) {
  const { t } = useOperatorI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={[
        "flex min-h-[72px] w-full items-center justify-center rounded-2xl px-6 text-xl font-semibold transition active:scale-[0.99] disabled:opacity-50",
        muted ? "border border-[var(--line)] bg-[var(--paper)] text-[var(--muted)]" : "bg-[var(--brand)] text-white",
      ].join(" ")}
    >
      {busy ? t("common.saving") : label}
    </button>
  );
}

function ProductGrid({ products, onPick }: { products: ProductOption[]; onPick: (id: string) => void }) {
  const { product: productName } = useOperatorI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {products.slice(0, 12).map((product) => (
        <button
          key={product.id}
          type="button"
          onClick={() => onPick(product.id)}
          className="min-h-[88px] rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-start text-xl font-semibold text-[var(--ink)] transition active:scale-[0.99]"
        >
          {productName(product.name)}
        </button>
      ))}
    </div>
  );
}

function AmountInput({ value, onChange, unit }: { value: string; onChange: (value: string) => void; unit: string }) {
  const { t } = useOperatorI18n();
  return (
    <label className="block">
      <span className="sr-only">{t("common.amount")}</span>
      <span className="flex items-center gap-3">
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          data-testid="operator-waste-quantity"
          className="h-20 w-44 rounded-xl border-2 border-[var(--line)] bg-[var(--paper)] px-4 text-3xl font-semibold outline-none focus:border-[var(--brand)]"
        />
        <bdi dir="ltr" className="operator-bidi text-2xl font-semibold text-[var(--muted)]">{t(`unit.${unit}` as OperatorTranslationKey)}</bdi>
      </span>
    </label>
  );
}

function Summary({ lines }: { lines: string[] }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4">
      {lines.map((line) => (
        <p key={line} className="text-lg font-semibold text-[var(--ink)]">
          {line}
        </p>
      ))}
    </div>
  );
}

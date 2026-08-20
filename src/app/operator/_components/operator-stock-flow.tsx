"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Pencil, Truck } from "lucide-react";

import { abandonOperatorDraft } from "@/app/actions/operator/drafts";
import { confirmSimpleDelivery, reportRanOut, tellOwnerAboutStock } from "@/app/actions/operator/delivery";
import { uploadOperatorEvidence } from "@/app/actions/operator/evidence";
import {
  OperatorDraftPrompt,
  OperatorDraftStatus,
  useOperatorDraftSave,
} from "@/app/operator/_components/operator-draft";
import {
  hasConfidentSupplier,
  initialSelectionFromDefaults,
  type DeliveryDefaults,
} from "@/lib/operator/workflows/delivery-defaults";
import {
  EXPIRY_CHOICES,
  STORAGE_CHOICES,
  type ExpiryChoice,
  type StorageChoice,
} from "@/lib/operator/workflows/stock";
import { parseOperatorDraftSteps, type OperatorDraftRecord } from "@/lib/operator/workflows/drafts";
import { useOperatorI18n } from "@/lib/operator/i18n/context";
import { LIVE_EXECUTION_CONTEXT } from "@/lib/operator/execution-context";
import { useOperatorDryRun } from "@/lib/operator/tutorial/context";
import { completeShopDaySteps } from "@/lib/operator/tutorial/scenario";
import { operatorMeasure, type OperatorTranslationKey } from "@/lib/operator/i18n/resources";

type ProductOption = { id: string; name: string; unitType: string };
type SupplierOption = { id: string; name: string };
type Mode =
  | "start"
  | "delivery-product"
  | "delivery-amount"
  | "delivery-supplier"
  | "delivery-photo"
  | "delivery-storage"
  | "delivery-expiry"
  | "delivery-review"
  | "delivery-confirm"
  | "ranout-product"
  | "ranout-sure"
  | "ranout-confirm"
  | "done";

const RESUMABLE_MODES: readonly Mode[] = [
  "delivery-product",
  "delivery-amount",
  "delivery-supplier",
  "delivery-photo",
  "delivery-storage",
  "delivery-expiry",
  "delivery-review",
  "delivery-confirm",
  "ranout-product",
  "ranout-sure",
  "ranout-confirm",
];

const LAST_SAVED_STEP: Record<Mode, string> = {
  start: "",
  "delivery-product": "stock.what",
  "delivery-amount": "stock.arrived",
  "delivery-supplier": "stock.amount",
  "delivery-photo": "stock.supplier",
  "delivery-storage": "stock.photo",
  "delivery-expiry": "stock.storage",
  "delivery-review": "stock.amount",
  "delivery-confirm": "stock.expiry",
  "ranout-product": "stock.what",
  "ranout-sure": "stock.ranOut",
  "ranout-confirm": "stock.empty",
  done: "",
};

export function OperatorStockFlow({
  products,
  suppliers,
  deliveryDefaults,
  initialDraft,
}: {
  products: ProductOption[];
  suppliers: SupplierOption[];
  deliveryDefaults: Record<string, DeliveryDefaults>;
  initialDraft: OperatorDraftRecord | null;
}) {
  const { t, error: operatorError, product: productName, locale } = useOperatorI18n();
  const dryRun = useOperatorDryRun();
  const effectiveProducts = useMemo(() => dryRun.active ? [{ id: "dry-run-lamb", name: "Lamb Leg Steaks", unitType: "kg" }] : products, [dryRun.active, products]);
  const effectiveSuppliers = useMemo(() => dryRun.active ? [{ id: "dry-run-supplier", name: "Practice Supplier" }] : suppliers, [dryRun.active, suppliers]);
  const resumable = useMemo(
    () => !dryRun.active && initialDraft && parseOperatorDraftSteps(initialDraft.steps, "delivery", RESUMABLE_MODES),
    [dryRun.active, initialDraft],
  );
  const [showResumePrompt, setShowResumePrompt] = useState(Boolean(resumable));
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [runId, setRunId] = useState("");
  const [mode, setMode] = useState<Mode>("start");
  const [productId, setProductId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(suppliers.length === 1 ? suppliers[0]?.id ?? null : null);
  const [quantity, setQuantity] = useState("");
  const [notePhotoName, setNotePhotoName] = useState<string | null>(null);
  const [noteEvidenceId, setNoteEvidenceId] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [storageChoice, setStorageChoice] = useState<StorageChoice | null>(null);
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice | null>(null);
  // Provenance for the audit trail: where each value came from ("last_used", "safe_default",
  // …) or "manual" once the operator corrects it. Never shown on the operator screen.
  const [supplierSource, setSupplierSource] = useState<string | null>(null);
  const [storageSource, setStorageSource] = useState<string | null>(null);
  const [expirySource, setExpirySource] = useState<string | null>(null);
  // True while a picker was opened from the review screen, so it returns there on choose.
  const [returnToReview, setReturnToReview] = useState(false);
  const [sureRanOut, setSureRanOut] = useState(true);
  const [result, setResult] = useState<"stock" | "owner" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!showResumePrompt && !runId) setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }, [runId, showResumePrompt]);

  const tutorialStepId = dryRun.session ? completeShopDaySteps[dryRun.session.currentStep]?.id : null;
  useEffect(() => {
    if (!dryRun.active) return;
    if (tutorialStepId === "stock.received") setMode("start");
    else if (tutorialStepId === "stock.product") setMode("delivery-product");
    else if (tutorialStepId === "stock.weight") { setProductId("dry-run-lamb"); setMode("delivery-amount"); }
    else if (tutorialStepId === "stock.expiry") {
      setSupplierId("dry-run-supplier");
      setStorageChoice("fridge");
      setMode("delivery-expiry");
    } else if (tutorialStepId === "stock.evidence") {
      setMode("delivery-photo");
    } else if (tutorialStepId === "stock.confirm") {
      setMode("delivery-confirm");
    }
  }, [dryRun.active, tutorialStepId]);

  const product = useMemo(() => effectiveProducts.find((item) => item.id === productId) ?? null, [effectiveProducts, productId]);
  const supplier = useMemo(() => effectiveSuppliers.find((item) => item.id === supplierId) ?? null, [effectiveSuppliers, supplierId]);
  const unit = product?.unitType ?? "kg";
  const draftSave = useOperatorDraftSave({
    runId,
    workflow: "delivery",
    mode,
    lastSavedStep: LAST_SAVED_STEP[mode],
    answers: {
      productId,
      supplierId,
      quantity,
      notePhotoName,
      noteEvidenceId,
      storageChoice,
      expiryChoice,
      supplierSource,
      storageSource,
      expirySource,
      returnToReview,
      sureRanOut,
    },
    enabled: !dryRun.active && !showResumePrompt && mode !== "start" && mode !== "done",
  });

  function resumeDraft() {
    if (!resumable || !initialDraft) return;
    const answers = resumable.answers;
    const savedStorage = STORAGE_CHOICES.find((choice) => choice.id === answers.storageChoice)?.id ?? null;
    const savedExpiry = EXPIRY_CHOICES.find((choice) => choice.id === answers.expiryChoice)?.id ?? null;
    setRunId(initialDraft.runId);
    setMode(resumable.mode as Mode);
    setProductId(typeof answers.productId === "string" ? answers.productId : null);
    setSupplierId(typeof answers.supplierId === "string" ? answers.supplierId : null);
    setQuantity(typeof answers.quantity === "string" ? answers.quantity : "");
    setNotePhotoName(typeof answers.notePhotoName === "string" ? answers.notePhotoName : null);
    setNoteEvidenceId(typeof answers.noteEvidenceId === "string" ? answers.noteEvidenceId : null);
    setStorageChoice(savedStorage);
    setExpiryChoice(savedExpiry);
    setSupplierSource(typeof answers.supplierSource === "string" ? answers.supplierSource : null);
    setStorageSource(typeof answers.storageSource === "string" ? answers.storageSource : null);
    setExpirySource(typeof answers.expirySource === "string" ? answers.expirySource : null);
    setReturnToReview(answers.returnToReview === true);
    setSureRanOut(answers.sureRanOut !== false);
    setDraftError(null);
    setShowResumePrompt(false);
    draftSave.markResumed();
  }

  async function startFresh() {
    if (!initialDraft) return;
    setDraftBusy(true);
    setDraftError(null);
    const result = await abandonOperatorDraft({ runId: initialDraft.runId, workflow: "delivery" });
    setDraftBusy(false);
    if (!result.ok) {
      setDraftError(result.message);
      return;
    }
    restart("start");
    setShowResumePrompt(false);
  }

  function restart(next: Mode) {
    setRunId(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    setMode(next);
    setProductId(null);
    setSupplierId(suppliers.length === 1 ? suppliers[0]?.id ?? null : null);
    setQuantity("");
    setNotePhotoName(null);
    setNoteEvidenceId(null);
    setPhotoSaving(false);
    setStorageChoice(null);
    setExpiryChoice(null);
    setSupplierSource(null);
    setStorageSource(null);
    setExpirySource(null);
    setReturnToReview(false);
    setSureRanOut(true);
    setResult(null);
    setError(null);
    draftSave.reset();
  }

  // Pick the product, then seed the supplier/storage/expiry suggestion from its history.
  function chooseDeliveryProduct(id: string | null) {
    setProductId(id);
    const defaults = id ? deliveryDefaults[id] : undefined;
    if (defaults) {
      const selection = initialSelectionFromDefaults(defaults);
      setSupplierId(selection.supplierId);
      setStorageChoice(selection.storageChoice);
      setExpiryChoice(selection.expiryChoice);
      setSupplierSource(defaults.supplier.source);
      setStorageSource(defaults.storage.source);
      setExpirySource(defaults.expiry.source);
    } else {
      setSupplierId(suppliers.length === 1 ? suppliers[0]?.id ?? null : null);
      setStorageChoice(null);
      setExpiryChoice(null);
      setSupplierSource(null);
      setStorageSource(null);
      setExpirySource(null);
    }
    setMode("delivery-amount");
  }

  // After the amount: if we can confidently suggest a supplier, go straight to the one-screen
  // review; otherwise fall back to the full explicit ask (first-ever / ambiguous delivery).
  function afterAmount() {
    const defaults = productId ? deliveryDefaults[productId] : undefined;
    setMode(defaults && hasConfidentSupplier(defaults) ? "delivery-review" : "delivery-supplier");
  }

  function changeFromReview(target: "delivery-supplier" | "delivery-storage" | "delivery-expiry" | "delivery-photo") {
    setReturnToReview(true);
    setMode(target);
  }

  function pickSupplier(id: string | null) {
    setSupplierId(id);
    setSupplierSource("manual");
    setMode(returnToReview ? "delivery-review" : "delivery-photo");
    setReturnToReview(false);
  }

  function pickStorage(choice: StorageChoice) {
    setStorageChoice(choice);
    setStorageSource("manual");
    setMode(returnToReview ? "delivery-review" : "delivery-expiry");
    setReturnToReview(false);
  }

  function pickExpiry(choice: ExpiryChoice) {
    setExpiryChoice(choice);
    setExpirySource("manual");
    setMode(dryRun.active ? "delivery-photo" : returnToReview ? "delivery-review" : "delivery-confirm");
    setReturnToReview(false);
  }

  function saveDelivery() {
    if (!storageChoice || !expiryChoice) {
      setError("i18n:stock.selectStorageExpiry");
      return;
    }
    setError(null);
    if (dryRun.active) {
      setResult("stock");
      setMode("done");
      return;
    }
    startTransition(async () => {
      const res = await confirmSimpleDelivery({
        runId,
        productId,
        supplierId,
        quantity: Number(quantity),
        expiryChoice,
        storageChoice,
        noteEvidenceId,
        sources: { supplier: supplierSource, storage: storageSource, expiry: expirySource },
        executionContext: LIVE_EXECUTION_CONTEXT,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult(res.needsOwner ? "owner" : "stock");
      setMode("done");
    });
  }

  function saveRanOut() {
    setError(null);
    startTransition(async () => {
      const res = await reportRanOut({ runId, productId, sure: sureRanOut, executionContext: LIVE_EXECUTION_CONTEXT });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult("owner");
      setMode("done");
    });
  }

  function askOwner() {
    setError(null);
    startTransition(async () => {
      const res = await tellOwnerAboutStock({ runId, executionContext: LIVE_EXECUTION_CONTEXT });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult("owner");
      setMode("done");
    });
  }

  async function savePhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPhotoSaving(true);
    setNotePhotoName(file.name);
    setNoteEvidenceId(null);

    const formData = new FormData();
    formData.set("file", file);
    formData.set("evidenceType", "delivery_note");
    formData.set("sourceType", "operator_workflow_run");
    formData.set("sourceId", runId);
    formData.set("sourceRef", product?.name ?? "Delivery note");
    formData.set("operationId", runId);
    formData.set("executionMode", "live");

    const res = await uploadOperatorEvidence(formData);
    setPhotoSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNoteEvidenceId(res.id);
    setNotePhotoName(res.fileName);
    setMode(returnToReview ? "delivery-review" : "delivery-storage");
    setReturnToReview(false);
  }

  return (
    <div data-testid="operator-stock-flow">
      <TopLink />

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
        <Panel title={t("stock.whatHappened")}>
          <BigButton onClick={() => setMode("delivery-product")} label={t("stock.deliveryArrived")} tutorialTarget="stock-received" />
          <BigButton onClick={() => setMode("ranout-product")} label={t("stock.ranOut")} />
          <BigButton onClick={askOwner} label={t("stock.unsureTell")} muted busy={isPending} />
          <Link
            href="/operator/waste"
            className="flex min-h-[64px] items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-5 text-lg font-semibold text-[var(--muted)]"
          >
            {t("stock.threwAway")}
          </Link>
        </Panel>
      )}

      {mode === "delivery-product" && (
        <Panel title={t("stock.whatArrived")}>
          <ProductGrid products={effectiveProducts} onPick={(id) => chooseDeliveryProduct(id)} tutorialProduct="Lamb Leg Steaks" tutorialTarget="stock-product-lamb" />
          <BigButton onClick={() => chooseDeliveryProduct(null)} label={t("stock.somethingElse")} muted />
        </Panel>
      )}

      {mode === "delivery-amount" && (
        <Panel title={t("stock.howMuchArrived")} helper={product ? productName(product.name) : t("common.bestGuess")}>
          <AmountInput value={quantity} onChange={(value) => {
            setQuantity(value);
            if (dryRun.active && value === "12.5") {
              setSupplierId("dry-run-supplier");
              setStorageChoice("fridge");
              setSupplierSource("manual");
              setStorageSource("manual");
              setMode("delivery-expiry");
            }
          }} unit={unit} testId="operator-delivery-quantity" tutorialTarget="stock-weight" />
          <BigButton onClick={afterAmount} label={t("common.next")} disabled={Number(quantity) <= 0} />
        </Panel>
      )}

      {mode === "delivery-review" && (
        <Panel title={t("stock.looksRight")} helper={product ? productName(product.name) : undefined}>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-2" data-testid="delivery-review">
            <ReviewRow label={t("stock.review.amount")} value={operatorMeasure(quantity || "0", t(`unit.${unit}` as OperatorTranslationKey), locale)} />
            <ReviewRow label={t("stock.review.supplier")} value={supplier?.name ?? t("common.notSure")} onChange={() => changeFromReview("delivery-supplier")} />
            <ReviewRow
              label={t("stock.review.where")}
              value={storageChoice ? t(`stock.storage.${storageChoice}` as OperatorTranslationKey) : t("common.choose")}
              onChange={() => changeFromReview("delivery-storage")}
            />
            <ReviewRow
              label={t("stock.review.useBy")}
              value={expiryChoice ? t(`stock.expiry.${expiryChoice}` as OperatorTranslationKey) : t("common.choose")}
              onChange={() => changeFromReview("delivery-expiry")}
            />
            <ReviewRow
              label={t("stock.review.photo")}
              value={noteEvidenceId ? t("stock.review.added") : t("stock.review.none")}
              onChange={() => changeFromReview("delivery-photo")}
            />
          </div>
          <BigButton
            onClick={saveDelivery}
            label={t("stock.addDeliveryYes")}
            busy={isPending || !runId}
            disabled={!storageChoice || !expiryChoice}
          />
          <BigButton onClick={askOwner} label={t("stock.unsureTell")} muted busy={isPending} />
        </Panel>
      )}

      {mode === "delivery-supplier" && (
        <Panel title={t("stock.whoBrought")}>
          <div className="grid gap-3">
            {effectiveSuppliers.map((item) => (
              <BigButton key={item.id} onClick={() => pickSupplier(item.id)} label={item.name} />
            ))}
            <BigButton onClick={() => pickSupplier(null)} label={t("common.notSure")} muted />
          </div>
        </Panel>
      )}

      {mode === "delivery-photo" && (
        <Panel title={t("stock.deliveryPhoto")} helper={t("common.optional")}>
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
          <BigButton
            onClick={() => {
              setNotePhotoName(null);
              setNoteEvidenceId(null);
              setMode(dryRun.active ? "delivery-confirm" : returnToReview ? "delivery-review" : "delivery-storage");
              setReturnToReview(false);
            }}
            label={dryRun.active ? t("dryRun.addPracticePhoto") : returnToReview ? t("common.back") : t("common.skipNow")}
            muted
            tutorialTarget="stock-evidence"
          />
          {photoSaving ? <p className="text-base font-semibold text-[var(--muted)]">{t("common.savingPhoto")}</p> : null}
          {noteEvidenceId && notePhotoName ? <p className="text-base font-semibold text-[var(--muted)]">{t("common.photoSaved", { name: notePhotoName })}</p> : null}
        </Panel>
      )}

      {mode === "delivery-storage" && (
        <Panel title={t("stock.wherePut")}>
          {STORAGE_CHOICES.map((choice) => (
            <BigButton key={choice.id} onClick={() => pickStorage(choice.id)} label={t(`stock.storage.${choice.id}` as OperatorTranslationKey)} muted={choice.id === "not_sure"} />
          ))}
        </Panel>
      )}

      {mode === "delivery-expiry" && (
        <Panel title={t("stock.whenOff")}>
          {EXPIRY_CHOICES.map((choice) => (
            <BigButton key={choice.id} onClick={() => pickExpiry(choice.id)} label={t(`stock.expiry.${choice.id}` as OperatorTranslationKey)} muted={choice.id === "not_sure"} tutorialTarget={choice.id === "tomorrow" ? "stock-expiry" : undefined} />
          ))}
        </Panel>
      )}

      {mode === "delivery-confirm" && (
        <Panel title={t("stock.addDeliveryQuestion")}>
          <Summary
            lines={[
              product ? productName(product.name) : t("stock.productUnknown"),
              operatorMeasure(quantity || "0", t(`unit.${unit}` as OperatorTranslationKey), locale),
              supplier?.name ?? t("stock.supplierUnknown"),
              t("stock.location", { place: storageChoice ? t(`stock.storage.${storageChoice}` as OperatorTranslationKey) : t("common.notSure") }),
            ]}
          />
          <BigButton onClick={saveDelivery} label={t("stock.addDelivery")} busy={isPending || !runId} tutorialTarget="stock-confirm" />
        </Panel>
      )}

      {mode === "ranout-product" && (
        <Panel title={t("stock.whatRanOut")}>
          <ProductGrid products={products} onPick={(id) => { setProductId(id); setMode("ranout-sure"); }} />
          <BigButton onClick={() => { setProductId(null); setMode("ranout-sure"); }} label={t("stock.somethingElse")} muted />
        </Panel>
      )}

      {mode === "ranout-sure" && (
        <Panel title={t("stock.isEmpty")}>
          <BigButton onClick={() => { setSureRanOut(true); setMode("ranout-confirm"); }} label={t("common.yes")} />
          <BigButton onClick={() => { setSureRanOut(false); setMode("ranout-confirm"); }} label={t("common.notSure")} muted />
        </Panel>
      )}

      {mode === "ranout-confirm" && (
        <Panel title={t("stock.tellRanOut")}>
          <Summary lines={[product ? productName(product.name) : t("stock.productUnknown"), t(sureRanOut ? "stock.empty" : "stock.pleaseCheck")]} />
          <BigButton onClick={saveRanOut} label={t("common.tellOwner")} busy={isPending || !runId} />
        </Panel>
      )}

      {mode === "done" && (
        <Panel title={t(result === "stock" ? "stock.added" : "common.ownerWillCheck")}>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-white">
            <Check className="h-9 w-9" aria-hidden />
          </div>
          <BigButton onClick={() => restart("start")} label={t("stock.anotherJob")} />
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

function TopLink() {
  const { t } = useOperatorI18n();
  return (
    <Link href="/operator" className="mb-5 inline-flex min-h-[56px] items-center gap-2 text-lg font-semibold text-[var(--brand)]">
      <ArrowLeft className="operator-directional-icon h-6 w-6" aria-hidden />
      {t("common.back")}
    </Link>
  );
}

function Panel({ title, helper, children }: { title: string; helper?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-[var(--brand)] bg-[var(--card)] p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <Truck className="mt-1 h-8 w-8 shrink-0 text-[var(--brand)]" aria-hidden />
        <div>
          <h2 className="font-display text-3xl font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
          {helper ? <p className="mt-2 text-base leading-7 text-[var(--muted)]">{helper}</p> : null}
        </div>
      </div>
      <div className="mt-6 grid gap-3">{children}</div>
    </section>
  );
}

function BigButton({ label, onClick, muted, disabled, busy, tutorialTarget }: { label: string; onClick: () => void; muted?: boolean; disabled?: boolean; busy?: boolean; tutorialTarget?: string }) {
  const { t } = useOperatorI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
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

// One line of the delivery review: a remembered value with a one-tap way to correct it.
function ReviewRow({ label, value, onChange }: { label: string; value: string; onChange?: () => void }) {
  const { t } = useOperatorI18n();
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold uppercase tracking-wide text-[var(--faint)]">{label}</span>
        <span className="block text-lg font-semibold text-[var(--ink)]">{value}</span>
      </span>
      {onChange ? (
        <button
          type="button"
          onClick={onChange}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-2 text-base font-semibold text-[var(--brand)] transition active:scale-[0.99]"
        >
          <Pencil className="h-4 w-4" aria-hidden />
          {t("common.change")}
        </button>
      ) : null}
    </div>
  );
}

function ProductGrid({ products, onPick, tutorialProduct, tutorialTarget }: { products: ProductOption[]; onPick: (id: string) => void; tutorialProduct?: string; tutorialTarget?: string }) {
  const { product: productName } = useOperatorI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {products.slice(0, 12).map((product) => (
        <button
          key={product.id}
          type="button"
          onClick={() => onPick(product.id)}
          data-tutorial={product.name === tutorialProduct ? tutorialTarget : undefined}
          className="min-h-[88px] rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-start text-xl font-semibold text-[var(--ink)] transition active:scale-[0.99]"
        >
          {productName(product.name)}
        </button>
      ))}
    </div>
  );
}

function AmountInput({ value, onChange, unit, testId, tutorialTarget }: { value: string; onChange: (value: string) => void; unit: string; testId: string; tutorialTarget?: string }) {
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
          data-testid={testId}
          data-tutorial={tutorialTarget}
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

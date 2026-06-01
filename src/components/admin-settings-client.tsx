"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { updateBranchSettings, type AdminSettingsResult } from "@/app/actions/admin-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { renderReadySmsTemplate, validateReadySmsTemplate } from "@/lib/domain/sms";
import type { Branch, BranchSettings } from "@/lib/domain/types";

type Feedback = { tone: "ok" | "error"; message: string } | null;

const fakeOrder = {
  orderRef: "PTM-260601-0001",
};

export function AdminSettingsClient({ branch, settings }: { branch: Branch; settings: BranchSettings }) {
  const [isPending, startTransition] = useTransition();
  const [address, setAddress] = useState(branch.address);
  const [template, setTemplate] = useState(settings.smsReadyTemplate);
  const [cancellationWindow, setCancellationWindow] = useState(String(settings.cancellationWindowMinutes));
  const [feedback, setFeedback] = useState<Feedback>(null);

  const placeholderValidation = validateReadySmsTemplate(template);
  const preview = renderReadySmsTemplate({
    template,
    orderRef: fakeOrder.orderRef,
    address: address || "426 Birmingham Road",
  });

  function announce(result: AdminSettingsResult) {
    setFeedback(result.ok ? { tone: "ok", message: result.message } : { tone: "error", message: result.message });
  }

  return (
    <div>
      {feedback && (
        <div
          role="status"
          className={
            "mb-4 flex items-center gap-2 rounded-lg border p-3 text-sm " +
            (feedback.tone === "ok"
              ? "border-[#0f5132]/30 bg-[#e6efe9] text-[#0f5132]"
              : "border-[#f0c66e] bg-[#fff6df] text-[#5a3900]")
          }
        >
          {feedback.tone === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{feedback.message}</span>
        </div>
      )}

      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            announce(
              await updateBranchSettings({
                branchId: branch.id,
                address,
                smsReadyTemplate: template,
                cancellationWindowMinutes: Number(cancellationWindow),
              }),
            );
          });
        }}
      >
        <div className="grid gap-2">
          <label className="text-sm font-semibold" htmlFor="address">
            Address
          </label>
          <Input id="address" value={address} onChange={(event) => setAddress(event.target.value)} required />
        </div>
        <div className="grid gap-2">
          <label className="text-sm font-semibold" htmlFor="template">
            Ready SMS template
          </label>
          <Textarea id="template" value={template} onChange={(event) => setTemplate(event.target.value)} required />
          <p className="text-xs text-[#6c5e52]">Supported placeholders: {"{order_ref}"} and {"{address}"}.</p>
          {!placeholderValidation.ok && (
            <p className="text-sm font-semibold text-[#b42318]">
              Unsupported placeholder: {"{"}
              {placeholderValidation.unsupported[0]}
              {"}"}
            </p>
          )}
        </div>
        <section className="rounded-lg border border-[#ded6ca] bg-[#fbf8f3] p-4">
          <h2 className="text-sm font-black uppercase tracking-[0.08em] text-[#6c5e52]">Rendered preview</h2>
          <p className="mt-2 text-sm text-[#2b2118]">{preview}</p>
        </section>
        <div className="grid gap-2">
          <label className="text-sm font-semibold" htmlFor="window">
            Customer cancellation window minutes
          </label>
          <Input
            id="window"
            type="number"
            min="0"
            value={cancellationWindow}
            onChange={(event) => setCancellationWindow(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={isPending || !placeholderValidation.ok}>
          {isPending ? "Saving..." : "Save settings"}
        </Button>
      </form>
    </div>
  );
}

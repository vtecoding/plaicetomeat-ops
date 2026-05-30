import { BadgePoundSterling } from "lucide-react";

export function PayOnCollectionNote({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex gap-3 rounded-lg border border-[#badbc8] bg-[#eaf7ef] p-4 text-[#103d29]">
      <BadgePoundSterling className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div>
        <p className="font-bold">Pay at the counter on collection.</p>
        {!compact && (
          <p className="mt-1 text-sm text-[#315944]">
            No online payment is taken. Your total is checked by staff and paid through the shop till or card reader.
          </p>
        )}
      </div>
    </div>
  );
}

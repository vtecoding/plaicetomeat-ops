import { Clock3 } from "lucide-react";

import { demoPickupWindows } from "@/lib/data/demo";
import { findTodayCommuterWindow, isBeforeCutoff } from "@/lib/domain/pickup-windows";
import { formatTimeRange } from "@/lib/utils";

export function CountdownBanner() {
  const now = new Date();
  const commuterWindow = findTodayCommuterWindow(demoPickupWindows, now);

  if (!commuterWindow || !commuterWindow.cutoffTime) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[#d8d0c5] bg-white p-4 text-sm">
        <Clock3 className="h-5 w-5 text-[#0f5132]" aria-hidden />
        <span>Next available pickup windows are open for selection at checkout.</span>
      </div>
    );
  }

  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const beforeCutoff = isBeforeCutoff(currentTime, commuterWindow.cutoffTime);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#f0c66e] bg-[#fff6df] p-4 text-sm text-[#5a3900]">
      <Clock3 className="h-5 w-5 shrink-0" aria-hidden />
      <span>
        {beforeCutoff
          ? `Order before ${commuterWindow.cutoffTime} to collect on your drive home between ${formatTimeRange(
              commuterWindow.startTime,
              commuterWindow.endTime,
            )}.`
          : `Next available pickup: ${commuterWindow.label}, ${formatTimeRange(
              commuterWindow.startTime,
              commuterWindow.endTime,
            )}.`}
      </span>
    </div>
  );
}

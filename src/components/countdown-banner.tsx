import { Clock3 } from "lucide-react";

export function CountdownBanner() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#d8d0c5] bg-white p-4 text-sm">
      <Clock3 className="h-5 w-5 text-[#0f5132]" aria-hidden />
      <span>Next available pickup windows are shown at checkout from live shop settings.</span>
    </div>
  );
}

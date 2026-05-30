import type * as React from "react";

import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue";

const tones: Record<BadgeTone, string> = {
  neutral: "border-[#d8d0c5] bg-[#f7f3ed] text-[#4b4036]",
  green: "border-[#b7dcc8] bg-[#e8f6ee] text-[#0f5132]",
  amber: "border-[#f3d08a] bg-[#fff4d8] text-[#7a4b00]",
  red: "border-[#f1b5ad] bg-[#fff0ee] text-[#9f2318]",
  blue: "border-[#b8d5ef] bg-[#edf6ff] text-[#174e78]",
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

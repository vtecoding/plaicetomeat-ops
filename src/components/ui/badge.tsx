import type * as React from "react";

import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue";

const tones: Record<BadgeTone, string> = {
  neutral: "border-[#ded4c4] bg-[#f4eee2] text-[#5b4f43]",
  green: "border-[#bfe0cd] bg-[#e8f4ed] text-[var(--brand)]",
  amber: "border-[#eccb85] bg-[#fbf1da] text-[#7a4f0b]",
  red: "border-[#e7b3a7] bg-[#fbeee9] text-[#993322]",
  blue: "border-[#b6d2ec] bg-[#eef5fc] text-[#1a4d76]",
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

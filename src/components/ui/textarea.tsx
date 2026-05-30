import type * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full rounded-md border border-[#cfc7bb] bg-white px-3 py-2 text-sm text-[#231f20] outline-none transition focus:border-[#0f5132] focus:ring-2 focus:ring-[#0f5132]/15",
        className,
      )}
      {...props}
    />
  );
}

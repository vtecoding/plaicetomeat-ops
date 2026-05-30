import type * as React from "react";

import { cn } from "@/lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-md border border-[#cfc7bb] bg-white px-3 text-sm text-[#231f20] outline-none transition focus:border-[#0f5132] focus:ring-2 focus:ring-[#0f5132]/15",
        className,
      )}
      {...props}
    />
  );
}

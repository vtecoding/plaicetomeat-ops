import type * as React from "react";

import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-[#ded6ca] bg-white p-5 shadow-sm", className)}
      {...props}
    />
  );
}

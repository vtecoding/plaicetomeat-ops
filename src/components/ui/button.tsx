import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#0f5132] text-white hover:bg-[#0b3d26] focus-visible:outline-[#0f5132]",
        secondary: "bg-[#f4efe7] text-[#231f20] hover:bg-[#ebe2d5] focus-visible:outline-[#826f4a]",
        outline: "border border-[#cfc7bb] bg-white text-[#231f20] hover:bg-[#f7f3ed] focus-visible:outline-[#826f4a]",
        destructive: "bg-[#b42318] text-white hover:bg-[#8f1d15] focus-visible:outline-[#b42318]",
        ghost: "text-[#231f20] hover:bg-[#f4efe7] focus-visible:outline-[#826f4a]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-5 text-base",
        icon: "h-10 w-10 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };

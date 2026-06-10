import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-[transform,background-color,box-shadow,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Tactile primary: an inner top highlight + a soft coloured drop shadow give the
        // button real depth instead of a flat fill.
        default:
          "bg-[var(--brand)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_-12px_rgba(15,81,50,0.6)] hover:bg-[var(--brand-700)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_14px_26px_-12px_rgba(15,81,50,0.62)]",
        secondary:
          "bg-[var(--cream)] text-[var(--ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] hover:bg-[#ece2d2]",
        outline:
          "border border-[var(--line-strong)] bg-[var(--card)] text-[var(--ink)] shadow-[0_1px_0_rgba(255,255,255,0.6)] hover:border-[var(--brand)] hover:text-[var(--brand)] hover:bg-[var(--brand-50)]",
        destructive:
          "bg-[var(--clay)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_-12px_rgba(166,64,43,0.6)] hover:bg-[#8c3322]",
        ghost: "text-[var(--ink)] hover:bg-[var(--cream)]",
      },
      size: {
        sm: "h-8 gap-1.5 rounded-md px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 rounded-xl px-6 text-base",
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

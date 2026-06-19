"use client";

import { cn } from "@/lib/utils/cn";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "font-medium select-none transition-[background,border,color,transform]",
    "duration-150 ease-[var(--ease-product)]",
    "disabled:pointer-events-none disabled:opacity-40",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "bg-[var(--accent)] text-[var(--accent-fg)] border border-transparent",
          "hover:brightness-110 active:translate-y-[0.5px]",
          "shadow-[0_1px_0_oklch(100%_0_0/0.06)_inset,0_1px_2px_oklch(0%_0_0/0.18)]",
        ].join(" "),
        secondary: [
          "bg-[var(--surface)] text-[var(--fg)] border border-[var(--border-strong)]",
          "hover:bg-[var(--surface-hover)] active:translate-y-[0.5px]",
        ].join(" "),
        ghost: [
          "bg-transparent text-[var(--fg)] border border-transparent",
          "hover:bg-[var(--surface-hover)]",
        ].join(" "),
        soft: [
          "bg-[var(--surface-muted)] text-[var(--fg)] border border-transparent",
          "hover:bg-[var(--surface-hover)]",
        ].join(" "),
        link: "bg-transparent text-[var(--fg-muted)] hover:text-[var(--fg)] border-0 px-0",
      },
      size: {
        sm: "h-8 px-3 text-[13px] rounded-[var(--radius-sm)]",
        md: "h-9 px-3.5 text-[14px] rounded-[var(--radius-md)]",
        lg: "h-11 px-5 text-[15px] rounded-[var(--radius-md)]",
        icon: "h-9 w-9 rounded-[var(--radius-md)]",
        iconSm: "h-7 w-7 rounded-[var(--radius-sm)]",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

export { buttonVariants };

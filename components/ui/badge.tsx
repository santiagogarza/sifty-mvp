import { cn } from "@/lib/utils/cn";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border text-[11px] font-medium leading-none px-2 py-0.5",
  {
    variants: {
      tone: {
        neutral: "bg-[var(--surface-muted)] border-[var(--border)] text-[var(--fg-muted)]",
        ember: "bg-[var(--accent-soft)] border-transparent text-[var(--accent)]",
        mist: "bg-[var(--ai-soft)] border-transparent text-[var(--ai)]",
        sage: "bg-[oklch(94%_0.02_160)] dark:bg-[oklch(20%_0.02_160)] border-transparent text-[var(--done)]",
        rose: "bg-[oklch(95%_0.02_18)] dark:bg-[oklch(22%_0.02_18)] border-transparent text-[var(--warn)]",
        violet:
          "bg-[oklch(94%_0.025_290)] dark:bg-[oklch(22%_0.03_290)] border-transparent text-[oklch(56%_0.18_290)]",
        sand: "bg-[oklch(95%_0.02_70)] dark:bg-[oklch(22%_0.015_70)] border-transparent text-[var(--fg-muted)]",
      },
      variant: {
        soft: "",
        outline: "bg-transparent border-[var(--border-strong)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
      variant: "soft",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, variant }), className)} {...props} />;
}

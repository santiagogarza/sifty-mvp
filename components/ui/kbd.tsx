import { cn } from "@/lib/utils/cn";
import * as React from "react";

export function Kbd({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-[20px] items-center justify-center rounded-[4px]",
        "border border-[var(--border-strong)] bg-[var(--surface-muted)]",
        "px-1 font-mono text-[10.5px] text-[var(--fg-muted)]",
        "shadow-[0_1px_0_var(--border)]",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}

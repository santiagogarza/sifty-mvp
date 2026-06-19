import { cn } from "@/lib/utils/cn";
import * as React from "react";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, type = "text", ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-strong)]",
        "bg-[var(--surface)] px-3 text-[14px] text-[var(--fg)]",
        "placeholder:text-[var(--fg-subtle)]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        "focus:outline-none focus:border-[var(--border-focus)]",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        "w-full rounded-[var(--radius-md)] border border-[var(--border-strong)]",
        "bg-[var(--surface)] px-3 py-2 text-[14px] leading-[1.5] text-[var(--fg)]",
        "placeholder:text-[var(--fg-subtle)]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        "focus:outline-none focus:border-[var(--border-focus)]",
        "disabled:opacity-50",
        "resize-none",
        className,
      )}
      {...props}
    />
  );
});

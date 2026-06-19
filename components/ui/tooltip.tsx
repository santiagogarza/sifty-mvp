"use client";

import { cn } from "@/lib/utils/cn";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 select-none rounded-[var(--radius-sm)] px-2 py-1",
          "bg-[var(--fg)] text-[var(--bg)] text-[11.5px] font-medium",
          "shadow-[0_4px_18px_-6px_oklch(0%_0_0/0.4)]",
          "data-[state=delayed-open]:animate-fade-in",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

export interface TooltipProps {
  label: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  shortcut?: string;
}

export function Tooltip({ label, children, side = "bottom", shortcut }: TooltipProps) {
  return (
    <TooltipRoot delayDuration={250}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>
        <span className="flex items-center gap-1.5">
          <span>{label}</span>
          {shortcut ? <span className="font-mono opacity-70 text-[10.5px]">{shortcut}</span> : null}
        </span>
      </TooltipContent>
    </TooltipRoot>
  );
}

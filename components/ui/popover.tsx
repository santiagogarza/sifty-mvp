"use client";

import { cn } from "@/lib/utils/cn";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, align = "start", sideOffset = 6, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[200px] rounded-[var(--radius-lg)] border border-[var(--border-strong)]",
          "bg-[var(--bg-elevated)] p-1.5 shadow-[0_20px_40px_-15px_oklch(0%_0_0/0.5)]",
          "data-[state=open]:animate-rise",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});

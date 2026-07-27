"use client";

import { cn } from "@/lib/utils/cn";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";

/**
 * Sheet — a side panel that slides from the right on desktop and from the
 * bottom on mobile. Built on Radix Dialog so focus trap and a11y are free.
 */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function SheetOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]",
        "data-[state=open]:animate-fade-in",
        className,
      )}
      {...props}
    />
  );
});

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function SheetContent({ className, children, ...props }, ref) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed z-50",
          "left-0 right-0 bottom-0 max-h-[88dvh] rounded-t-[var(--radius-xl)]",
          "sm:left-auto sm:bottom-0 sm:top-0 sm:right-0 sm:max-h-none sm:rounded-t-none sm:rounded-l-[var(--radius-xl)]",
          "sm:w-[min(560px,90vw)]",
          "border-t sm:border-t-0 sm:border-l border-[var(--border-strong)]",
          "bg-[var(--bg-elevated)]",
          "shadow-[-40px_0_80px_-30px_oklch(0%_0_0/0.4)]",
          "data-[state=open]:animate-rise",
          "flex flex-col overflow-hidden",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function SheetTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-[15px] font-medium tracking-[-0.01em]", className)}
      {...props}
    />
  );
});

export const SheetDescription = DialogPrimitive.Description;

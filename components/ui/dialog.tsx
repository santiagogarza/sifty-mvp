"use client";

import { cn } from "@/lib/utils/cn";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
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

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    placement?: "center" | "top";
  }
>(function DialogContent({ className, children, placement = "top", ...props }, ref) {
  const placementClass =
    placement === "top"
      ? "top-[14vh] left-1/2 -translate-x-1/2"
      : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2";
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed z-50 w-[min(640px,calc(100vw-32px))]",
          placementClass,
          "rounded-[var(--radius-xl)] border border-[var(--border-strong)] bg-[var(--bg-elevated)]",
          "shadow-[0_30px_60px_-15px_oklch(0%_0_0/0.5),0_0_0_1px_oklch(100%_0_0/0.02)_inset]",
          "data-[state=open]:animate-rise",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 px-5 pt-5 pb-2", className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-[15px] font-medium tracking-[-0.01em] text-[var(--fg)]", className)}
      {...props}
    />
  );
});

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-[13px] leading-[1.55] text-[var(--fg-muted)]", className)}
      {...props}
    />
  );
});

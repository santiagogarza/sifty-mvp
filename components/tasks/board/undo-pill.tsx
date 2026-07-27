"use client";

import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils/cn";
import * as React from "react";

export type UndoPillState = "undo" | "saved-locally";

/**
 * Quiet confirmation after a board move. Holds Undo for 6s, or switches to
 * the honest "Saved locally" copy when the push hasn't reached the server.
 * Shares the bottom-center slot with AppFrame's sync-error pill via z-index
 * stacking (undo sits above; they never both claim equal priority).
 */
export function UndoPill({
  message,
  state = "undo",
  onUndo,
  className,
}: {
  message: string;
  state?: UndoPillState;
  onUndo?: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-[92px] md:bottom-4 left-1/2 -translate-x-1/2 z-50",
        "flex items-center gap-2 rounded-full border border-[var(--border)]",
        "bg-[var(--bg-elevated)]/95 backdrop-blur pl-3.5 pr-2 py-[7px]",
        "text-[13px] text-[var(--fg)] shadow-[0_30px_60px_-15px_oklch(0%_0_0/0.5)]",
        "animate-fade-in",
        className,
      )}
    >
      <span className="whitespace-nowrap">{message}</span>
      {state === "undo" && onUndo ? (
        <>
          <button
            type="button"
            onClick={onUndo}
            className="font-medium text-[var(--accent)] hover:opacity-90 whitespace-nowrap"
          >
            Undo
          </button>
          <Kbd>⌘Z</Kbd>
        </>
      ) : null}
    </div>
  );
}

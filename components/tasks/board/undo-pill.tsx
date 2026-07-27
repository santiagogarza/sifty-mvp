"use client";

import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils/cn";
import * as React from "react";

/**
 * The quiet pill after a drop: names the destination and holds Undo for a
 * 6s window, then retires itself. Reversibility is what makes dragging feel
 * physical instead of consequential (loss aversion — a wrong drop costs
 * nothing).
 *
 * `raised` lifts it above the app-level sync-error pill, which owns the
 * same bottom-center slot — a shared stacking rule instead of a collision.
 */
export function UndoPill({
  message,
  onUndo,
  raised,
}: {
  message: string;
  onUndo: () => void;
  raised: boolean;
}) {
  return (
    <div
      role="status"
      className={cn(
        "fixed left-1/2 -translate-x-1/2 z-40",
        raised ? "bottom-[136px] md:bottom-[52px]" : "bottom-[92px] md:bottom-4",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-[var(--border)]",
          "bg-[var(--bg-elevated)]/95 backdrop-blur pl-3.5 pr-2 py-1.5",
          "shadow-[0_8px_24px_-6px_oklch(0%_0_0/0.35)] animate-rise",
        )}
      >
        <span className="whitespace-nowrap text-[13px] text-[var(--fg)]">{message}</span>
        <button
          type="button"
          onClick={onUndo}
          className="text-[13px] font-medium text-[var(--accent)] hover:underline"
        >
          Undo
        </button>
        <Kbd className="hidden md:inline-flex">⌘Z</Kbd>
      </div>
    </div>
  );
}

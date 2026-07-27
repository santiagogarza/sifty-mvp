"use client";

import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils/cn";
import * as React from "react";

const HINT_STORAGE_KEY = "sifty.board.keyboard-hint-seen";

/**
 * One-time lesson for the board keyboard model. Retires after the first
 * successful keyboard move so chrome doesn't become permanent.
 */
export function BoardKeyboardHint({
  visible,
  className,
}: {
  visible: boolean;
  className?: string;
}) {
  if (!visible) return null;
  return (
    <div
      className={cn(
        "hidden md:flex items-center gap-2 text-[12px] text-[var(--fg-muted)]",
        className,
      )}
    >
      <Kbd>←</Kbd>
      <Kbd>→</Kbd>
      <span>columns</span>
      <span className="text-[var(--fg-subtle)]">·</span>
      <Kbd>⇧</Kbd>
      <Kbd>←</Kbd>
      <Kbd>→</Kbd>
      <span>file</span>
      <span className="text-[var(--fg-subtle)]">·</span>
      <Kbd>j</Kbd>
      <Kbd>k</Kbd>
      <span>within</span>
    </div>
  );
}

export function readHintSeen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(HINT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markHintSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HINT_STORAGE_KEY, "1");
  } catch {
    // private mode / quota
  }
}

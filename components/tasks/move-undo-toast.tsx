"use client";

import { Kbd } from "@/components/ui/kbd";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { Check } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

/** How long a move stays undoable. */
export const UNDO_WINDOW_MS = 6000;
const RETIRE_MS = 240;

/**
 * Post-move confirmation with Undo — the same pill shape and position as
 * the app frame's offline notice, lifted one row when that notice shows.
 * Portaled to <body> so its fixed position is always the viewport's.
 *
 * Screen readers hear the move from the board's own live region; this pill
 * is the visible, clickable half. Hovering or focusing it holds the timer,
 * and leaving restarts the full window, so reaching for Undo never races it.
 */
export function MoveUndoToast({
  moveKey,
  to,
  lifted,
  onUndo,
  onExpire,
}: {
  /** Changes on every move, restarting the timer and the entrance. */
  moveKey: number;
  to: Lifecycle;
  lifted: boolean;
  onUndo: () => void;
  onExpire: () => void;
}) {
  const [retiring, setRetiring] = React.useState(false);
  const [held, setHeld] = React.useState(false);
  const onExpireRef = React.useRef(onExpire);
  onExpireRef.current = onExpire;

  // biome-ignore lint/correctness/useExhaustiveDependencies: moveKey is the restart signal.
  React.useEffect(() => {
    if (held) return;
    setRetiring(false);
    const retire = setTimeout(() => setRetiring(true), UNDO_WINDOW_MS);
    const expire = setTimeout(() => onExpireRef.current(), UNDO_WINDOW_MS + RETIRE_MS);
    return () => {
      clearTimeout(retire);
      clearTimeout(expire);
    };
  }, [moveKey, held]);

  return createPortal(
    <div
      key={moveKey}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={cn(
        "fixed left-1/2 z-40 -translate-x-1/2",
        lifted ? "bottom-[132px] md:bottom-14" : "bottom-[92px] md:bottom-4",
        "flex items-center gap-2.5 rounded-full border bg-[var(--bg-elevated)]/95 backdrop-blur",
        "py-1 pl-3.5 pr-1.5 text-[12px] text-[var(--fg-muted)] shadow-sm",
        retiring ? "animate-retire pointer-events-none" : "animate-rise",
      )}
    >
      <Check size={13} className="text-[var(--done)]" strokeWidth={2.5} aria-hidden />
      <span>
        Moved to <span className="text-[var(--fg)]">{statusLabel(to)}</span>
      </span>
      <button
        type="button"
        onClick={onUndo}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-[var(--fg)]",
          "transition-colors duration-150 ease-[var(--ease-product)] hover:bg-[var(--surface-hover)]",
        )}
      >
        Undo
        <Kbd className="hidden h-4 min-w-0 px-1 text-[10px] sm:inline-flex">⌘Z</Kbd>
      </button>
    </div>,
    document.body,
  );
}

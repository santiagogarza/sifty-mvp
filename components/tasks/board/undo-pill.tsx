"use client";

import { Toast } from "@/components/app-shell/toast-stack";
import { Kbd } from "@/components/ui/kbd";
import { statusLabel } from "@/lib/domain/status";
import * as React from "react";
import type { PendingMove } from "./use-board-move";

/**
 * Names the destination and holds Undo for six seconds, then retires
 * itself. Reversibility is what makes the first drag cheap to try;
 * without it people hover and give up.
 *
 * A move that hasn't reached the server keeps its card where the user put
 * it and says so. Sifty's dirty ledger guarantees the move replays, so
 * snapping the card back would discard an intent the app is committed to
 * delivering.
 */
export function UndoPill({ move, onUndo }: { move: PendingMove; onUndo: () => void }) {
  return (
    <Toast>
      <div
        role="status"
        className="animate-rise flex items-center gap-2 rounded-full border border-[var(--border)]
        bg-[var(--bg-elevated)]/95 px-3.5 py-1.5 text-[12px] text-[var(--fg-muted)]
        shadow-sm backdrop-blur"
      >
        <span>
          Moved to <span className="text-[var(--fg)]">{statusLabel(move.to)}</span>
        </span>
        <span className="text-[var(--border-strong)]">·</span>
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex items-center gap-1.5 text-[var(--fg)] hover:text-[var(--accent)]
          transition-colors"
        >
          Undo
          <Kbd>⌘Z</Kbd>
        </button>
        {move.savedLocally ? (
          <>
            <span className="text-[var(--border-strong)]">·</span>
            <span>Saved locally — Sifty will sync it</span>
          </>
        ) : null}
      </div>
    </Toast>
  );
}

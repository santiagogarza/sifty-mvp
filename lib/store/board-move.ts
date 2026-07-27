"use client";

import type { Lifecycle } from "@/lib/domain/types";
import { create } from "zustand";

/**
 * The last board move, held just long enough to offer an Undo.
 *
 * This is deliberately a tiny store of its own rather than board-local state:
 * the Undo pill lives in `AppFrame`'s single bottom-center dock (so it can
 * never collide with the sync-error pill), while moves originate in the board.
 * A store is the seam between the two without prop-drilling through the frame.
 *
 * We capture the *previous* `lifecycle` and `completedAt` so undo restores the
 * task exactly — including the `completedAt` timestamp, the one field a move
 * can silently corrupt when a card leaves and re-enters Done.
 */
export interface PendingMove {
  /** Monotonic token: bumping it restarts the pill's countdown and effects. */
  token: number;
  taskId: string;
  taskTitle: string;
  toLifecycle: Lifecycle;
  toLabel: string;
  fromLifecycle: Lifecycle;
  fromCompletedAt: string | null;
  at: number;
}

interface BoardMoveState {
  pending: PendingMove | null;
  record: (move: Omit<PendingMove, "token" | "at">) => void;
  /** Clear the pill. Pass a token to clear only if it still matches (timers). */
  clear: (token?: number) => void;
}

let seq = 0;

export const useBoardMove = create<BoardMoveState>((set) => ({
  pending: null,
  record: (move) => set({ pending: { ...move, token: ++seq, at: Date.now() } }),
  clear: (token) =>
    set((s) => (token === undefined || s.pending?.token === token ? { pending: null } : s)),
}));

"use client";

import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { getSyncHooks, useStore } from "@/lib/store/store";
import * as React from "react";

/**
 * Filing a card, and taking it back.
 *
 * A move writes one field — `lifecycle` — through the store's ordinary
 * optimistic path, so the board is bounded by a re-render rather than a
 * round trip. Undo is another ordinary move, not a rollback: it syncs and
 * survives a refresh like any other edit.
 *
 * `completedAt` is the one thing a move can silently corrupt. `updateTask`
 * owns it whenever `lifecycle` is in the patch — stamping it on entry to
 * done and clearing it on exit — so undoing a move that started in done
 * restores the original timestamp in a second, lifecycle-free patch
 * rather than leaving a task "completed" at the moment it was un-filed.
 */

/** How long Undo stays on offer. */
export const UNDO_WINDOW_MS = 6000;

export interface PendingMove {
  taskId: string;
  title: string;
  to: Lifecycle;
  from: Lifecycle;
  fromCompletedAt: string | null;
  /** The move reached the store but not the server. */
  savedLocally: boolean;
}

export interface BoardMoveApi {
  pending: PendingMove | null;
  /** Reads to a polite live region; empty until the first move. */
  announcement: string;
  move: (task: Task, to: Lifecycle) => void;
  undo: () => void;
  dismiss: () => void;
}

export function useBoardMove(): BoardMoveApi {
  const updateTask = useStore((s) => s.updateTask);
  const [pending, setPending] = React.useState<PendingMove | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every move gets a ticket so a late sync answer can't reopen a pill
  // that has already retired, or label the wrong move as unsynced.
  const ticketRef = React.useRef(0);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  React.useEffect(() => clearTimer, [clearTimer]);

  const dismiss = React.useCallback(() => {
    clearTimer();
    ticketRef.current += 1;
    setPending(null);
  }, [clearTimer]);

  const apply = React.useCallback(
    (task: Task, to: Lifecycle, restoreCompletedAt: string | null | undefined) => {
      updateTask(task.id, { lifecycle: to });
      if (to === "done" && restoreCompletedAt) {
        updateTask(task.id, { completedAt: restoreCompletedAt });
      }
    },
    [updateTask],
  );

  const move = React.useCallback(
    (task: Task, to: Lifecycle) => {
      if (task.lifecycle === to) return;
      clearTimer();
      ticketRef.current += 1;
      const ticket = ticketRef.current;

      apply(task, to, null);

      const next: PendingMove = {
        taskId: task.id,
        title: task.title,
        to,
        from: task.lifecycle,
        fromCompletedAt: task.completedAt,
        savedLocally: false,
      };
      setPending(next);
      setAnnouncement(`${task.title} moved to ${statusLabel(to)}. Press Command Z to undo.`);

      timerRef.current = setTimeout(() => {
        setPending((p) => (p?.taskId === next.taskId ? null : p));
      }, UNDO_WINDOW_MS);

      // Honesty about where the move actually is. The dirty ledger
      // guarantees it replays, so the card stays put either way.
      const hooks = getSyncHooks();
      if (!hooks) return;
      void hooks.waitForTask(task.id).then(() => {
        if (ticketRef.current !== ticket || !hooks.isTaskDirty(task.id)) return;
        setPending((p) => (p && p.taskId === next.taskId ? { ...p, savedLocally: true } : p));
      });
    },
    [apply, clearTimer],
  );

  const undo = React.useCallback(() => {
    const current = pending;
    if (!current) return;
    const task = useStore.getState().tasks.find((t) => t.id === current.taskId);
    dismiss();
    if (!task) return;
    apply(task, current.from, current.fromCompletedAt);
    setAnnouncement(`${current.title} moved back to ${statusLabel(current.from)}.`);
  }, [apply, dismiss, pending]);

  return { pending, announcement, move, undo, dismiss };
}

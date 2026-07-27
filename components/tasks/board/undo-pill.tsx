"use client";

import { Kbd } from "@/components/ui/kbd";
import { useBoardMove } from "@/lib/store/board-move";
import { getSyncHooks, useStore } from "@/lib/store/store";
import * as React from "react";

/**
 * The Undo affordance for the last board move.
 *
 * Rendered once, globally, inside `AppFrame`'s bottom-center dock (so it
 * shares a stacking context with the sync-error pill instead of fighting it
 * for the same fixed slot). It reads the pending move from `useBoardMove`,
 * offers Undo for a fixed window, then retires itself.
 *
 * A failed sync does not roll the card back — Sifty's dirty ledger already
 * guarantees the move replays. When the push hasn't reached the server the
 * pill says so ("Saved locally"), using `waitForTask` + `isTaskDirty` as the
 * signal — same honesty, no data loss.
 */
const UNDO_WINDOW_MS = 6000;

export function UndoPill() {
  const pending = useBoardMove((s) => s.pending);
  const clear = useBoardMove((s) => s.clear);
  const updateTask = useStore((s) => s.updateTask);
  const [savedLocally, setSavedLocally] = React.useState(false);

  React.useEffect(() => {
    if (!pending) return;
    setSavedLocally(false);
    const { token } = pending;
    const timer = setTimeout(() => clear(token), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [pending, clear]);

  React.useEffect(() => {
    if (!pending) return;
    const hooks = getSyncHooks();
    if (!hooks) return;
    let cancelled = false;
    void hooks.waitForTask(pending.taskId).then(() => {
      if (!cancelled && hooks.isTaskDirty(pending.taskId)) setSavedLocally(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pending]);

  const undo = React.useCallback(() => {
    if (!pending) return;
    updateTask(pending.taskId, { lifecycle: pending.fromLifecycle });
    if (pending.fromLifecycle === "done") {
      // Entering Done stamps a fresh completedAt; restore the original so a
      // card that round-trips through Done keeps its real completion time.
      updateTask(pending.taskId, { completedAt: pending.fromCompletedAt });
    }
    clear(pending.token);
  }, [pending, updateTask, clear]);

  React.useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, undo]);

  if (!pending) return null;

  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 px-3.5 py-1.5 text-[12px] text-[var(--fg-muted)] shadow-[0_8px_24px_-12px_oklch(0%_0_0/0.5)] backdrop-blur"
    >
      <span>
        {savedLocally ? "Saved locally — Sifty will sync it" : `Moved to ${pending.toLabel}`}
      </span>
      <button
        type="button"
        onClick={undo}
        className="font-medium text-[var(--accent)] hover:brightness-110"
      >
        Undo
      </button>
      <Kbd>⌘Z</Kbd>
    </div>
  );
}

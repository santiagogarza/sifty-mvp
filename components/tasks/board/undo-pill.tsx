"use client";

import { Button } from "@/components/ui/button";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";

export type MoveSyncState = "saving" | "saved" | "local";

export interface BoardMove {
  id: string;
  taskId: string;
  title: string;
  from: Lifecycle;
  to: Lifecycle;
  completedAt: string | null;
  syncState: MoveSyncState;
}

export function UndoPill({
  move,
  onUndoIntent,
  onUndo,
}: {
  move: BoardMove | null;
  onUndoIntent: () => void;
  onUndo: () => void;
}) {
  if (!move) return null;
  const stateText =
    move.syncState === "local" ? "Saved locally" : move.syncState === "saved" ? "Saved" : "Saving";

  return (
    <div
      role="status"
      className={cn(
        "fixed bottom-[140px] left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3",
        "rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 px-3 py-1.5 text-[12px]",
        "text-[var(--fg-muted)] shadow-[0_12px_32px_-18px_oklch(0%_0_0/0.55)] backdrop-blur md:bottom-14",
      )}
    >
      <span className="truncate">
        {stateText} · moved to {statusLabel(move.to)}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-[12px]"
        onPointerDown={onUndoIntent}
        onClick={onUndo}
      >
        Undo
      </Button>
    </div>
  );
}

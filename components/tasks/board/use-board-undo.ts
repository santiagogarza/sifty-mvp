"use client";

import * as React from "react";

const UNDO_WINDOW_MS = 6000;

export interface UndoMove {
  taskId: string;
  prevLifecycle: import("@/lib/domain/types").Lifecycle;
  prevCompletedAt: string | null;
}

export function useBoardUndo(onUndo: (move: UndoMove) => void) {
  const [undoMove, setUndoMove] = React.useState<UndoMove | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearUndo = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setUndoMove(null);
  }, []);

  const registerMove = React.useCallback(
    (move: UndoMove) => {
      clearUndo();
      setUndoMove(move);
      timerRef.current = setTimeout(clearUndo, UNDO_WINDOW_MS);
    },
    [clearUndo],
  );

  const handleUndo = React.useCallback(() => {
    if (!undoMove) return;
    onUndo(undoMove);
    clearUndo();
  }, [undoMove, onUndo, clearUndo]);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { undoMove, registerMove, handleUndo, clearUndo };
}

export { UNDO_WINDOW_MS };

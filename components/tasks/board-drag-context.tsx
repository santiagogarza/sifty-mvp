"use client";

import * as React from "react";

const BoardDragContext = React.createContext<{
  suppressClickForTask: (taskId: string) => void;
  shouldSuppressClick: (taskId: string) => boolean;
}>({
  suppressClickForTask: () => {},
  shouldSuppressClick: () => false,
});

export function BoardDragProvider({ children }: { children: React.ReactNode }) {
  const suppressedRef = React.useRef<string | null>(null);

  const suppressClickForTask = React.useCallback((taskId: string) => {
    suppressedRef.current = taskId;
  }, []);

  const shouldSuppressClick = React.useCallback((taskId: string) => {
    if (suppressedRef.current !== taskId) return false;
    suppressedRef.current = null;
    return true;
  }, []);

  const value = React.useMemo(
    () => ({ suppressClickForTask, shouldSuppressClick }),
    [suppressClickForTask, shouldSuppressClick],
  );

  return <BoardDragContext.Provider value={value}>{children}</BoardDragContext.Provider>;
}

export function useBoardDragGuard() {
  return React.useContext(BoardDragContext);
}

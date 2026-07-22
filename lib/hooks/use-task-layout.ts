"use client";

import * as React from "react";

export type TaskLayout = "list" | "board";

const STORAGE_KEY = "sifty-task-layout-v1";

export function useTaskLayout(): [TaskLayout, (layout: TaskLayout) => void] {
  const [layout, setLayoutState] = React.useState<TaskLayout>("list");
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "list" || stored === "board") {
        setLayoutState(stored);
      }
    } catch {
      // localStorage may be unavailable in private browsing.
    }
    setReady(true);
  }, []);

  const setLayout = React.useCallback((next: TaskLayout) => {
    setLayoutState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore write failures.
    }
  }, []);

  // Avoid flashing list before hydration reads localStorage.
  return [ready ? layout : "list", setLayout];
}

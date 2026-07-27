"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

export type TaskViewMode = "list" | "board";

const VIEW_PARAM = "view";

function isTaskViewMode(value: string | null): value is TaskViewMode {
  return value === "list" || value === "board";
}

function storageKey(pathname: string): string {
  return `sifty.view.${pathname}`;
}

export function useBoardMode(): {
  mode: TaskViewMode;
  setMode: (mode: TaskViewMode) => void;
} {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const search = useSearchParams();
  const viewParam = search.get(VIEW_PARAM);
  const [storedMode, setStoredMode] = React.useState<TaskViewMode>("list");

  React.useEffect(() => {
    try {
      const next = window.localStorage.getItem(storageKey(pathname));
      setStoredMode(isTaskViewMode(next) ? next : "list");
    } catch {
      setStoredMode("list");
    }
  }, [pathname]);

  const mode = isTaskViewMode(viewParam) ? viewParam : storedMode;

  const setMode = React.useCallback(
    (nextMode: TaskViewMode) => {
      try {
        window.localStorage.setItem(storageKey(pathname), nextMode);
      } catch {
        // View mode remains shareable through the URL when storage is blocked.
      }
      const params = new URLSearchParams(search.toString());
      params.set(VIEW_PARAM, nextMode);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      setStoredMode(nextMode);
    },
    [pathname, router, search],
  );

  React.useEffect(() => {
    if (!isTaskViewMode(viewParam)) return;
    try {
      window.localStorage.setItem(storageKey(pathname), viewParam);
    } catch {
      // Non-critical preference persistence.
    }
    setStoredMode(viewParam);
  }, [pathname, viewParam]);

  return { mode, setMode };
}

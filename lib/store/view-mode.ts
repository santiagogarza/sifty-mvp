"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

/**
 * List | Board mode for task views.
 *
 * The `?view=` URL param is the session source of truth — shareable links
 * and the back button behave; `localStorage` (keyed per route, mirroring
 * the `sifty.theme` pattern) carries the remembered preference across
 * visits. List stays the default: the board is opt-in.
 */

export type TaskViewMode = "list" | "board";

const PARAM = "view";

function storageKey(pathname: string): string {
  return `sifty.view.${pathname}`;
}

function parseMode(value: string | null): TaskViewMode | null {
  return value === "board" || value === "list" ? value : null;
}

function readStored(pathname: string): TaskViewMode | null {
  if (typeof window === "undefined") return null;
  try {
    return parseMode(window.localStorage.getItem(storageKey(pathname)));
  } catch {
    return null;
  }
}

export function useTaskViewMode(): [TaskViewMode, (mode: TaskViewMode) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const fromParam = parseMode(search.get(PARAM));

  // The stored preference applies only after mount so the server render
  // (which can't read localStorage) never mismatches hydration.
  const [stored, setStored] = React.useState<TaskViewMode | null>(null);
  React.useEffect(() => {
    setStored(readStored(pathname));
  }, [pathname]);

  const mode = fromParam ?? stored ?? "list";

  const setMode = React.useCallback(
    (next: TaskViewMode) => {
      try {
        window.localStorage.setItem(storageKey(pathname), next);
      } catch {
        // Quota/private-mode failures degrade to session-only memory.
      }
      setStored(next);
      const params = new URLSearchParams(search.toString());
      params.set(PARAM, next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, search],
  );

  return [mode, setMode];
}

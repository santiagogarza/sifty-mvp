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
 *
 * Until the remembered preference is known, `ready` is false so callers
 * can withhold List/Board instead of flashing the wrong mode (and the
 * wrong shell width) for a frame.
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

export function useTaskViewMode(): {
  mode: TaskViewMode;
  setMode: (mode: TaskViewMode) => void;
  ready: boolean;
} {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const fromParam = parseMode(search.get(PARAM));

  const [stored, setStored] = React.useState<TaskViewMode | null>(null);
  // URL already decides — no need to wait on storage.
  const [ready, setReady] = React.useState(() => fromParam !== null);

  React.useLayoutEffect(() => {
    if (fromParam) {
      setReady(true);
      return;
    }
    const remembered = readStored(pathname);
    setStored(remembered);
    // Promote a remembered board preference into the URL before paint so
    // the shell width and content agree on the first frame the user sees.
    if (remembered === "board") {
      const params = new URLSearchParams(search.toString());
      params.set(PARAM, "board");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    setReady(true);
  }, [pathname, fromParam, router, search]);

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

  return { mode, setMode, ready };
}

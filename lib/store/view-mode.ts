"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

export type ViewMode = "list" | "board";

const STORAGE_PREFIX = "sifty.view.";

function storageKey(route: string): string {
  return `${STORAGE_PREFIX}${route}`;
}

function readStored(route: string): ViewMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(route));
    if (raw === "list" || raw === "board") return raw;
  } catch {
    // private mode / quota
  }
  return null;
}

function writeStored(route: string, mode: ViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(route), mode);
  } catch {
    // private mode / quota
  }
}

function parseViewParam(value: string | null): ViewMode | null {
  if (value === "list" || value === "board") return value;
  return null;
}

/**
 * List/Board preference for the current status route.
 *
 * `?view=` is the session source of truth (shareable, back-button honest);
 * `localStorage` under `sifty.view.<route>` remembers the choice across visits,
 * mirroring the `sifty.theme` pattern.
 */
export function useBoardMode(): {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  isBoard: boolean;
} {
  const router = useRouter();
  const pathname = usePathname() ?? "/focus";
  const search = useSearchParams();
  const route = pathname.split("?")[0] || "/focus";

  const paramMode = parseViewParam(search.get("view"));
  const [storedMode, setStoredMode] = React.useState<ViewMode | null>(null);

  React.useEffect(() => {
    setStoredMode(readStored(route));
  }, [route]);

  // URL wins when present; otherwise the remembered preference; else list.
  const mode: ViewMode = paramMode ?? storedMode ?? "list";

  // Hydrate the URL from localStorage so a revisit lands in the remembered mode
  // without a flash of the wrong layout on subsequent navigations.
  React.useEffect(() => {
    if (paramMode) return;
    const remembered = readStored(route);
    if (!remembered || remembered === "list") return;
    const params = new URLSearchParams(search.toString());
    params.set("view", remembered);
    router.replace(`${route}?${params.toString()}`, { scroll: false });
  }, [paramMode, route, router, search]);

  const setMode = React.useCallback(
    (next: ViewMode) => {
      writeStored(route, next);
      setStoredMode(next);
      const params = new URLSearchParams(search.toString());
      if (next === "list") {
        params.delete("view");
      } else {
        params.set("view", next);
      }
      const qs = params.toString();
      router.replace(qs ? `${route}?${qs}` : route, { scroll: false });
    },
    [route, router, search],
  );

  return { mode, setMode, isBoard: mode === "board" };
}

/** Read-only check for surfaces that only need to know if board is active. */
export function useIsBoardMode(): boolean {
  return useBoardMode().isBoard;
}

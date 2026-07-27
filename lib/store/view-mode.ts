"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

export type ViewMode = "list" | "board";

const STORAGE_PREFIX = "sifty.view.";

function storageKey(pathname: string): string {
  return `${STORAGE_PREFIX}${pathname}`;
}

function readStored(pathname: string): ViewMode | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(storageKey(pathname));
  if (stored === "list" || stored === "board") return stored;
  return null;
}

/**
 * List/Board preference per route. The `?view=` param is the session source
 * of truth; localStorage carries the remembered choice across visits.
 */
export function useBoardMode(): [ViewMode, (mode: ViewMode) => void] {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();

  const paramMode = search.get("view");
  const [storedMode, setStoredMode] = React.useState<ViewMode | null>(null);

  React.useEffect(() => {
    if (paramMode === "board" || paramMode === "list") return;
    setStoredMode(readStored(pathname));
  }, [paramMode, pathname]);

  const mode: ViewMode =
    paramMode === "board" || paramMode === "list" ? paramMode : (storedMode ?? "list");

  const setMode = React.useCallback(
    (next: ViewMode) => {
      window.localStorage.setItem(storageKey(pathname), next);
      const params = new URLSearchParams(search.toString());
      if (next === "list") {
        params.delete("view");
      } else {
        params.set("view", next);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );

  return [mode, setMode];
}

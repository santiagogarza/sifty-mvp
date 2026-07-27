"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

/**
 * List / Board mode for the task views.
 *
 * Two layers, following the `?task=` precedent in `AppFrame` and the
 * `sifty.theme` precedent in `ThemeProvider`:
 *
 *  - `?view=board` is the session source of truth, so the mode is
 *    shareable and the back button undoes a toggle.
 *  - `localStorage` under `sifty.view.<route>` carries the preference
 *    across visits, per view — Today can be a board while Inbox stays a
 *    list.
 *
 * The stored value is read in an effect rather than during render so the
 * server-rendered markup and the first client render agree.
 */

export type ViewMode = "list" | "board";

const STORAGE_PREFIX = "sifty.view.";

function isViewMode(value: string | null): value is ViewMode {
  return value === "list" || value === "board";
}

function storageKey(route: string): string {
  return `${STORAGE_PREFIX}${route}`;
}

export function readStoredViewMode(route: string): ViewMode | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(storageKey(route));
    return isViewMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

export interface BoardModeApi {
  mode: ViewMode;
  setMode: (next: ViewMode) => void;
}

export function useBoardMode(): BoardModeApi {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const route = pathname ?? "/";

  const param = search.get("view");
  const fromUrl = isViewMode(param) ? param : null;
  const [remembered, setRemembered] = React.useState<ViewMode | null>(null);

  React.useEffect(() => {
    setRemembered(readStoredViewMode(route));
  }, [route]);

  const mode = fromUrl ?? remembered ?? "list";

  const setMode = React.useCallback(
    (next: ViewMode) => {
      setRemembered(next);
      try {
        window.localStorage.setItem(storageKey(route), next);
      } catch {
        // Private mode or a full quota: the URL still carries the choice.
      }
      const params = new URLSearchParams(search.toString());
      if (next === "list") params.delete("view");
      else params.set("view", next);
      const qs = params.toString();
      router.replace(qs ? `${route}?${qs}` : route, { scroll: false });
    },
    [route, router, search],
  );

  return { mode, setMode };
}

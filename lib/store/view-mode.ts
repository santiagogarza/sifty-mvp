"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

/**
 * List ↔ Board view mode, one preference per route.
 *
 * Mirrors the `?task=` precedent in `AppFrame`: the `?view=` URL param is the
 * session source of truth (shareable, back button works), while a
 * `sifty.view.<route>` localStorage entry carries the remembered preference
 * across visits — the same pattern `sifty.theme` uses in `theme-context`.
 *
 * `list` is the default and is represented by the *absence* of the param, so
 * a plain `/focus` link always opens the familiar list and the URL only grows
 * when the user has actually chosen the board.
 */

export type ViewMode = "list" | "board";

const STORAGE_PREFIX = "sifty.view.";

function isMode(value: string | null): value is ViewMode {
  return value === "list" || value === "board";
}

export function useBoardMode(): { mode: ViewMode; setMode: (next: ViewMode) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const storageKey = `${STORAGE_PREFIX}${pathname}`;
  const urlView = search.get("view");

  // The stored preference is read in an effect (never during render) so the
  // server and the first client paint agree — the store-hydration skeleton in
  // `TaskView` covers the beat before the remembered mode settles.
  const [stored, setStored] = React.useState<ViewMode | null>(null);
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      setStored(isMode(raw) ? raw : null);
    } catch {
      setStored(null);
    }
  }, [storageKey]);

  const mode: ViewMode = isMode(urlView) ? urlView : (stored ?? "list");

  // A URL that declares a mode (deep link, back/forward) also updates the
  // remembered preference, so the choice sticks on the next plain visit.
  React.useEffect(() => {
    if (!isMode(urlView)) return;
    try {
      window.localStorage.setItem(storageKey, urlView);
    } catch {
      // Quota / private mode: degrade to session-only, URL still governs.
    }
    setStored(urlView);
  }, [urlView, storageKey]);

  const setMode = React.useCallback(
    (next: ViewMode) => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        // See above: URL remains the source of truth for the session.
      }
      setStored(next);
      const params = new URLSearchParams(search.toString());
      if (next === "list") params.delete("view");
      else params.set("view", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, search, storageKey],
  );

  return { mode, setMode };
}

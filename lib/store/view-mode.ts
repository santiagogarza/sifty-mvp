"use client";

import * as React from "react";

/**
 * List or board: how task views are laid out. A device preference, kept out
 * of the synced store on purpose — it describes this screen, not the
 * workspace, so it never syncs and a workspace reset leaves it alone.
 */
export type ViewMode = "list" | "board";

export const VIEW_MODE_KEY = "sifty.viewMode";

export function parseViewMode(raw: string | null): ViewMode {
  return raw === "board" ? "board" : "list";
}

const listeners = new Set<() => void>();
/** Used only when localStorage is unavailable (e.g. blocked storage). */
let fallbackMode: ViewMode = "list";

function getSnapshot(): ViewMode {
  try {
    return parseViewMode(window.localStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return fallbackMode;
  }
}

function getServerSnapshot(): ViewMode {
  return "list";
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Other tabs write through localStorage; `key === null` means it was cleared.
  const onStorage = (e: StorageEvent) => {
    if (e.key === VIEW_MODE_KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setViewMode(mode: ViewMode): void {
  fallbackMode = mode;
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Storage unavailable: the in-memory fallback carries the choice.
  }
  for (const listener of listeners) listener();
}

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const mode = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [mode, setViewMode];
}

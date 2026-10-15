"use client";

import { useSyncExternalStore } from "react";

/**
 * List / Board preference. One global choice (not per route) because Board
 * shows the same pipeline everywhere. Device-local: kept in its own
 * localStorage key, outside the synced `sifty-store-v1` blob.
 */

export type ViewMode = "list" | "board";

export const VIEW_MODE_KEY = "sifty.viewMode";

const listeners = new Set<() => void>();
/** Set only when localStorage refuses writes, so the toggle still works in this tab. */
let unpersisted: ViewMode | null = null;

export function parseViewMode(raw: string | null): ViewMode {
  if (raw === null) return "list";
  try {
    return JSON.parse(raw) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

export function readViewMode(): ViewMode {
  if (typeof window === "undefined") return "list";
  if (unpersisted) return unpersisted;
  try {
    return parseViewMode(window.localStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return "list";
  }
}

export function setViewMode(mode: ViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, JSON.stringify(mode));
    unpersisted = null;
  } catch {
    unpersisted = mode;
  }
  for (const listener of listeners) listener();
}

export function subscribeViewMode(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === VIEW_MODE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const mode = useSyncExternalStore(subscribeViewMode, readViewMode, () => "list" as const);
  return [mode, setViewMode];
}

"use client";

import { useSyncExternalStore } from "react";

/**
 * List vs Board, remembered on this device only.
 *
 * Kept out of the zustand persist blob (`sifty-store-v1`): that blob is the
 * task cache and syncs, and a new field there would force a migration for
 * chrome. One global value, not per route — Board shows the same pipeline
 * everywhere, so a per-route memory would show List again on the next page.
 */

export type ViewMode = "list" | "board";

export const VIEW_MODE_STORAGE_KEY = "sifty.viewMode";

const SERVER_SNAPSHOT: ViewMode = "list";

let current: ViewMode = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

export function parseViewMode(raw: string | null | undefined): ViewMode {
  return raw === "board" ? "board" : "list";
}

function readStorage(): ViewMode {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  try {
    return parseViewMode(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY));
  } catch {
    return SERVER_SNAPSHOT;
  }
}

function writeStorage(mode: ViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Private mode / quota. The in-memory value still updates.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function getViewMode(): ViewMode {
  return current;
}

export function getServerViewMode(): ViewMode {
  return SERVER_SNAPSHOT;
}

/** Re-read localStorage. Used after another tab writes, and by tests. */
export function hydrateViewModeFromStorage(): void {
  const next = readStorage();
  if (next === current) return;
  current = next;
  emit();
}

export function setViewMode(mode: ViewMode): void {
  if (mode !== "list" && mode !== "board") return;
  if (current === mode) return;
  current = mode;
  writeStorage(mode);
  emit();
}

export function subscribeViewMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetViewModeForTests(): void {
  current = SERVER_SNAPSHOT;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(VIEW_MODE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  emit();
}

if (typeof window !== "undefined") {
  current = readStorage();
  window.addEventListener("storage", hydrateViewModeFromStorage);
}

export function useViewMode(): ViewMode {
  return useSyncExternalStore(subscribeViewMode, getViewMode, getServerViewMode);
}

function subscribeClientReady(): () => void {
  return () => {};
}

/** False during SSR and hydration, true after. Server snapshot stays List. */
export function useClientReady(): boolean {
  return useSyncExternalStore(
    subscribeClientReady,
    () => true,
    () => false,
  );
}

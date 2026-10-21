"use client";

import * as React from "react";

/** How task pages render: linear list, or the kanban board. */
export type TaskViewMode = "list" | "board";

/**
 * One global, device-local preference. It lives under its own key (like
 * `sifty.theme`) rather than in the `sifty-store-v1` blob, so "Reset local
 * cache" keeps it and it never rides along with workspace sync.
 */
export const VIEW_MODE_KEY = "sifty.viewMode";

const listeners = new Set<() => void>();
/** Set once localStorage refuses a write (private mode, quota); the session then runs from memory. */
let memoryFallback: TaskViewMode | null = null;

/** Missing, unparsable, or unknown values all mean List. */
export function parseViewMode(raw: string | null): TaskViewMode {
  if (raw === null) return "list";
  try {
    return JSON.parse(raw) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

export function readViewMode(): TaskViewMode {
  if (typeof window === "undefined") return "list";
  if (memoryFallback) return memoryFallback;
  try {
    return parseViewMode(window.localStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return "list";
  }
}

export function setViewMode(mode: TaskViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, JSON.stringify(mode));
  } catch {
    memoryFallback = mode;
  }
  for (const listener of listeners) listener();
}

export function subscribeViewMode(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab switching views updates this one too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === VIEW_MODE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const serverSnapshot = (): TaskViewMode => "list";

export function useViewMode(): TaskViewMode {
  return React.useSyncExternalStore(subscribeViewMode, readViewMode, serverSnapshot);
}

"use client";

import { useSyncExternalStore } from "react";

/**
 * Global List / Board preference.
 *
 * One value for every task route: the board shows the same pipeline
 * everywhere, so a per-route memory would drop someone back into List
 * when they change pages. Stored outside the zustand persist blob
 * (`sifty-store-v1`) so a UI preference never forces a task-data migration.
 *
 * The server snapshot is always List. The stored value is read on the
 * client after hydration, which keeps the server HTML from mismatching.
 */
export type ViewMode = "list" | "board";

export const VIEW_MODE_KEY = "sifty.viewMode";

export function parseViewMode(raw: string | null): ViewMode {
  return raw === "list" || raw === "board" ? raw : "list";
}

let current: ViewMode = "list";
const listeners = new Set<() => void>();

function readStored(): ViewMode {
  if (typeof window === "undefined") return "list";
  try {
    return parseViewMode(window.localStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return "list";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== VIEW_MODE_KEY) return;
    const next = readStored();
    if (next === current) return;
    current = next;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ViewMode {
  const next = readStored();
  current = next;
  return current;
}

function getServerSnapshot(): ViewMode {
  return "list";
}

export function setViewMode(mode: ViewMode) {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Private mode can reject the write. The in-memory value still updates.
  }
  if (mode === current) return;
  current = mode;
  for (const listener of listeners) listener();
}

export function useViewMode(): ViewMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

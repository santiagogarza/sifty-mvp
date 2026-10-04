"use client";

import { usePathname } from "next/navigation";
import * as React from "react";

/**
 * Per-route list/board choice. Kept out of the zustand persist blob
 * (`sifty-store-v1`) so a UI preference never forces a task-data migration.
 */
export const VIEW_MODE_KEY = "sifty.viewMode";

export type ViewMode = "list" | "board";

export function parseViewModeMap(raw: string | null): Record<string, ViewMode> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, ViewMode> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === "list" || value === "board") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function viewModeForPath(raw: string | null, pathname: string): ViewMode {
  return parseViewModeMap(raw)[pathname] === "board" ? "board" : "list";
}

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === VIEW_MODE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function writeViewMode(pathname: string, mode: ViewMode) {
  const map = parseViewModeMap(window.localStorage.getItem(VIEW_MODE_KEY));
  map[pathname] = mode;
  window.localStorage.setItem(VIEW_MODE_KEY, JSON.stringify(map));
  emit();
}

function read(pathname: string): ViewMode {
  return viewModeForPath(window.localStorage.getItem(VIEW_MODE_KEY), pathname);
}

export function useViewMode(pathname: string): readonly [ViewMode, (mode: ViewMode) => void] {
  const mode = React.useSyncExternalStore<ViewMode>(
    subscribe,
    () => read(pathname),
    () => "list",
  );
  const setMode = React.useCallback((next: ViewMode) => writeViewMode(pathname, next), [pathname]);
  return [mode, setMode] as const;
}

export function useRouteViewMode(): readonly [ViewMode, (mode: ViewMode) => void] {
  const pathname = usePathname();
  return useViewMode(pathname);
}

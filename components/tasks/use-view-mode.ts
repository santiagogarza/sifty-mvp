"use client";

import { STATUS_VIEWS } from "@/lib/domain/status";
import * as React from "react";

/**
 * List / Board preference.
 *
 * One global value, not per route: Board shows the same five columns on
 * every task route, so remembering it per route would mean switching Inbox
 * to Board and then finding Focus still a list of the same tasks.
 *
 * Lives in its own localStorage key rather than the zustand persist blob:
 * that blob is task data that syncs, and UI chrome in it would force a
 * store migration. Shared external store (not per-component state) because
 * `TaskView` and the Done page's Dropped disclosure both read it and must
 * flip together. Server snapshot is always List so the SSR shell never
 * hydrate-mismatches.
 */

export type ViewMode = "list" | "board";

export const VIEW_MODE_KEY = "sifty.viewMode";
const DEFAULT_MODE: ViewMode = "list";

/** Anything that is not exactly "board" is List — missing, garbage, old shapes. */
export function parseViewMode(raw: unknown): ViewMode {
  return raw === "board" ? "board" : DEFAULT_MODE;
}

const listeners = new Set<() => void>();

function readViewMode(): ViewMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    return parseViewMode(window.localStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return DEFAULT_MODE;
  }
}

export function setViewMode(mode: ViewMode): void {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Private mode / quota: the in-memory listeners still flip this tab.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === VIEW_MODE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getServerSnapshot(): ViewMode {
  return DEFAULT_MODE;
}

export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const mode = React.useSyncExternalStore(subscribe, readViewMode, getServerSnapshot);
  return [mode, setViewMode];
}

/** Routes that carry the toggle: Today plus every status that has a view. */
export const BOARD_ROUTES: readonly string[] = ["/today", ...STATUS_VIEWS.map((v) => v.href)];

export function isBoardRoute(pathname: string | null | undefined): boolean {
  return !!pathname && BOARD_ROUTES.includes(pathname);
}

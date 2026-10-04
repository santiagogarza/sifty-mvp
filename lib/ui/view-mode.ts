"use client";

import { useSyncExternalStore } from "react";

/**
 * List / Board is chrome, not task data. It lives outside the zustand
 * persist blob (`sifty-store-v1`) so a new field doesn't force a migration
 * of the synced task cache. One global value: the board shows the same
 * pipeline on every task route, so a per-route memory would disagree with
 * itself as you move through the sidebar.
 */
export type ViewMode = "list" | "board";

export const VIEW_MODE_KEY = "sifty.viewMode";

const listeners = new Set<() => void>();
let current: ViewMode = "list";
let didRead = false;

export function parseViewMode(raw: string | null | undefined): ViewMode {
  if (raw == null) return "list";
  const trimmed = raw.trim();
  if (trimmed === "list" || trimmed === "board") return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === "list" || parsed === "board") return parsed;
  } catch {
    // Missing, garbage, or a leftover per-route map all mean List.
  }
  return "list";
}

function readStorage(): ViewMode {
  if (typeof window === "undefined") return "list";
  try {
    return parseViewMode(window.localStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return "list";
  }
}

function ensureClientRead(): void {
  if (didRead || typeof window === "undefined") return;
  didRead = true;
  current = readStorage();
  window.addEventListener("storage", (event) => {
    if (event.key !== VIEW_MODE_KEY) return;
    current = parseViewMode(event.newValue);
    emit();
  });
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function getViewMode(): ViewMode {
  ensureClientRead();
  return current;
}

function getServerViewMode(): ViewMode {
  return "list";
}

export function subscribeViewMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function writeViewMode(mode: ViewMode): void {
  current = mode;
  didRead = true;
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Private mode: the choice still holds for this session.
  }
  emit();
}

export function useViewMode(): ViewMode {
  return useSyncExternalStore(subscribeViewMode, getViewMode, getServerViewMode);
}

/** Test seam. Production code reads and writes through the functions above. */
export function resetViewModeForTests(): void {
  current = "list";
  didRead = true;
  try {
    window.localStorage.removeItem(VIEW_MODE_KEY);
  } catch {
    // node
  }
  emit();
}

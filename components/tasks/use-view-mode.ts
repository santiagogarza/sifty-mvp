"use client";

import * as React from "react";

/**
 * List / Board is one global preference. Board looks the same on every
 * route, so a per-route memory would show List again the moment you
 * changed pages. Stored outside the zustand blob: that blob syncs task
 * data, and a new field would force a migration for chrome.
 */
export type ViewMode = "list" | "board";

export const VIEW_MODE_KEY = "sifty.viewMode";

let current: ViewMode = "list";
const listeners = new Set<() => void>();

export function parseViewMode(raw: string | null | undefined): ViewMode {
  return raw === "board" ? "board" : "list";
}

function readStored(): ViewMode {
  if (typeof window === "undefined") return "list";
  try {
    return parseViewMode(window.localStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return "list";
  }
}

function writeStored(mode: ViewMode) {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Private mode still keeps the in-memory choice for this session.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setViewMode(next: ViewMode) {
  const mode = parseViewMode(next);
  current = mode;
  writeStored(mode);
  emit();
}

export function useViewMode(): ViewMode {
  const mode = React.useSyncExternalStore<ViewMode>(
    subscribe,
    () => current,
    () => "list",
  );
  // After mount, so the server render stays List and does not mismatch.
  React.useEffect(() => {
    const stored = readStored();
    if (stored === current) return;
    current = stored;
    emit();
  }, []);
  return mode;
}

"use client";

import * as React from "react";

export type GlobalShortcut = "capture" | "command" | "shortcuts";

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.getAttribute("role") === "textbox"
  );
}

/**
 * Which global action a keydown maps to, or null. Pure so the filter is
 * testable: Cmd/Ctrl+K works everywhere; the single-key bindings never fire
 * while typing, and never with a modifier held (Shift excepted, since `?`
 * is Shift+/ on US layouts — match on `key`, not on `code`).
 */
export function globalShortcutFor(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  target: EventTarget | null;
}): GlobalShortcut | null {
  // Auto-repeat from a held key must not re-fire (a held `?` would flicker
  // the sheet and leave it in whatever state the release lands on).
  if (e.repeat) return null;
  if (e.key === "k" && (e.metaKey || e.ctrlKey)) return "command";
  if (isEditableTarget(e.target)) return null;
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === "c") return "capture";
  if (e.key === "/") return "command";
  if (e.key === "?") return "shortcuts";
  return null;
}

/**
 * Global keyboard shortcuts. Fires from the document, but ignores keys when
 * the user is typing in an input or textarea so we never steal characters.
 */
export function GlobalKeyboard({
  onCapture,
  onCommand,
  onShortcuts,
}: {
  onCapture: () => void;
  onCommand: () => void;
  onShortcuts: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = globalShortcutFor(e);
      if (!action) return;
      e.preventDefault();
      if (action === "capture") onCapture();
      else if (action === "command") onCommand();
      else onShortcuts();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCapture, onCommand, onShortcuts]);

  return null;
}

"use client";

import * as React from "react";

/**
 * Global keyboard shortcuts. Fires from the document, but ignores keys when
 * the user is typing in an input or textarea so we never steal characters.
 */
export function GlobalKeyboard({
  onCapture,
  onCommand,
}: {
  onCapture: () => void;
  onCommand: () => void;
}) {
  React.useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target.isContentEditable ||
        target.getAttribute("role") === "textbox"
      );
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onCommand();
        return;
      }
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "c") {
        e.preventDefault();
        onCapture();
      } else if (e.key === "/") {
        e.preventDefault();
        onCommand();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCapture, onCommand]);

  return null;
}

/** How long a sequence prefix (the `s` in `s t`) stays armed. */
const SEQUENCE_TIMEOUT_MS = 1000;

export type KeySequenceMap = Record<string, () => void>;

/**
 * Multi-key shortcuts like `s t`. Keys in a sequence are space-separated.
 * Returns a keydown handler that reports whether it consumed the key, so
 * callers can fall through to their single-key shortcuts.
 */
export function useKeySequence(): (
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; preventDefault(): void },
  sequences: KeySequenceMap,
) => boolean {
  const pending = React.useRef<{ keys: string; at: number } | null>(null);

  return React.useCallback((e, sequences) => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      pending.current = null;
      return false;
    }
    const armed =
      pending.current && Date.now() - pending.current.at < SEQUENCE_TIMEOUT_MS
        ? pending.current.keys
        : null;
    const candidate = armed ? `${armed} ${e.key}` : e.key;
    pending.current = null;

    const exact = sequences[candidate];
    if (exact && candidate.includes(" ")) {
      e.preventDefault();
      exact();
      return true;
    }
    if (Object.keys(sequences).some((seq) => seq.startsWith(`${candidate} `))) {
      e.preventDefault();
      pending.current = { keys: candidate, at: Date.now() };
      return true;
    }
    return false;
  }, []);
}

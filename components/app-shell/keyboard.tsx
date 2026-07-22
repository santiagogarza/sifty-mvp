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

    // A card held mid-drag (dnd-kit sets aria-pressed on the source) owns
    // the keyboard: opening capture or the palette over a live drag would
    // leave arrow keys steering the card behind the dialog.
    const isActiveDragSource = (target: EventTarget | null): boolean =>
      target instanceof Element &&
      target.closest('[aria-roledescription="draggable"][aria-pressed="true"]') !== null;

    const onKey = (e: KeyboardEvent) => {
      if (isActiveDragSource(e.target)) return;
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

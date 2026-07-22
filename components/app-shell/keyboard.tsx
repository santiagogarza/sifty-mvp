"use client";

import * as React from "react";

/**
 * Global keyboard shortcuts. Fires from the document, but ignores keys when
 * the user is typing in an input or textarea so we never steal characters.
 */
export function GlobalKeyboard({
  onCapture,
  onCommand,
  onToggleView,
}: {
  onCapture: () => void;
  onCommand: () => void;
  onToggleView: () => void;
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
      } else if (e.key === "v") {
        // Navigating while a dialog is open would yank the page out from
        // under it — layout switching is a page-level gesture only.
        if (e.target instanceof HTMLElement && e.target.closest('[role="dialog"]')) return;
        e.preventDefault();
        onToggleView();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCapture, onCommand, onToggleView]);

  return null;
}

"use client";

import { Kbd } from "@/components/ui/kbd";
import * as React from "react";
import { createPortal } from "react-dom";

export function UndoPill({
  message,
  onUndo,
}: {
  message: string;
  onUndo: () => void;
}) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setHost(document.getElementById("app-feedback-stack"));
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        onUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onUndo]);

  if (!host) return null;
  return createPortal(
    <div
      role="status"
      className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 pl-3.5 text-[13px] text-[var(--fg)] shadow-[0_15px_30px_-10px_oklch(0%_0_0/0.5)]"
    >
      <span>{message}</span>
      <button type="button" onClick={onUndo} className="font-medium text-[var(--accent)]">
        Undo
      </button>
      <Kbd>⌘Z</Kbd>
    </div>,
    host,
  );
}

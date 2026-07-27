"use client";

import { cn } from "@/lib/utils/cn";
import { Undo2 } from "lucide-react";

export function UndoPill({
  onUndo,
  savedLocally,
  className,
}: {
  onUndo: () => void;
  savedLocally?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "fixed left-1/2 -translate-x-1/2 z-40",
        "flex items-center gap-2 rounded-full border border-[var(--border)]",
        "bg-[var(--bg-elevated)]/95 backdrop-blur px-3.5 py-1.5 text-[12px] shadow-sm",
        className,
      )}
    >
      {savedLocally ? (
        <span className="text-[var(--fg-muted)]">Saved locally — Sifty will sync it</span>
      ) : (
        <>
          <span className="text-[var(--fg-muted)]">Moved</span>
          <button
            type="button"
            onClick={onUndo}
            className="inline-flex items-center gap-1 text-[var(--accent)] font-medium hover:underline"
          >
            <Undo2 size={12} />
            Undo
          </button>
        </>
      )}
    </div>
  );
}

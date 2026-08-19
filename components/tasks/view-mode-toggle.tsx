"use client";

import { type ViewMode, useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { Columns3, List } from "lucide-react";
import * as React from "react";

const MODES: { mode: ViewMode; label: string; icon: typeof List }[] = [
  { mode: "list", label: "List", icon: List },
  { mode: "board", label: "Board", icon: Columns3 },
];

/**
 * List / Board switch.
 *
 * The choice is one global preference rather than one per route: a person who
 * thinks in boards thinks in boards everywhere, and a per-route memory would
 * mean the same control produces a different answer depending on where it was
 * last touched.
 */
export function ViewModeToggle() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);

  return (
    <div
      role="radiogroup"
      aria-label="View mode"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
    >
      {MODES.map(({ mode, label, icon: Icon }) => {
        const active = viewMode === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => setViewMode(mode)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-[12.5px]",
              "transition-colors duration-150 ease-[var(--ease-product)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]",
              active
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-sm"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            <Icon size={13} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

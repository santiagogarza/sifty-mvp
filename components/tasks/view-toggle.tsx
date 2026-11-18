"use client";

import { cn } from "@/lib/utils/cn";
import * as React from "react";
import { type ViewMode, setViewMode, useViewMode } from "./use-view-mode";

const OPTIONS: { mode: ViewMode; label: string }[] = [
  { mode: "list", label: "List" },
  { mode: "board", label: "Board" },
];

/**
 * List / Board switch. A preference, so it stays quiet: two words, no
 * extra chrome competing with the page title.
 */
export function ViewToggle() {
  const mode = useViewMode();

  return (
    <div
      role="radiogroup"
      aria-label="Layout"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setViewMode(option.mode)}
            className={cn(
              "h-7 rounded-[5px] px-2.5 text-[12.5px]",
              "transition-colors duration-150 ease-[var(--ease-product)]",
              active
                ? "bg-[var(--surface-muted)] text-[var(--fg)] shadow-[inset_0_0_0_1px_var(--border-strong)]"
                : "text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { type ViewMode, useViewMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import { Columns3, Rows3 } from "lucide-react";
import type * as React from "react";

const OPTIONS: ReadonlyArray<{
  mode: ViewMode;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { mode: "list", label: "List", icon: Rows3 },
  { mode: "board", label: "Board", icon: Columns3 },
];

/** List | Board segmented control in the page header of every task view. */
export function ViewToggle() {
  const [mode, setMode] = useViewMode();
  return (
    <div
      role="group"
      aria-label="Layout"
      className="inline-flex h-8 items-center gap-0.5 rounded-[var(--radius-md)] border bg-[var(--surface-muted)] p-0.5"
    >
      {OPTIONS.map(({ mode: option, label, icon: Icon }) => {
        const active = mode === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => setMode(option)}
            className={cn(
              "inline-flex h-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-[12.5px]",
              "transition-[background-color,color,box-shadow] duration-150 ease-[var(--ease-product)]",
              active
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--shadow-raised)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            <Icon size={13} className={active ? "text-[var(--fg)]" : "text-[var(--fg-subtle)]"} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

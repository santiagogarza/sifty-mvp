"use client";

import type { TaskViewMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import { Columns3, ListTodo } from "lucide-react";
import * as React from "react";

/**
 * List | Board segmented control. Lives in the page header of task views.
 * The choice is remembered per view (see `useTaskViewMode`), and List stays
 * the default — the board is opt-in.
 */
export function ViewToggle({
  mode,
  onChange,
}: {
  mode: TaskViewMode;
  onChange: (mode: TaskViewMode) => void;
}) {
  const segments = [
    { mode: "list" as const, label: "List", icon: ListTodo },
    { mode: "board" as const, label: "Board", icon: Columns3 },
  ];
  return (
    <div
      role="group"
      aria-label="Layout"
      className="flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
    >
      {segments.map((seg) => {
        const active = seg.mode === mode;
        const Icon = seg.icon;
        return (
          <button
            key={seg.mode}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(seg.mode)}
            className={cn(
              "flex items-center gap-1 rounded-[var(--radius-xs)] pl-2 pr-2.5 py-1 text-[13px]",
              "transition-colors duration-150 ease-[var(--ease-product)]",
              active
                ? "bg-[var(--surface)] font-medium text-[var(--fg)] shadow-[0_1px_2px_oklch(0%_0_0/0.18)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            <Icon size={13} />
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}

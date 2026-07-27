"use client";

import type { TaskViewMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import { Columns3, ListTodo } from "lucide-react";

export function ViewToggle({
  mode,
  onChange,
}: {
  mode: TaskViewMode;
  onChange: (mode: TaskViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Task layout"
      className="flex gap-0.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
    >
      {(
        [
          ["list", "List", ListTodo],
          ["board", "Board", Columns3],
        ] as const
      ).map(([value, label, Icon]) => {
        const selected = mode === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(value)}
            className={cn(
              "flex items-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1 text-[11px] font-medium leading-[14px]",
              selected
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_0_var(--border)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            <Icon size={12} strokeWidth={1.5} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

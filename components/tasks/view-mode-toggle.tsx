"use client";

import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { Columns3, List } from "lucide-react";

export function ViewModeToggle() {
  const viewMode = useStore((state) => state.viewMode);
  const setViewMode = useStore((state) => state.setViewMode);

  return (
    <div
      role="group"
      aria-label="Task view"
      className="inline-flex rounded-[var(--radius-md)] border bg-[var(--bg-sunken)] p-0.5"
    >
      {(
        [
          { value: "list", label: "List", icon: List },
          { value: "board", label: "Board", icon: Columns3 },
        ] as const
      ).map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={viewMode === value}
          onClick={() => setViewMode(value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-2.5",
            "text-[11.5px] transition-colors duration-150 ease-[var(--ease-product)]",
            viewMode === value
              ? "bg-[var(--surface)] text-[var(--fg)] shadow-sm"
              : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
          )}
        >
          <Icon size={13} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

"use client";

import { type ViewMode, useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { LayoutGrid, List } from "lucide-react";

const OPTIONS: { mode: ViewMode; label: string; icon: typeof List }[] = [
  { mode: "list", label: "List", icon: List },
  { mode: "board", label: "Board", icon: LayoutGrid },
];

/**
 * Segmented List/Board control. One global preference — switching on
 * Inbox is switching on Focus too. Hick's Law: two labeled options, not
 * an icon-only toggle that has to be remembered.
 */
export function ViewModeToggle() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);

  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] p-0.5"
    >
      {OPTIONS.map(({ mode, label, icon: Icon }) => {
        const active = viewMode === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            onClick={() => setViewMode(mode)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-2.5",
              "text-[12.5px] font-medium transition-colors duration-150 ease-[var(--ease-product)]",
              active
                ? "bg-[var(--surface-muted)] text-[var(--fg)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            <Icon size={13} strokeWidth={1.75} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

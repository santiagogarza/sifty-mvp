"use client";

import { type ViewMode, useViewMode, writeViewMode } from "@/lib/ui/view-mode";
import { cn } from "@/lib/utils/cn";
import { Columns3, List } from "lucide-react";

const OPTIONS: { mode: ViewMode; label: string; icon: typeof List }[] = [
  { mode: "list", label: "List", icon: List },
  { mode: "board", label: "Board", icon: Columns3 },
];

export function ViewToggle() {
  const mode = useViewMode();
  return (
    <div
      role="radiogroup"
      aria-label="Layout"
      className="inline-flex rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
    >
      {OPTIONS.map((option) => {
        const selected = mode === option.mode;
        const Icon = option.icon;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => writeViewMode(option.mode)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-[12.5px]",
              "transition-colors duration-150 ease-[var(--ease-product)]",
              selected
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_2px_oklch(0%_0_0/0.06)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            <Icon size={13} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

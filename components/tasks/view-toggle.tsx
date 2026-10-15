"use client";

import { cn } from "@/lib/utils/cn";
import { Columns3, List } from "lucide-react";
import type { ViewMode } from "./use-view-mode";

const OPTIONS: { mode: ViewMode; label: string; icon: typeof List }[] = [
  { mode: "list", label: "List", icon: List },
  { mode: "board", label: "Board", icon: Columns3 },
];

export function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Layout"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
    >
      {OPTIONS.map(({ mode: option, label, icon: Icon }) => {
        const selected = option === mode;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-[12px]",
              "transition-colors duration-150 ease-[var(--ease-product)]",
              selected
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_2px_oklch(0%_0_0/0.08)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

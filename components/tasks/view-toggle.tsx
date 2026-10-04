"use client";

import { cn } from "@/lib/utils/cn";
import { Columns3, List } from "lucide-react";
import type { ViewMode } from "./use-view-mode";

const OPTIONS: { value: ViewMode; label: string; icon: typeof List }[] = [
  { value: "list", label: "List", icon: List },
  { value: "board", label: "Board", icon: Columns3 },
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
      role="radiogroup"
      aria-label="Layout"
      className="inline-flex rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
    >
      {OPTIONS.map((option) => {
        const selected = mode === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px]",
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

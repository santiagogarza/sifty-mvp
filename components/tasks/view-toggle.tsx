"use client";

import { cn } from "@/lib/utils/cn";
import { List, SquareKanban } from "lucide-react";
import * as React from "react";
import type { ViewMode } from "./use-view-mode";

const OPTIONS: ReadonlyArray<{
  value: ViewMode;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { value: "list", label: "List", icon: List },
  { value: "board", label: "Board", icon: SquareKanban },
];

/** Segmented List / Board control. A radiogroup: arrows move, click sets. */
export function ViewToggle({
  value,
  onChange,
  className,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}) {
  const refs = React.useRef<Partial<Record<ViewMode, HTMLButtonElement | null>>>({});

  const onKeyDown = (e: React.KeyboardEvent) => {
    const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
    const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
    if (!horizontal && !vertical) return;
    e.preventDefault();
    const next: ViewMode = value === "list" ? "board" : "list";
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="View"
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex h-[30px] shrink-0 items-center gap-[2px] rounded-[var(--radius-md)]",
        "border border-[var(--border-strong)] bg-[var(--surface-muted)] p-[2px]",
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[option.value] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-full items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] font-medium",
              "transition-colors duration-150 ease-[var(--ease-product)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]",
              selected
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_2px_oklch(0%_0_0/0.08)]"
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

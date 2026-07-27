"use client";

import type { ViewMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import { Columns3, ListTodo } from "lucide-react";
import * as React from "react";

/**
 * List / Board segmented control.
 *
 * Lives in the page header the user already reads — no modal, no tour,
 * no badge. List stays the default, so the board is opt-in.
 */
export function ViewToggle({
  mode,
  onChange,
  className,
}: {
  mode: ViewMode;
  onChange: (next: ViewMode) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="View"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] p-0.5",
        "border border-[var(--border)] bg-[var(--surface-muted)]",
        className,
      )}
    >
      <Segment
        selected={mode === "list"}
        onSelect={() => onChange("list")}
        icon={ListTodo}
        label="List"
      />
      <Segment
        selected={mode === "board"}
        onSelect={() => onChange("board")}
        icon={Columns3}
        label="Board"
      />
    </div>
  );
}

function Segment({
  selected,
  onSelect,
  icon: Icon,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-xs)] pl-2 pr-2.5 py-1",
        "text-[13px] leading-[18px]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        selected
          ? "bg-[var(--surface)] font-medium text-[var(--fg)] shadow-[0_1px_2px_rgba(0,0,0,0.18)]"
          : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

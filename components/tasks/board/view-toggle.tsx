"use client";

import type { TaskViewMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import { Columns3, List } from "lucide-react";
import type * as React from "react";

export function ViewToggle({
  mode,
  onChange,
}: {
  mode: TaskViewMode;
  onChange: (mode: TaskViewMode) => void;
}) {
  return (
    <div
      aria-label="Task view"
      className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
      role="group"
    >
      <ToggleButton active={mode === "list"} label="List" onClick={() => onChange("list")}>
        <List size={12} />
      </ToggleButton>
      <ToggleButton active={mode === "board"} label="Board" onClick={() => onChange("board")}>
        <Columns3 size={12} />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-[11px] font-medium leading-[14px]",
        "transition-[background,color,box-shadow] duration-150 ease-[var(--ease-product)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]",
        active
          ? "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_0_var(--border)]"
          : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
      )}
    >
      {children}
      {label}
    </button>
  );
}

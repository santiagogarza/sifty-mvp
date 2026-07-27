"use client";

import { type TaskViewMode, useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { Columns3, Rows3 } from "lucide-react";
import * as React from "react";

/**
 * Subtle list ⇄ board switch, shown in the page header of every task view.
 * Icon-only on purpose — it's a preference, not a call to action.
 */
export function ViewModeToggle() {
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);

  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5"
    >
      <ModeButton
        mode="list"
        current={viewMode}
        label="List view"
        onSelect={setViewMode}
        icon={<Rows3 size={13} />}
      />
      <ModeButton
        mode="board"
        current={viewMode}
        label="Board view"
        onSelect={setViewMode}
        icon={<Columns3 size={13} />}
      />
    </div>
  );
}

function ModeButton({
  mode,
  current,
  label,
  icon,
  onSelect,
}: {
  mode: TaskViewMode;
  current: TaskViewMode;
  label: string;
  icon: React.ReactNode;
  onSelect: (mode: TaskViewMode) => void;
}) {
  const active = current === mode;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => onSelect(mode)}
      className={cn(
        "flex size-6 items-center justify-center rounded-[5px]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        active
          ? "bg-[var(--surface-muted)] text-[var(--fg)] shadow-[inset_0_0_0_1px_var(--border-strong)]"
          : "text-[var(--fg-subtle)] hover:text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]",
      )}
    >
      {icon}
    </button>
  );
}

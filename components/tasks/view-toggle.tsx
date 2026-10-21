"use client";

import { cn } from "@/lib/utils/cn";
import { Columns3, Rows3 } from "lucide-react";
import * as React from "react";
import { type TaskViewMode, setViewMode, useViewMode } from "./use-view-mode";

/**
 * List ⇄ Board switch in the page header of every task view. One global
 * preference: the board is the same on every route, so the choice is too.
 */
export function ViewToggle() {
  const mode = useViewMode();
  return (
    <div
      role="group"
      aria-label="View"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
    >
      <ModeButton mode="list" current={mode} label="List" icon={<Rows3 size={13} />} />
      <ModeButton mode="board" current={mode} label="Board" icon={<Columns3 size={13} />} />
    </div>
  );
}

function ModeButton({
  mode,
  current,
  label,
  icon,
}: {
  mode: TaskViewMode;
  current: TaskViewMode;
  label: string;
  icon: React.ReactNode;
}) {
  const active = current === mode;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setViewMode(mode)}
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[12.5px]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        active
          ? "bg-[var(--surface)] text-[var(--fg)] font-medium shadow-[0_0_0_1px_var(--border-strong)]"
          : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

"use client";

import type { ViewMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import { Columns3, List } from "lucide-react";
import * as React from "react";

/**
 * Segmented List/Board control. Lands in TaskView's PageHeader actions.
 * Recognition over recall: icons mirror the layouts they switch to.
 */
export function ViewToggle({
  mode,
  onChange,
  className,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-[var(--border)]",
        "bg-[var(--surface-muted)] p-0.5",
        className,
      )}
    >
      <ToggleSeg
        active={mode === "list"}
        onClick={() => onChange("list")}
        icon={List}
        label="List"
      />
      <ToggleSeg
        active={mode === "board"}
        onClick={() => onChange("board")}
        icon={Columns3}
        label="Board"
      />
    </div>
  );
}

function ToggleSeg({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-[5px] rounded-[var(--radius-xs)] px-2 py-1",
        "text-[11px] font-medium leading-[14px]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        active
          ? "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_0_var(--border)]"
          : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
      )}
    >
      <Icon size={12} className="opacity-80" />
      {label}
    </button>
  );
}

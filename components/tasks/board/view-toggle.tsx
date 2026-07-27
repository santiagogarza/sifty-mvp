"use client";

import type { ViewMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import { LayoutGrid, List } from "lucide-react";
import * as React from "react";

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
      aria-label="View mode"
      className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
    >
      <ToggleButton
        active={mode === "list"}
        label="List"
        icon={List}
        onClick={() => onChange("list")}
      />
      <ToggleButton
        active={mode === "board"}
        label="Board"
        icon={LayoutGrid}
        onClick={() => onChange("board")}
      />
    </div>
  );
}

function ToggleButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[calc(var(--radius-md)-2px)] px-2.5 py-1.5",
        "text-[12px] font-medium transition-colors duration-150 ease-[var(--ease-product)]",
        active
          ? "bg-[var(--bg-elevated)] text-[var(--fg)] shadow-sm"
          : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
      )}
    >
      <Icon size={14} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

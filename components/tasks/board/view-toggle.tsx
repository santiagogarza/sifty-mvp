"use client";

import type { ViewMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import { Columns3, List } from "lucide-react";
import * as React from "react";

/**
 * List ↔ Board segmented control. Lives in the page header actions; the
 * words and order match the sidebar's vocabulary so switching layouts never
 * feels like changing apps.
 */
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
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-muted)] p-0.5"
    >
      <Segment active={mode === "list"} onClick={() => onChange("list")} icon={List} label="List" />
      <Segment
        active={mode === "board"}
        onClick={() => onChange("board")}
        icon={Columns3}
        label="Board"
      />
    </div>
  );
}

function Segment({
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
        "inline-flex h-[26px] items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5",
        "text-[12.5px] font-medium transition-colors duration-150 ease-[var(--ease-product)]",
        active
          ? "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_1px_oklch(0%_0_0/0.06)]"
          : "text-[var(--fg-subtle)] hover:text-[var(--fg-muted)]",
      )}
    >
      <Icon size={13} className="opacity-90" />
      {label}
    </button>
  );
}

"use client";

import { type ViewMode, setViewMode, useViewMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import { Columns3, Rows3 } from "lucide-react";
import * as React from "react";

/**
 * List / Board. A preference, not a destination — the route stays put.
 * Radiogroup so the choice is one control, and arrows don't leave the page.
 */
export function ViewToggle() {
  const mode = useViewMode();

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    setViewMode(e.key === "ArrowRight" ? "board" : "list");
  };

  return (
    <div
      role="radiogroup"
      aria-label="Layout"
      onKeyDown={onKeyDown}
      className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5"
    >
      <ModeRadio mode="list" current={mode} icon={<Rows3 size={13} />} label="List" />
      <ModeRadio mode="board" current={mode} icon={<Columns3 size={13} />} label="Board" />
    </div>
  );
}

function ModeRadio({
  mode,
  current,
  icon,
  label,
}: {
  mode: ViewMode;
  current: ViewMode;
  icon: React.ReactNode;
  label: string;
}) {
  const selected = current === mode;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => setViewMode(mode)}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5",
        "text-[12.5px] transition-colors duration-150 ease-[var(--ease-product)]",
        selected
          ? "bg-[var(--surface-muted)] text-[var(--fg)] shadow-[inset_0_0_0_1px_var(--border-strong)]"
          : "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

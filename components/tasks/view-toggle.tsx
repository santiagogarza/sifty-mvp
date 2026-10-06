"use client";

import { cn } from "@/lib/utils/cn";
import { type ViewMode, setViewMode, useViewMode } from "./use-view-mode";

export function ViewToggle() {
  const mode = useViewMode();
  return (
    <div
      role="radiogroup"
      aria-label="Layout"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5"
    >
      <ModeRadio mode="list" current={mode} />
      <ModeRadio mode="board" current={mode} />
    </div>
  );
}

function ModeRadio({ mode, current }: { mode: ViewMode; current: ViewMode }) {
  const active = current === mode;
  const label = mode === "list" ? "List" : "Board";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => setViewMode(mode)}
      className={cn(
        "h-7 rounded-[5px] px-2.5 text-[12.5px]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        active
          ? "bg-[var(--surface-muted)] text-[var(--fg)] shadow-[inset_0_0_0_1px_var(--border-strong)]"
          : "text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-muted)]",
      )}
    >
      {label}
    </button>
  );
}

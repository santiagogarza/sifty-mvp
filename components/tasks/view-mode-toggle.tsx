"use client";

import { type TaskViewMode, useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { Columns3, ListTodo } from "lucide-react";
import { usePathname } from "next/navigation";
import * as React from "react";

/**
 * List | Board segmented control for task views.
 *
 * The choice is remembered per route and List stays the default — the board
 * is opt-in. Labels stay visible (not icon-only) so the control is legible
 * without a tooltip: one decision, two familiar words.
 */
export function ViewModeToggle() {
  const pathname = usePathname() ?? "/";
  const mode = useStore((s) => s.viewModes[pathname] ?? "list");
  const setViewMode = useStore((s) => s.setViewMode);

  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
    >
      <ModeButton
        mode="list"
        current={mode}
        label="List"
        icon={<ListTodo size={13} />}
        onSelect={() => setViewMode(pathname, "list")}
      />
      <ModeButton
        mode="board"
        current={mode}
        label="Board"
        icon={<Columns3 size={13} />}
        onSelect={() => setViewMode(pathname, "board")}
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
  onSelect: () => void;
}) {
  const active = current === mode;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-xs)] py-1 pl-2 pr-2.5",
        "text-[13px] leading-[18px]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        active
          ? "bg-[var(--surface)] font-medium text-[var(--fg)] shadow-[0_1px_2px_rgba(0,0,0,0.18)]"
          : "font-normal text-[var(--fg-muted)] hover:text-[var(--fg)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

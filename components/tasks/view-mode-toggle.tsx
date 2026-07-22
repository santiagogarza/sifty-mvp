"use client";

import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { type TasksViewMode, useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { Columns3, LayoutList } from "lucide-react";
import * as React from "react";

const OPTIONS: {
  mode: TasksViewMode;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}[] = [
  { mode: "list", label: "List view", icon: LayoutList },
  { mode: "board", label: "Board view", icon: Columns3 },
];

/**
 * Subtle Linear-style list/board switcher. Persists via the store so the
 * choice survives reloads without becoming a primary chrome element.
 */
export function ViewModeToggle({ className }: { className?: string }) {
  const mode = useStore((s) => s.tasksViewMode);
  const setMode = useStore((s) => s.setTasksViewMode);

  return (
    <TooltipProvider>
      <div
        role="group"
        aria-label="View mode"
        className={cn(
          "inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--border)]",
          "bg-[var(--surface-muted)]/70 p-0.5",
          className,
        )}
      >
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = mode === opt.mode;
          return (
            <Tooltip key={opt.mode} label={opt.label} side="bottom">
              <button
                type="button"
                aria-label={opt.label}
                aria-pressed={active}
                onClick={() => setMode(opt.mode)}
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-[5px]",
                  "text-[var(--fg-subtle)] transition-colors duration-150 ease-[var(--ease-product)]",
                  "hover:text-[var(--fg)]",
                  active &&
                    "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_2px_oklch(0%_0_0/0.06)]",
                )}
              >
                <Icon size={14} strokeWidth={2} />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

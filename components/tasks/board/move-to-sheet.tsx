"use client";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import * as React from "react";
import { STATUS_ICONS } from "../status-icon";

/**
 * Mobile filing: long-pressing a card opens this bottom sheet instead of
 * touch-dragging — dragging inside a horizontally snap-scrolling strip
 * fights the scroll. Same five destinations as the columns, same icons as
 * the sidebar (recognition over recall), with the current status marked.
 */
export function MoveToSheet({
  task,
  onClose,
  onMove,
}: {
  task: Task | null;
  onClose: () => void;
  onMove: (task: Task, to: Lifecycle) => void;
}) {
  return (
    <Sheet
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="p-4 sm:w-[min(400px,90vw)]" aria-describedby={undefined}>
        <SheetTitle>Move to</SheetTitle>
        {task ? (
          <p className="mt-0.5 truncate text-[13px] text-[var(--fg-muted)]">{task.title}</p>
        ) : null}
        <div className="mt-3 flex flex-col gap-0.5 overflow-y-auto">
          {STATUS_VIEWS.map((view) => {
            const Icon = STATUS_ICONS[view.status];
            const current = task?.lifecycle === view.status;
            return (
              <button
                key={view.status}
                type="button"
                disabled={current}
                onClick={() => {
                  if (task) {
                    onMove(task, view.status);
                    onClose();
                  }
                }}
                className={cn(
                  "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left",
                  "transition-colors duration-150 ease-[var(--ease-product)]",
                  current
                    ? "bg-[var(--surface-muted)]"
                    : "hover:bg-[var(--surface-hover)] active:bg-[var(--surface-hover)]",
                )}
              >
                <Icon size={15} className="shrink-0 opacity-80" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-[var(--fg)]">{view.label}</span>
                  <span className="block truncate text-[12px] text-[var(--fg-muted)]">
                    {view.description}
                  </span>
                </span>
                {current ? (
                  <span className="shrink-0 text-[11px] text-[var(--fg-subtle)]">Current</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

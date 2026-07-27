"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { Check } from "lucide-react";
import * as React from "react";

/**
 * The phone's answer to dragging.
 *
 * A drag inside a horizontally scrolling strip fights the scroll, so on
 * touch a press-and-hold opens this instead: the same five columns, the
 * same words and icons, with the card's current status marked so the
 * sheet says where the task is before it asks where it should go.
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
    <Sheet open={!!task} onOpenChange={(v) => !v && onClose()}>
      <SheetContent aria-describedby={undefined} className="sm:w-[min(420px,90vw)]">
        {task ? (
          <div className="flex flex-col gap-1 p-4">
            <SheetTitle className="text-[13px] font-normal text-[var(--fg-muted)]">
              Move to
            </SheetTitle>
            <p className="mb-2 line-clamp-2 text-[15px] text-[var(--fg)]">{task.title}</p>
            {STATUS_VIEWS.map(({ status, label, description }) => {
              const current = task.lifecycle === status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => {
                    if (!current) onMove(task, status);
                    onClose();
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-3 text-left",
                    "transition-colors duration-150 ease-[var(--ease-product)]",
                    current ? "bg-[var(--surface-muted)]" : "hover:bg-[var(--surface-muted)]",
                  )}
                >
                  <StatusIcon status={status} size={16} className="text-[var(--fg-muted)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] text-[var(--fg)]">{label}</span>
                    <span className="block truncate text-[12px] text-[var(--fg-muted)]">
                      {description}
                    </span>
                  </span>
                  {current ? <Check size={14} className="text-[var(--accent)]" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

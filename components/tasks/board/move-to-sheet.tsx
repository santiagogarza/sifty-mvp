"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { STATUS_VIEWS, statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";

export function MoveToSheet({
  task,
  open,
  onOpenChange,
  onMove,
}: {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (task: Task, lifecycle: Lifecycle) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:hidden">
        <div className="p-4">
          <SheetTitle>Move to</SheetTitle>
          <SheetDescription className="mt-1 text-[13px] text-[var(--fg-muted)]">
            {task ? `Currently in ${statusLabel(task.lifecycle)}.` : "Choose a status."}
          </SheetDescription>
        </div>
        <div className="flex flex-col gap-1 px-3 pb-5">
          {STATUS_VIEWS.map((view) => {
            const active = task?.lifecycle === view.status;
            return (
              <Button
                key={view.status}
                variant="ghost"
                className={cn(
                  "h-11 justify-start px-3 text-[14px]",
                  active && "bg-[var(--surface-muted)] text-[var(--fg)]",
                )}
                onClick={() => {
                  if (task && !active) onMove(task, view.status);
                  onOpenChange(false);
                }}
              >
                <StatusIcon status={view.status} size={16} />
                {view.label}
                {active ? (
                  <span className="ml-auto text-[12px] text-[var(--fg-subtle)]">Current</span>
                ) : null}
              </Button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

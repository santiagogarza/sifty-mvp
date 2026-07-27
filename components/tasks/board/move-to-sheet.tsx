"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { STATUS_VIEWS } from "@/lib/domain/status";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { Check } from "lucide-react";

export function MoveToSheet({
  open,
  onOpenChange,
  currentStatus,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStatus: Lifecycle;
  onMove: (status: Lifecycle) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <div className="px-5 pt-5 pb-3 border-b border-[var(--border)]">
          <SheetTitle>Move to</SheetTitle>
        </div>
        <ul className="flex flex-col gap-0.5 p-3">
          {STATUS_VIEWS.map((view) => {
            const selected = view.status === currentStatus;
            return (
              <li key={view.status}>
                <button
                  type="button"
                  onClick={() => {
                    onMove(view.status);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5",
                    "text-[14px] transition-colors hover:bg-[var(--surface-muted)]",
                    selected && "bg-[var(--surface-muted)]",
                  )}
                >
                  <StatusIcon status={view.status} size={16} className="text-[var(--fg-muted)]" />
                  <span className="flex-1 text-left">{statusLabel(view.status)}</span>
                  {selected ? <Check size={16} className="text-[var(--accent)]" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { STATUS_VIEWS, statusLabel } from "@/lib/domain/status";
import type { Lifecycle } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { Check } from "lucide-react";
import * as React from "react";

/**
 * Mobile "Move to" sheet. Long-press opens this instead of fighting the
 * horizontal column scroll with a drag gesture.
 */
export function MoveToSheet({
  open,
  onOpenChange,
  currentStatus,
  taskTitle,
  onMove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStatus: Lifecycle;
  taskTitle: string;
  onMove: (status: Lifecycle) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <div className="px-5 pt-4 pb-2">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--border-strong)]" />
          <SheetTitle>Move to</SheetTitle>
          <SheetDescription className="mt-1 text-[13px] text-[var(--fg-muted)] truncate">
            {taskTitle}
          </SheetDescription>
        </div>
        <div className="flex flex-col px-2 pb-6">
          {STATUS_VIEWS.map((view) => {
            const active = view.status === currentStatus;
            return (
              <button
                key={view.status}
                type="button"
                disabled={active}
                onClick={() => {
                  onMove(view.status);
                  onOpenChange(false);
                }}
                className={cn(
                  "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-3 text-left",
                  "text-[14px] text-[var(--fg)]",
                  "transition-colors duration-150 ease-[var(--ease-product)]",
                  !active && "hover:bg-[var(--surface-muted)] active:bg-[var(--surface-hover)]",
                  active && "text-[var(--fg-muted)]",
                )}
              >
                <StatusIcon status={view.status} size={16} className="opacity-80" />
                <span className="flex-1">{statusLabel(view.status)}</span>
                {active ? <Check size={14} className="text-[var(--accent)]" /> : null}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

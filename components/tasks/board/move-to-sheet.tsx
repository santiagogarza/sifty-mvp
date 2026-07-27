"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import * as React from "react";

export function MoveToSheet({
  task,
  onMove,
  onClose,
}: {
  task: Task | null;
  onMove: (task: Task, status: Lifecycle) => void;
  onClose: () => void;
}) {
  React.useEffect(() => {
    if (!task) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [task, onClose]);

  if (!task) return null;
  return (
    <div
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Move task"
    >
      <button
        type="button"
        aria-label="Close move menu"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-[var(--radius-xl)] border-t border-[var(--border)] bg-[var(--bg-elevated)] px-4 pb-[max(env(safe-area-inset-bottom),20px)] pt-3 shadow-[0_-16px_48px_oklch(0%_0_0/0.28)]">
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-[var(--border-strong)]" />
        <h2 className="text-[16px] font-medium text-[var(--fg)]">Move to</h2>
        <p className="mt-1 truncate text-[13px] text-[var(--fg-muted)]">{task.title}</p>
        <div className="mt-4 flex flex-col gap-1">
          {STATUS_VIEWS.map(({ status, label }) => {
            const current = status === task.lifecycle;
            return (
              <button
                key={status}
                type="button"
                disabled={current}
                onClick={() => onMove(task, status)}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-3 text-[14px]",
                  current
                    ? "bg-[var(--surface-muted)] text-[var(--fg-subtle)]"
                    : "text-[var(--fg)] active:bg-[var(--surface-hover)]",
                )}
              >
                <StatusIcon status={status} size={17} />
                <span className="flex-1 text-left">{label}</span>
                {current ? <span className="text-[12px]">Current</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

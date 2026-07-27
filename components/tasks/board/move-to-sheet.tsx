"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import type { BoardColumnData } from "@/lib/store/selectors";
import { cn } from "@/lib/utils/cn";
import { Check } from "lucide-react";
import * as React from "react";
import { BoardCard } from "./board-card";

/**
 * The board on a phone.
 *
 * No drag — dragging inside a horizontally scrolling strip fights the scroll.
 * Columns snap-scroll with the next one peeking, a status pager jumps between
 * them, and a long-press opens a "Move to" sheet. Different affordance, same
 * outcome as the desktop drag.
 */
export function MobileBoard({
  columns,
  labels,
  onOpen,
  moveTask,
}: {
  columns: BoardColumnData[];
  labels: Label[];
  onOpen: (id: string) => void;
  moveTask: (taskId: string, toStatus: Lifecycle) => void;
}) {
  const stripRef = React.useRef<HTMLDivElement>(null);
  const columnRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = React.useState(0);
  const [sheetTask, setSheetTask] = React.useState<Task | null>(null);

  const onScroll = () => {
    const strip = stripRef.current;
    if (!strip) return;
    const width = columnRefs.current[0]?.offsetWidth ?? 300;
    setActive(Math.round(strip.scrollLeft / (width + 12)));
  };

  const jumpTo = (index: number) => {
    columnRefs.current[index]?.scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  };

  return (
    <div className="flex flex-col">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {columns.map((column, i) => (
          <button
            key={column.status}
            type="button"
            onClick={() => jumpTo(i)}
            aria-current={active === i}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]",
              active === i
                ? "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--fg-muted)]",
            )}
          >
            <StatusIcon status={column.status} size={13} />
            {column.label}
            <span className="text-num tabular-nums opacity-70">{column.tasks.length}</span>
          </button>
        ))}
      </div>

      <div
        ref={stripRef}
        onScroll={onScroll}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {columns.map((column, i) => (
          <div
            key={column.status}
            ref={(el) => {
              columnRefs.current[i] = el;
            }}
            className="flex w-[82vw] max-w-[300px] shrink-0 snap-start flex-col"
          >
            <div className="flex h-6 items-center gap-1.5 px-1">
              <StatusIcon status={column.status} size={16} className="text-[var(--fg-muted)]" />
              <span className="flex-1 truncate text-[13px] font-medium text-[var(--fg)]">
                {column.label}
              </span>
              <span className="text-num text-[11px] font-medium tabular-nums text-[var(--fg-subtle)]">
                {column.tasks.length}
              </span>
            </div>
            <div className="mt-2 flex min-h-[64px] flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)]/50 p-2">
              {column.tasks.map((task) => (
                <LongPressCard
                  key={task.id}
                  task={task}
                  labels={labels}
                  onTap={() => onOpen(task.id)}
                  onLongPress={() => setSheetTask(task)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <MoveToSheet
        task={sheetTask}
        onClose={() => setSheetTask(null)}
        onMove={(status) => {
          if (sheetTask) moveTask(sheetTask.id, status);
          setSheetTask(null);
        }}
      />
    </div>
  );
}

const LONG_PRESS_MS = 420;
const MOVE_TOLERANCE = 10;

function LongPressCard({
  task,
  labels,
  onTap,
  onLongPress,
}: {
  task: Task;
  labels: Label[];
  onTap: () => void;
  onLongPress: () => void;
}) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = React.useRef<{ x: number; y: number } | null>(null);
  const fired = React.useRef(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <div
      onPointerDown={(e) => {
        origin.current = { x: e.clientX, y: e.clientY };
        fired.current = false;
        cancel();
        timer.current = setTimeout(() => {
          fired.current = true;
          onLongPress();
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        if (!origin.current) return;
        if (
          Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > MOVE_TOLERANCE
        ) {
          cancel();
          origin.current = null;
        }
      }}
      onPointerUp={() => {
        cancel();
        if (!fired.current) onTap();
        origin.current = null;
      }}
      onPointerCancel={cancel}
    >
      <BoardCard task={task} labels={labels} onOpen={() => {}} />
    </div>
  );
}

function MoveToSheet({
  task,
  onClose,
  onMove,
}: {
  task: Task | null;
  onClose: () => void;
  onMove: (status: Lifecycle) => void;
}) {
  return (
    <Sheet open={!!task} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-[440px]">
        <div className="px-5 pt-5 pb-2">
          <SheetTitle>Move to</SheetTitle>
          {task ? (
            <p className="mt-1 truncate text-[13px] text-[var(--fg-muted)]">{task.title}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-0.5 px-3 pb-[max(env(safe-area-inset-bottom),16px)]">
          {STATUS_VIEWS.map((view) => {
            const current = task?.lifecycle === view.status;
            return (
              <button
                key={view.status}
                type="button"
                onClick={() => onMove(view.status)}
                aria-current={current}
                className={cn(
                  "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-3 text-left",
                  "text-[14px] text-[var(--fg)] hover:bg-[var(--surface-hover)]",
                )}
              >
                <StatusIcon
                  status={view.status}
                  size={16}
                  className={current ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"}
                />
                <span className="flex-1">{view.label}</span>
                {current ? <Check size={15} className="text-[var(--accent)]" /> : null}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

"use client";

import {
  BOARD_COLUMNS,
  type BoardColumn,
  adjacentBoardColumn,
  lifecycleLabel,
} from "@/lib/domain/lifecycle";
import { focusScore } from "@/lib/domain/priority";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import * as React from "react";
import { TaskBoardCard } from "./task-board-card";

const DRAG_THRESHOLD_PX = 5;

type DragSession = {
  taskId: string;
  from: Lifecycle;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  active: boolean;
  over: BoardColumn | null;
  x: number;
  y: number;
};

function sortColumnTasks(tasks: Task[], column: BoardColumn): Task[] {
  const now = new Date();
  if (column === "active" || column === "inbox") {
    return [...tasks].sort(
      (a, b) =>
        focusScore({
          bucket: a.priorityBucket,
          importance: a.importance,
          urgency: a.urgency,
          due: a.due,
          now,
        }) -
        focusScore({
          bucket: b.priorityBucket,
          importance: b.importance,
          urgency: b.urgency,
          due: b.due,
          now,
        }),
    );
  }
  return [...tasks].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function columnUnderPoint(x: number, y: number): BoardColumn | null {
  const el = document.elementFromPoint(x, y);
  const column = el?.closest<HTMLElement>("[data-board-column]");
  const value = column?.dataset.boardColumn;
  if (!value) return null;
  return (BOARD_COLUMNS as readonly string[]).includes(value) ? (value as BoardColumn) : null;
}

/**
 * Kanban board across GTD lifecycle columns. Pointer-based drag (not HTML5
 * DnD) so desktop and touch feel the same, with keyboard left/right moves
 * as a non-mouse path for changing status.
 */
export function TaskBoard({
  tasks,
  onOpen,
  highlightColumn,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  /** Soft-highlight a column when arriving from a matching list route. */
  highlightColumn?: BoardColumn | null;
}) {
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement | null>());
  const dragRef = React.useRef<DragSession | null>(null);
  const suppressClickRef = React.useRef(false);
  const [drag, setDrag] = React.useState<DragSession | null>(null);
  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const columns = React.useMemo(() => {
    const map = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, [] as Task[]])) as Record<
      BoardColumn,
      Task[]
    >;
    for (const task of tasks) {
      if (task.lifecycle === "dropped") continue;
      if ((BOARD_COLUMNS as readonly string[]).includes(task.lifecycle)) {
        map[task.lifecycle as BoardColumn].push(task);
      }
    }
    for (const column of BOARD_COLUMNS) {
      map[column] = sortColumnTasks(map[column], column);
    }
    return map;
  }, [tasks]);

  const flatIds = React.useMemo(
    () => BOARD_COLUMNS.flatMap((column) => columns[column].map((t) => t.id)),
    [columns],
  );

  React.useEffect(() => {
    if (highlightColumn && boardRef.current) {
      const target = boardRef.current.querySelector<HTMLElement>(
        `[data-board-column="${highlightColumn}"]`,
      );
      target?.scrollIntoView({
        inline: "center",
        block: "nearest",
        behavior: reducedMotion ? "auto" : "smooth",
      });
    }
  }, [highlightColumn, reducedMotion]);

  const updateDrag = React.useCallback((patch: Partial<DragSession>) => {
    const current = dragRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    dragRef.current = next;
    setDrag(next);
  }, []);

  const endDrag = React.useCallback(
    (commit: boolean) => {
      const session = dragRef.current;
      if (!session) return;
      const over = session.over;
      dragRef.current = null;
      setDrag(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (commit && session.active && over && over !== session.from) {
        setLifecycle(session.taskId, over);
      }
    },
    [setLifecycle],
  );

  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const session = dragRef.current;
      if (!session || e.pointerId !== session.pointerId) return;

      const dx = e.clientX - session.startX;
      const dy = e.clientY - session.startY;
      if (!session.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        suppressClickRef.current = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        updateDrag({
          active: true,
          x: e.clientX,
          y: e.clientY,
          over: columnUnderPoint(e.clientX, e.clientY) ?? (session.from as BoardColumn),
        });
        return;
      }

      updateDrag({
        x: e.clientX,
        y: e.clientY,
        over: columnUnderPoint(e.clientX, e.clientY),
      });
    };

    const onUp = (e: PointerEvent) => {
      const session = dragRef.current;
      if (!session || e.pointerId !== session.pointerId) return;
      endDrag(true);
    };

    const onCancel = () => endDrag(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [endDrag, updateDrag]);

  const beginDrag = (task: Task, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea")) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const session: DragSession = {
      taskId: task.id,
      from: task.lifecycle,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      active: false,
      over: null,
      x: e.clientX,
      y: e.clientY,
    };
    dragRef.current = session;
    setDrag(session);
    setActiveTaskId(task.id);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const focusTask = (taskId: string) => {
    setActiveTaskId(taskId);
    cardRefs.current.get(taskId)?.focus({ preventScroll: true });
  };

  const onCardKeyDown = (task: Task, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(task.id);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = adjacentBoardColumn(task.lifecycle, e.key === "ArrowLeft" ? -1 : 1);
      if (next) setLifecycle(task.id, next);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "j" || e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      const index = flatIds.indexOf(task.id);
      if (index < 0) return;
      const delta = e.key === "ArrowDown" || e.key === "j" ? 1 : -1;
      const nextId = flatIds[index + delta];
      if (nextId) focusTask(nextId);
    }
  };

  const draggingTask = drag?.active ? tasks.find((t) => t.id === drag.taskId) : null;

  return (
    <div className="relative -mx-4 sm:-mx-6 md:-mx-8">
      <div
        ref={boardRef}
        role="listbox"
        tabIndex={0}
        aria-label="Task board"
        aria-orientation="horizontal"
        className={cn(
          "flex gap-3 overflow-x-auto px-4 sm:px-6 md:px-8 pb-4",
          "snap-x snap-mandatory md:snap-none",
          "[scrollbar-width:thin] focus:outline-none",
        )}
      >
        {BOARD_COLUMNS.map((column) => {
          const columnTasks = columns[column];
          const isOver = drag?.active && drag.over === column;
          const isSource = drag?.active && drag.from === column;
          const isRouteHighlight = highlightColumn === column && !drag?.active;

          return (
            <section
              key={column}
              data-board-column={column}
              aria-label={`${lifecycleLabel(column)} column`}
              className={cn(
                "flex w-[272px] shrink-0 snap-start flex-col rounded-[var(--radius-lg)]",
                "bg-[var(--bg-sunken)]/55 border border-transparent",
                "transition-[background,border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
                isOver && "border-[var(--border-strong)] bg-[var(--surface-muted)]",
                isRouteHighlight && "border-[var(--border)]",
              )}
            >
              <header className="sticky top-0 z-[1] flex items-center gap-2 px-3 pt-3 pb-2">
                <h2 className="text-[12.5px] font-medium tracking-[-0.01em] text-[var(--fg)]">
                  {lifecycleLabel(column)}
                </h2>
                <span className="text-num text-[11.5px] text-[var(--fg-subtle)]">
                  {columnTasks.length}
                </span>
              </header>

              <div
                className={cn(
                  "flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-3",
                  isOver && "rounded-[var(--radius-md)]",
                  isSource && drag?.over && drag.over !== column && "opacity-90",
                )}
              >
                {columnTasks.map((task) => (
                  <TaskBoardCard
                    key={task.id}
                    ref={(el) => {
                      cardRefs.current.set(task.id, el);
                    }}
                    task={task}
                    labels={labels}
                    active={activeTaskId === task.id}
                    dragging={drag?.active && drag.taskId === task.id}
                    tabIndex={
                      activeTaskId === task.id || (!activeTaskId && task.id === flatIds[0]) ? 0 : -1
                    }
                    onOpen={(id) => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      onOpen(id);
                    }}
                    onPointerDownDrag={(e) => beginDrag(task, e)}
                    onKeyDown={(e) => onCardKeyDown(task, e)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {draggingTask && drag?.active ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50"
          style={{
            left: drag.x - drag.offsetX,
            top: drag.y - drag.offsetY,
            width: drag.width,
            transform: reducedMotion ? undefined : "rotate(1.25deg) scale(1.02)",
            transition: reducedMotion ? undefined : "transform 120ms var(--ease-product)",
          }}
        >
          <div className="rounded-[var(--radius-md)] shadow-[0_18px_40px_-18px_oklch(0%_0_0/0.45)] ring-1 ring-[var(--border-strong)]">
            <TaskBoardCard task={draggingTask} labels={labels} onOpen={() => {}} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function boardHighlightForPath(pathname: string | null): BoardColumn | null {
  if (!pathname) return null;
  if (pathname.startsWith("/inbox")) return "inbox";
  if (pathname.startsWith("/focus")) return "active";
  if (pathname.startsWith("/waiting")) return "waiting";
  if (pathname.startsWith("/someday")) return "someday";
  if (pathname.startsWith("/today")) return "active";
  return null;
}

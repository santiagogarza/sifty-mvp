"use client";

import { Badge } from "@/components/ui/badge";
import type { Label, Task } from "@/lib/domain/types";
import { type BoardColumn, type BoardLifecycle, selectBoardColumns } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

/**
 * Kanban board: one column per lifecycle stage, drag a card between columns
 * to move it. Card order inside a column is derived (same sorts as the list
 * views), so there is no manual reordering — dropping anywhere in a column
 * is enough.
 *
 * DnD notes:
 *  - Mouse drags need 5px of travel before they start, so a plain click
 *    still opens the detail sheet. Touch drags need a 200ms hold, so the
 *    board can scroll horizontally without picking cards up.
 *  - The floating card is a DragOverlay clone; the source card dims in
 *    place, which keeps columns from reflowing mid-drag.
 */

const COLUMN_TITLES: Record<BoardLifecycle, string> = {
  inbox: "Inbox",
  active: "Focus",
  waiting: "Waiting",
  someday: "Someday",
  done: "Done",
};

const COLUMN_DOTS: Record<BoardLifecycle, string> = {
  inbox: "bg-[var(--fg-subtle)]",
  active: "bg-[var(--accent)]",
  waiting: "bg-[var(--ai)]",
  someday: "bg-[var(--border-strong)]",
  done: "bg-[var(--done)]",
};

/** Keep the Done column skimmable — history lives in the list views. */
const DONE_VISIBLE_LIMIT = 25;

/**
 * Break out of the 820px reading column: sized and centered against the
 * <main> container (100cqw), capped for very wide screens. Browsers without
 * cqw fall back to the reading column. Shared with the board-mode page
 * header so its text lines up with the first column.
 */
export const BOARD_BREAKOUT_CLASS = "w-[min(1360px,100cqw)] ml-[calc(50%-min(1360px,100cqw)/2)]";
export const BOARD_GUTTER_CLASS = "px-4 sm:px-6 md:px-8";

// Prefer the column under the pointer; fall back to overlap so drops just
// outside a column edge still land somewhere sensible.
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

export function TaskBoard({
  onOpen,
  emptyState,
}: {
  onOpen: (id: string) => void;
  emptyState?: React.ReactNode;
}) {
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);

  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);
  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const activeTask = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const target = e.over?.id as BoardLifecycle | undefined;
    if (!target) return;
    const task = tasks.find((t) => t.id === e.active.id);
    if (!task || task.lifecycle === target) return;
    setLifecycle(task.id, target);
  };

  if (tasks.every((t) => t.lifecycle === "dropped") && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {/* select-none: a drag that starts a few px off a card must not start
          highlighting text; card text is readable in the detail sheet. */}
      <div className={cn(BOARD_BREAKOUT_CLASS, "select-none")}>
        <div
          className={cn(
            "flex gap-3 overflow-x-auto pb-10 snap-x snap-proximity",
            BOARD_GUTTER_CLASS,
          )}
        >
          {columns.map((column) => (
            <BoardColumnView
              key={column.lifecycle}
              column={column}
              labelMap={labelMap}
              onOpen={onOpen}
              dragging={activeId != null}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.32, 0.72, 0.18, 1)" }}>
        {activeTask ? <BoardCardContent task={activeTask} labelMap={labelMap} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumnView({
  column,
  labelMap,
  onOpen,
  dragging,
}: {
  column: BoardColumn;
  labelMap: Map<string, Label>;
  onOpen: (id: string) => void;
  dragging: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.lifecycle });
  const isDone = column.lifecycle === "done";
  const visible = isDone ? column.tasks.slice(0, DONE_VISIBLE_LIMIT) : column.tasks;
  const hidden = column.tasks.length - visible.length;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${COLUMN_TITLES[column.lifecycle]} column`}
      className={cn(
        "flex w-[248px] min-w-[248px] flex-1 snap-start flex-col self-start",
        "rounded-[var(--radius-lg)] border p-1.5",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        isOver
          ? "border-[var(--border-strong)] bg-[var(--surface-muted)]"
          : "border-transparent bg-[var(--bg-sunken)]/60",
      )}
    >
      <header className="flex items-center gap-2 px-2 pt-1.5 pb-2">
        <span className={cn("size-[6px] rounded-full", COLUMN_DOTS[column.lifecycle])} />
        <span className="text-[12.5px] font-medium text-[var(--fg-muted)]">
          {COLUMN_TITLES[column.lifecycle]}
        </span>
        <span className="text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]">
          {column.tasks.length}
        </span>
      </header>

      <div className="flex min-h-[96px] flex-col gap-1.5">
        {visible.map((task) => (
          <BoardCard key={task.id} task={task} labelMap={labelMap} onOpen={onOpen} />
        ))}
        {visible.length === 0 ? (
          <div
            className={cn(
              "flex h-[88px] items-center justify-center rounded-[var(--radius-md)]",
              "border border-dashed text-[11.5px]",
              "transition-opacity duration-150 ease-[var(--ease-product)]",
              dragging
                ? "border-[var(--border-strong)] text-[var(--fg-subtle)] opacity-100"
                : "border-transparent text-transparent opacity-0",
            )}
          >
            Drop here
          </div>
        ) : null}
        {hidden > 0 ? (
          <div className="px-2 py-1.5 text-[11.5px] text-[var(--fg-subtle)]">
            +{hidden} more completed
          </div>
        ) : null}
      </div>
    </section>
  );
}

function BoardCard({
  task,
  labelMap,
  onOpen,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn("animate-fade-in [touch-action:manipulation]", isDragging && "opacity-35")}
    >
      <BoardCardContent task={task} labelMap={labelMap} />
    </div>
  );
}

function BoardCardContent({
  task,
  labelMap,
  overlay,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  overlay?: boolean;
}) {
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];

  const overdue = isOverdue(task.due);
  const dueLabel = formatRelativeDay(task.due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";

  const isDone = task.lifecycle === "done";
  const hasMeta = dueLabel || taskLabels.length > 0 || task.aiStatus === "failed";

  return (
    <div
      className={cn(
        "surface-card rounded-[var(--radius-md)] px-2.5 py-2",
        "transition-shadow duration-150 ease-[var(--ease-product)]",
        overlay
          ? "shadow-lg border-[var(--border-strong)] scale-[1.02]"
          : "hover:border-[var(--border-strong)]",
      )}
    >
      <div className="flex items-start gap-2">
        <PriorityGlyph bucket={task.priorityBucket} className="mt-[3px] shrink-0" />
        <span
          className={cn(
            "min-w-0 flex-1 text-[13px] leading-[1.4] tracking-[-0.005em] line-clamp-2",
            isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </span>
      </div>
      {hasMeta ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[22px]">
          {dueLabel ? (
            <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
              {dueLabel}
            </Badge>
          ) : null}
          {taskLabels.slice(0, 2).map((label) => (
            <Badge key={label.id} tone={label.tone}>
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 2 ? (
            <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
          ) : null}
          <AiStatusInline status={task.aiStatus} />
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Badge } from "@/components/ui/badge";
import type { Label, Task } from "@/lib/domain/types";
import { BOARD_LIFECYCLES, type BoardLifecycle, selectBoardTasks } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Check, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

const COLUMN_DETAILS: Record<
  BoardLifecycle,
  { label: string; description: string; dotClass: string }
> = {
  inbox: {
    label: "Inbox",
    description: "New and unreviewed",
    dotClass: "bg-[var(--fg-subtle)]",
  },
  active: {
    label: "Focus",
    description: "Work in progress",
    dotClass: "bg-[var(--accent)]",
  },
  waiting: {
    label: "Waiting",
    description: "Blocked or delegated",
    dotClass: "bg-[var(--ai)]",
  },
  someday: {
    label: "Someday",
    description: "Ideas for later",
    dotClass: "bg-[var(--border-strong)]",
  },
  done: {
    label: "Done",
    description: "Completed work",
    dotClass: "bg-[var(--done)]",
  },
};

export function TaskBoard() {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const hydrated = useStore((s) => s.hydrated);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const grouped = React.useMemo(() => selectBoardTasks(tasks), [tasks]);
  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const activeTask = activeTaskId ? tasks.find((task) => task.id === activeTaskId) : null;

  const moveTask = React.useCallback(
    (task: Task, lifecycle: BoardLifecycle) => {
      if (task.lifecycle === lifecycle) return;
      setLifecycle(task.id, lifecycle);
      setAnnouncement(`Moved ${task.title} to ${COLUMN_DETAILS[lifecycle].label}.`);
    },
    [setLifecycle],
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveTaskId(String(active.id));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveTaskId(null);
    if (!over || !BOARD_LIFECYCLES.includes(over.id as BoardLifecycle)) return;
    const task = tasks.find((candidate) => candidate.id === active.id);
    if (task) moveTask(task, over.id as BoardLifecycle);
  };

  if (!hydrated) return <BoardSkeleton />;

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragCancel={() => setActiveTaskId(null)}
        onDragEnd={onDragEnd}
      >
        <div
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-5"
          data-testid="task-board"
        >
          {BOARD_LIFECYCLES.map((lifecycle, index) => (
            <BoardColumn
              key={lifecycle}
              lifecycle={lifecycle}
              tasks={grouped[lifecycle]}
              labels={labels}
              columnIndex={index}
              onOpen={openDetail}
              onMove={moveTask}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.32, 0.72, 0.18, 1)" }}>
          {activeTask ? <BoardCardPreview task={activeTask} labels={labels} /> : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function BoardColumn({
  lifecycle,
  tasks,
  labels,
  columnIndex,
  onOpen,
  onMove,
}: {
  lifecycle: BoardLifecycle;
  tasks: Task[];
  labels: Label[];
  columnIndex: number;
  onOpen: (id: string) => void;
  onMove: (task: Task, lifecycle: BoardLifecycle) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lifecycle });
  const details = COLUMN_DETAILS[lifecycle];

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`board-column-${lifecycle}`}
      data-testid={`board-column-${lifecycle}`}
      className={cn(
        "flex h-fit min-h-[240px] w-[82vw] shrink-0 snap-start flex-col rounded-[var(--radius-lg)]",
        "border bg-[var(--bg-sunken)]/55 p-2 transition-colors duration-150",
        "sm:w-[280px] lg:min-w-[240px] lg:flex-1",
        isOver ? "border-[var(--accent)] bg-[var(--accent-soft)]/25" : "border-[var(--border)]",
      )}
    >
      <header className="flex items-start gap-2 px-1.5 pb-2.5 pt-1">
        <span className={cn("mt-[6px] size-1.5 rounded-full", details.dotClass)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 id={`board-column-${lifecycle}`} className="text-[13px] font-medium">
              {details.label}
            </h2>
            <span className="text-num text-[11px] text-[var(--fg-subtle)]">{tasks.length}</span>
          </div>
          <p className="text-[11px] text-[var(--fg-subtle)]">{details.description}</p>
        </div>
      </header>
      <div className="flex min-h-[170px] flex-col gap-2">
        {tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            labels={labels}
            columnIndex={columnIndex}
            onOpen={onOpen}
            onMove={onMove}
          />
        ))}
        {tasks.length === 0 ? (
          <div
            className={cn(
              "flex min-h-[96px] items-center justify-center rounded-[var(--radius-md)] border border-dashed",
              "text-[11px] text-[var(--fg-subtle)]",
              isOver ? "border-[var(--accent)]/50" : "border-[var(--border)]",
            )}
          >
            Drop tasks here
          </div>
        ) : null}
      </div>
    </section>
  );
}

function BoardCard({
  task,
  labels,
  columnIndex,
  onOpen,
  onMove,
}: {
  task: Task;
  labels: Label[];
  columnIndex: number;
  onOpen: (id: string) => void;
  onMove: (task: Task, lifecycle: BoardLifecycle) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`board-card-${task.id}`}
      className={cn("relative", isDragging && "z-10 opacity-30")}
    >
      <BoardCardContent task={task} labels={labels} onOpen={onOpen}>
        <div className="flex items-center gap-0.5">
          <MoveButton
            direction="left"
            disabled={columnIndex === 0}
            onClick={() => onMove(task, BOARD_LIFECYCLES[columnIndex - 1]!)}
          />
          <button
            type="button"
            aria-label={`Drag ${task.title}`}
            className="touch-none rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
            onClick={(event) => event.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={13} />
          </button>
          <MoveButton
            direction="right"
            disabled={columnIndex === BOARD_LIFECYCLES.length - 1}
            onClick={() => onMove(task, BOARD_LIFECYCLES[columnIndex + 1]!)}
          />
        </div>
      </BoardCardContent>
    </div>
  );
}

function MoveButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Move task ${direction}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="rounded p-1 text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] disabled:pointer-events-none disabled:opacity-20"
    >
      <Icon size={13} />
    </button>
  );
}

function BoardCardPreview({ task, labels }: { task: Task; labels: Label[] }) {
  return (
    <div className="w-[280px] rotate-[1deg] shadow-[0_12px_30px_oklch(0%_0_0/0.16)]">
      <BoardCardContent task={task} labels={labels}>
        <GripVertical size={13} className="text-[var(--fg-subtle)]" />
      </BoardCardContent>
    </div>
  );
}

function BoardCardContent({
  task,
  labels,
  onOpen,
  children,
}: {
  task: Task;
  labels: Label[];
  onOpen?: (id: string) => void;
  children: React.ReactNode;
}) {
  const taskLabels = task.labelIds
    .map((id) => labels.find((label) => label.id === id))
    .filter(Boolean) as Label[];
  const dueLabel = formatRelativeDay(task.due);
  const dueTone = isOverdue(task.due) ? "rose" : isToday(task.due) ? "ember" : "neutral";
  const isDone = task.lifecycle === "done";

  return (
    <article
      onClick={onOpen ? () => onOpen(task.id) : undefined}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === "Enter") onOpen(task.id);
            }
          : undefined
      }
      tabIndex={onOpen ? 0 : undefined}
      className={cn(
        "surface-card group p-2.5 shadow-[0_1px_2px_oklch(0%_0_0/0.025)]",
        "transition-[border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
        onOpen &&
          "cursor-default hover:border-[var(--border-strong)] hover:shadow-[0_2px_8px_oklch(0%_0_0/0.05)]",
      )}
    >
      <div className="flex items-start gap-2">
        <PriorityGlyph bucket={task.priorityBucket} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "text-[13px] leading-[1.4] text-[var(--fg)]",
              isDone && "text-[var(--fg-subtle)] line-through decoration-[1.5px]",
            )}
          >
            {task.title}
          </h3>
          {task.nextAction && !isDone ? (
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-[1.4] text-[var(--fg-muted)]">
              {task.nextAction}
            </p>
          ) : null}
          <AiStatusInline status={task.aiStatus} className="mt-1" />
        </div>
        {children}
      </div>
      {taskLabels.length > 0 || dueLabel || isDone ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2">
          {isDone ? <Check size={12} className="text-[var(--done)]" /> : null}
          {taskLabels.slice(0, 2).map((label) => (
            <Badge key={label.id} tone={label.tone}>
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 2 ? (
            <span className="text-[10.5px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
          ) : null}
          {dueLabel ? (
            <Badge
              tone={dueTone}
              variant={dueTone === "neutral" ? "outline" : "soft"}
              className="ml-auto"
            >
              {dueLabel}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {BOARD_LIFECYCLES.map((lifecycle) => (
        <div
          key={lifecycle}
          className="h-[320px] w-[280px] shrink-0 animate-pulse rounded-[var(--radius-lg)] bg-[var(--surface-muted)]"
        />
      ))}
    </div>
  );
}

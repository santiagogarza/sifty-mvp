"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { focusScore } from "@/lib/domain/priority";
import { type Label, type Lifecycle, type Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
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
import * as React from "react";
import { BoardCard } from "./board-card";

/**
 * Kanban board view.
 *
 * Columns are GTD lifecycle stages; dragging a card to another column is the
 * status change (Linear-style). The board is workspace-wide by design — the
 * whole point of the board is to see every stage at once, which the per-tab
 * lists can't do.
 *
 * Drag mechanics:
 *  - Only columns are drop targets; cards are drag sources. Collision by
 *    closest corners so dropping anywhere in a column (even an empty one)
 *    lands cleanly.
 *  - A 6px activation distance keeps a plain click opening the detail sheet
 *    instead of starting a phantom drag.
 *  - `updateTask({ lifecycle })` already handles `completedAt` and the
 *    background sync, so a drop is durable with no extra wiring.
 */

interface Column {
  lifecycle: Lifecycle;
  title: string;
  hint: string;
}

const COLUMNS: Column[] = [
  { lifecycle: "inbox", title: "Inbox", hint: "Newly captured" },
  { lifecycle: "active", title: "Focus", hint: "Committed work" },
  { lifecycle: "waiting", title: "Waiting", hint: "Handed off" },
  { lifecycle: "someday", title: "Someday", hint: "Not now" },
  { lifecycle: "done", title: "Done", hint: "Completed" },
];

const COLUMN_ORDER = COLUMNS.map((c) => c.lifecycle);

function groupByLifecycle(tasks: Task[]): Record<Lifecycle, Task[]> {
  const groups = {
    inbox: [] as Task[],
    active: [] as Task[],
    waiting: [] as Task[],
    someday: [] as Task[],
    done: [] as Task[],
    dropped: [] as Task[],
  } satisfies Record<Lifecycle, Task[]>;

  for (const t of tasks) {
    if (t.lifecycle === "dropped") continue;
    groups[t.lifecycle].push(t);
  }

  const now = new Date();
  for (const key of COLUMN_ORDER) {
    if (key === "done") {
      groups.done.sort((a, b) => (completedKey(b) < completedKey(a) ? -1 : 1));
    } else {
      groups[key].sort(
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
  }
  return groups;
}

function completedKey(t: Task): string {
  return t.completedAt ?? t.updatedAt;
}

export function TaskBoard() {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const hydrated = useStore((s) => s.hydrated);
  const updateTask = useStore((s) => s.updateTask);

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overColumn, setOverColumn] = React.useState<Lifecycle | null>(null);

  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const grouped = React.useMemo(() => groupByLifecycle(tasks), [tasks]);
  const activeTask = React.useMemo(
    () => (activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null),
    [activeId, tasks],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  if (!hydrated) return <BoardSkeleton />;

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    const from = e.active.data.current?.lifecycle as Lifecycle | undefined;
    setOverColumn(from ?? null);
  };

  const onDragOver = (e: DragOverEvent) => {
    const over = e.over?.id;
    setOverColumn(over ? (String(over) as Lifecycle) : null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    const target = e.over ? (String(e.over.id) as Lifecycle) : null;
    setActiveId(null);
    setOverColumn(null);
    if (!target || !COLUMN_ORDER.includes(target)) return;
    const task = tasks.find((t) => t.id === id);
    if (task && task.lifecycle !== target) {
      updateTask(id, { lifecycle: target });
    }
  };

  const onDragCancel = () => {
    setActiveId(null);
    setOverColumn(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex flex-1 min-h-0 gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
        {COLUMNS.map((col) => (
          <BoardColumn
            key={col.lifecycle}
            column={col}
            tasks={grouped[col.lifecycle]}
            labelMap={labelMap}
            activeId={activeId}
            isOver={overColumn === col.lifecycle}
            onOpen={openDetail}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.32, 0.72, 0.18, 1)" }}>
        {activeTask ? <BoardCard task={activeTask} labelMap={labelMap} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  column,
  tasks,
  labelMap,
  activeId,
  isOver,
  onOpen,
}: {
  column: Column;
  tasks: Task[];
  labelMap: Map<string, Label>;
  activeId: string | null;
  isOver: boolean;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef } = useDroppable({ id: column.lifecycle });

  return (
    <section
      ref={setNodeRef}
      aria-label={column.title}
      className={cn(
        "flex w-[280px] shrink-0 flex-col rounded-[var(--radius-lg)] border",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        isOver
          ? "border-[var(--accent)]/50 bg-[var(--accent-soft)]/30"
          : "border-[var(--border)] bg-[var(--surface-muted)]/40",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="text-[13px] font-medium tracking-[-0.01em] text-[var(--fg)]">
          {column.title}
        </span>
        <span className="text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]">
          {tasks.length}
        </span>
        <span className="ml-auto text-[11px] text-[var(--fg-subtle)]">{column.hint}</span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {tasks.length === 0 ? (
          <div
            className={cn(
              "mt-1 rounded-[var(--radius-md)] border border-dashed px-3 py-6 text-center text-[12px]",
              isOver
                ? "border-[var(--accent)]/40 text-[var(--fg-muted)]"
                : "border-[var(--border)] text-[var(--fg-subtle)]",
            )}
          >
            Drop here
          </div>
        ) : (
          tasks.map((task) => (
            <DraggableCard
              key={task.id}
              task={task}
              labelMap={labelMap}
              dragging={activeId === task.id}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </section>
  );
}

function DraggableCard({
  task,
  labelMap,
  dragging,
  onOpen,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  dragging: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { lifecycle: task.lifecycle },
  });

  return (
    <BoardCard
      ref={setNodeRef}
      task={task}
      labelMap={labelMap}
      dragging={dragging || isDragging}
      aria-label={`${task.title}. Press space to pick up, arrow keys to move between columns, space to drop.`}
      onClick={() => onOpen(task.id)}
      {...listeners}
      {...attributes}
    />
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-1 min-h-0 gap-3 overflow-hidden pb-4">
      {COLUMNS.map((col) => (
        <div
          key={col.lifecycle}
          className="flex w-[280px] shrink-0 flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)]/40"
        >
          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
            <Skeleton className="h-3.5 w-16 rounded" />
          </div>
          <div className="flex flex-col gap-2 px-2 pb-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-[var(--radius-md)]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

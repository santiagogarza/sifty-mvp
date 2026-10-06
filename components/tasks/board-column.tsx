"use client";

import { statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import * as React from "react";
import { BoardCardFace } from "./board-card";
import { StatusIcon } from "./status-icon";

export function BoardColumn({
  status,
  tasks,
  labels,
  count,
  dragFrom,
  pulse,
  selectedId,
  landedId,
  onOpen,
  onComplete,
  onAdd,
}: {
  status: Lifecycle;
  tasks: Task[];
  labels: Label[];
  count: number;
  dragFrom: Lifecycle | null;
  pulse: boolean;
  selectedId: string | null;
  landedId: string | null;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
  onAdd: (status: Lifecycle) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const label = statusLabel(status);
  const highlight = isOver && dragFrom !== null && dragFrom !== status;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${count}`}
      data-status={status}
      className={cn(
        "flex w-[288px] shrink-0 snap-start flex-col rounded-[var(--radius-lg)] border px-2 py-2",
        "max-h-[calc(100dvh-15rem)]",
        "md:w-auto md:min-w-[200px] md:flex-1",
        highlight
          ? "border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent-soft)_35%,transparent)]"
          : "border-transparent",
      )}
    >
      <header className="flex items-center gap-1.5 px-1 pb-2">
        <StatusIcon status={status} size={14} className="text-[var(--fg-muted)]" />
        <h2 className="text-[13px] font-medium text-[var(--fg)]">{label}</h2>
        <span
          className={cn(
            "text-num ml-auto text-[11.5px] text-[var(--fg-subtle)]",
            pulse && "animate-count-pulse",
          )}
        >
          {count}
        </span>
      </header>
      <div
        data-testid="column-scroll"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
      >
        {tasks.length === 0 ? (
          <div data-empty-drop="" className="h-[88px]" />
        ) : (
          tasks.map((task) => (
            <DraggableCard
              key={task.id}
              task={task}
              labels={labels}
              selected={task.id === selectedId}
              landed={task.id === landedId}
              onOpen={onOpen}
              onComplete={onComplete}
            />
          ))
        )}
      </div>
      <button
        type="button"
        aria-label={`Add to ${label}`}
        onClick={() => onAdd(status)}
        className="mt-1 flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1.5 text-[12.5px] text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
      >
        <Plus size={12} />
        Add
      </button>
    </section>
  );
}

function DraggableCard({
  task,
  labels,
  selected,
  landed,
  onOpen,
  onComplete,
}: {
  task: Task;
  labels: Label[];
  selected: boolean;
  landed: boolean;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
}) {
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  // A real drag ends with a click. Swallow that one so the sheet stays closed.
  const suppressClick = React.useRef(false);
  React.useEffect(() => {
    if (isDragging) suppressClick.current = true;
  }, [isDragging]);

  return (
    <BoardCardFace
      task={task}
      labels={labels}
      selected={selected}
      landed={landed}
      dragging={isDragging}
      setNodeRef={setNodeRef}
      listeners={listeners}
      onOpen={(id) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onOpen(id);
      }}
      onComplete={onComplete}
    />
  );
}

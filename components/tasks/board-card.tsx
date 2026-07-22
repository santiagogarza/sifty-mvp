"use client";

import { Badge } from "@/components/ui/badge";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

/**
 * Board card.
 *
 * A condensed, spatial rendering of a task: the title leads, the next
 * action stays visible (it's the most actionable line in the app), and the
 * meta chips reuse the row's visual language so both layouts read the same.
 * The whole card is the drag handle; clicks still open the detail sheet
 * because pointer drags only activate after a few pixels of travel.
 */
export function BoardCard({
  task,
  labels,
  tabbable,
  focused,
  onOpen,
  onFocus,
  registerNode,
}: {
  task: Task;
  labels: Label[];
  tabbable: boolean;
  focused: boolean;
  onOpen: (id: string) => void;
  onFocus: (id: string) => void;
  registerNode: (id: string, el: HTMLElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });

  const setRefs = React.useCallback(
    (el: HTMLElement | null) => {
      setNodeRef(el);
      registerNode(task.id, el);
    },
    [setNodeRef, registerNode, task.id],
  );

  return (
    <div
      ref={setRefs}
      {...attributes}
      {...listeners}
      role="option"
      aria-selected={focused}
      tabIndex={tabbable ? 0 : -1}
      data-task-id={task.id}
      onFocus={() => onFocus(task.id)}
      onClick={() => onOpen(task.id)}
      className={cn(
        "shrink-0 select-none rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]",
        "shadow-[0_1px_2px_oklch(0%_0_0/0.03)]",
        "transition-[opacity,border-color] duration-150 ease-[var(--ease-product)]",
        "hover:border-[var(--border-strong)]",
        isDragging && "opacity-30",
      )}
      style={{ touchAction: "manipulation" }}
    >
      <BoardCardContent task={task} labels={labels} />
    </div>
  );
}

/** Inner layout, shared by the card and the drag preview in the overlay. */
export function BoardCardContent({ task, labels }: { task: Task; labels: Label[] }) {
  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const taskLabels = task.labelIds
    .map((id) => labelMap.get(id))
    .filter((l): l is Label => Boolean(l));

  const isDone = task.lifecycle === "done";
  const dueLabel = formatRelativeDay(task.due);
  const dueTone: "rose" | "ember" | "neutral" = isOverdue(task.due)
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";
  const showGlyph = task.priorityBucket !== "unset";
  const showAi =
    task.aiStatus === "pending" || task.aiStatus === "running" || task.aiStatus === "failed";
  const hasMeta = showGlyph || !!dueLabel || taskLabels.length > 0;

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "line-clamp-2 min-w-0 flex-1 text-[13.5px] leading-[1.4] tracking-[-0.005em]",
            isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </span>
        {showAi ? <AiStatusInline status={task.aiStatus} className="shrink-0" /> : null}
      </div>
      {task.nextAction && !isDone ? (
        <div className="mt-0.5 truncate text-[12px] text-[var(--fg-muted)]">{task.nextAction}</div>
      ) : null}
      {hasMeta ? (
        <div className="mt-2 flex items-center gap-1.5 overflow-hidden">
          {showGlyph ? <PriorityGlyph bucket={task.priorityBucket} /> : null}
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
        </div>
      ) : null}
    </div>
  );
}

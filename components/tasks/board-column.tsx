"use client";

import { statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import * as React from "react";
import { DraggableBoardCard } from "./board-card";
import { StatusIcon } from "./status-icon";

export function BoardColumn({
  status,
  tasks,
  count,
  countPulse,
  labelsById,
  selectedTaskId,
  emptySelected,
  settlingTaskId,
  dropTarget,
  slotHeight,
  onOpen,
  onToggleComplete,
  onAdd,
  registerRef,
}: {
  status: Lifecycle;
  tasks: Task[];
  /** Shown count; previews the move while a card is dragged in or out. */
  count: number;
  /** Changes each time a card lands here, replaying the count pulse. */
  countPulse: number | null;
  labelsById: ReadonlyMap<string, Label>;
  selectedTaskId: string | null;
  /** Keyboard selection sits on this column while it has no cards. */
  emptySelected: boolean;
  settlingTaskId: string | null;
  /** A card from another column is over this one. */
  dropTarget: boolean;
  slotHeight: number;
  onOpen: (id: string) => void;
  onToggleComplete: (task: Task) => void;
  onAdd?: (status: Lifecycle) => void;
  registerRef: (id: string, el: HTMLElement | null) => void;
}) {
  const { setNodeRef } = useDroppable({ id: status });
  const label = statusLabel(status);

  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      data-status={status}
      className={cn(
        "flex shrink-0 snap-start flex-col self-start rounded-[var(--radius-lg)] border",
        "w-[288px] md:w-auto md:min-w-[184px] md:flex-1",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        dropTarget
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-[var(--border)] bg-[var(--surface-muted)]",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-2 text-[13px] text-[var(--fg)]">
        <StatusIcon status={status} size={14} className="text-[var(--fg-muted)]" />
        <span className="font-medium">{label}</span>
        <span
          key={countPulse ?? "static"}
          className={cn(
            "text-num text-[12px] text-[var(--fg-subtle)]",
            countPulse !== null && "animate-count-pulse",
          )}
        >
          {count}
        </span>
      </header>

      <div className="flex max-h-[calc(100dvh-330px)] md:max-h-[calc(100dvh-270px)] flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5">
        {tasks.map((task) => (
          <DraggableBoardCard
            key={task.id}
            task={task}
            labelsById={labelsById}
            selected={task.id === selectedTaskId}
            settling={task.id === settlingTaskId}
            onOpen={onOpen}
            onToggleComplete={onToggleComplete}
            registerRef={registerRef}
          />
        ))}
        {dropTarget ? (
          <div
            aria-hidden
            className="shrink-0 rounded-[var(--radius-md)] border border-dashed border-[var(--accent)]"
            style={{ height: slotHeight }}
          />
        ) : tasks.length === 0 ? (
          <div
            aria-hidden
            className={cn(
              "h-[88px] shrink-0 rounded-[var(--radius-md)]",
              emptySelected && "ring-1 ring-[var(--accent)]",
            )}
          />
        ) : null}
      </div>

      {onAdd && status !== "done" ? (
        <button
          type="button"
          onClick={() => onAdd(status)}
          className="mx-1.5 mb-1.5 flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1 text-[12px] text-[var(--fg-subtle)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
        >
          <Plus size={12} />
          Add
          <span className="sr-only"> to {label}</span>
        </button>
      ) : null}
    </section>
  );
}

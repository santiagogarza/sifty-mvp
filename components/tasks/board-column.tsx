"use client";

import { statusLabel } from "@/lib/domain/status";
import type { Label, Task } from "@/lib/domain/types";
import type { BoardLifecycle } from "@/lib/store/selectors";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import * as React from "react";
import { BoardCard } from "./board-card";
import { StatusIcon } from "./status-icon";

export function BoardColumn({
  lifecycle,
  tasks,
  count,
  hidden,
  labelMap,
  selectedId,
  settlingId,
  countPulse,
  isTarget,
  onOpen,
  onSelect,
  onToggleComplete,
  onAdd,
}: {
  lifecycle: BoardLifecycle;
  /** Rendered cards (Done is capped; the rest is summarized by `hidden`). */
  tasks: Task[];
  /** Header count, including a mid-drag preview of the move. */
  count: number;
  hidden: number;
  labelMap: Map<string, Label>;
  selectedId: string | null;
  settlingId: string | null;
  /** Changes when a card lands here, replaying the count pulse. */
  countPulse: number | null;
  /** A card from another column is over this one. */
  isTarget: boolean;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleComplete: (task: Task) => void;
  onAdd?: (lifecycle: BoardLifecycle) => void;
}) {
  const { setNodeRef } = useDroppable({ id: lifecycle });
  const label = statusLabel(lifecycle);

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label} column`}
      data-column={lifecycle}
      className={cn(
        "flex w-[288px] shrink-0 snap-start flex-col self-start md:w-auto md:min-w-[200px] md:flex-1 md:shrink",
        "rounded-[var(--radius-lg)] border p-1.5",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        isTarget
          ? "border-[var(--accent)]! bg-[var(--accent-soft)]"
          : "border-[var(--border)] bg-[var(--bg-sunken)]",
      )}
    >
      <header className="flex items-center gap-2 px-2 pt-1.5 pb-2">
        <StatusIcon status={lifecycle} size={13} className="text-[var(--fg)]" />
        <h2 className="text-[12.5px] font-medium text-[var(--fg)]">{label}</h2>
        <span
          key={countPulse ?? "static"}
          data-testid={`column-count-${lifecycle}`}
          className={cn(
            "text-num text-[11.5px] text-[var(--fg-subtle)]",
            countPulse !== null && "animate-count-pulse",
          )}
        >
          {count}
        </span>
      </header>

      <div
        className={cn(
          "flex min-h-[88px] flex-col gap-1.5 overflow-y-auto overscroll-contain",
          "max-h-[max(14rem,calc(100dvh-26rem))] md:max-h-[max(14rem,calc(100dvh-21rem))]",
        )}
      >
        {tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            labelMap={labelMap}
            selected={task.id === selectedId}
            settling={task.id === settlingId}
            onOpen={onOpen}
            onSelect={onSelect}
            onToggleComplete={onToggleComplete}
          />
        ))}
        {isTarget ? (
          <div
            aria-hidden
            className="h-[64px] shrink-0 rounded-[var(--radius-md)] border border-dashed border-[var(--accent)]!"
          />
        ) : null}
        {hidden > 0 ? (
          <div className="px-2 py-1.5 text-[11.5px] text-[var(--fg-subtle)]">
            +{hidden} more completed
          </div>
        ) : null}
      </div>

      {/* Done fills by finishing work, never by capture. */}
      {onAdd && lifecycle !== "done" ? (
        <button
          type="button"
          onClick={() => onAdd(lifecycle)}
          aria-label={`Add to ${label}`}
          className={cn(
            "mt-1 flex items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1.5 text-[12px] text-[var(--fg-subtle)]",
            "transition-colors duration-150 ease-[var(--ease-product)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
          )}
        >
          <Plus size={12} />
          Add
        </button>
      ) : null}
    </section>
  );
}

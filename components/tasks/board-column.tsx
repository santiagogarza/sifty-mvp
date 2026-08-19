"use client";

import { statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { STATUS_ICONS } from "./status-icon";
import { TaskCard } from "./task-card";

/**
 * One board column = one stored `Lifecycle` value. The header reads
 * `statusLabel()` and `STATUS_ICONS` — the same sources as the sidebar and
 * the Status picker — so the board can never invent its own vocabulary.
 *
 * The whole column is the droppable; cards inside it are not drop targets
 * (within-column order is derived, so dropping anywhere in a column means
 * the same thing).
 */
export const BoardColumn = React.memo(function BoardColumn({
  lifecycle,
  tasks,
  totalCount,
  labelMap,
  onOpen,
  onSelect,
  selectedId,
  dragging,
  emphasized = false,
  cardRef,
  columnRef,
}: {
  lifecycle: Lifecycle;
  /** Tasks rendered in this column (history columns are capped upstream). */
  tasks: Task[];
  /** Full column size, shown in the header and the "+n more" note. */
  totalCount: number;
  labelMap: Map<string, Label>;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  /** True while any card is being dragged — reveals the empty-drop hint. */
  dragging: boolean;
  /** The current route's own column gets a quietly louder header. */
  emphasized?: boolean;
  cardRef: (id: string, el: HTMLDivElement | null) => void;
  columnRef?: (lifecycle: Lifecycle, el: HTMLElement | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lifecycle });
  const Icon = STATUS_ICONS[lifecycle];
  const hidden = totalCount - tasks.length;

  const setRefs = React.useCallback(
    (el: HTMLElement | null) => {
      setNodeRef(el);
      columnRef?.(lifecycle, el);
    },
    [setNodeRef, columnRef, lifecycle],
  );

  return (
    <section
      ref={setRefs}
      role="group"
      aria-label={`${statusLabel(lifecycle)} column`}
      className={cn(
        "flex w-[248px] min-w-[248px] flex-1 snap-start flex-col self-start",
        "rounded-[var(--radius-lg)] border p-1.5",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        isOver
          ? "border-[var(--border-strong)] bg-[var(--surface-muted)]"
          : "border-transparent bg-[var(--bg-sunken)]/60",
      )}
    >
      <header
        className={cn(
          "flex items-center gap-1.5 px-2 pt-1.5 pb-2",
          emphasized ? "text-[var(--fg)]" : "text-[var(--fg-muted)]",
        )}
      >
        <Icon
          size={13}
          className={emphasized ? "text-[var(--accent)]" : "text-[var(--fg-subtle)]"}
        />
        <span className="text-[12.5px] font-medium">{statusLabel(lifecycle)}</span>
        <span className="text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]">
          {totalCount}
        </span>
      </header>

      <div className="flex min-h-[96px] flex-col gap-1.5">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            labelMap={labelMap}
            onOpen={onOpen}
            onSelect={onSelect}
            selected={task.id === selectedId}
            cardRef={cardRef}
          />
        ))}
        {tasks.length === 0 ? (
          <div
            aria-hidden="true"
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
            +{hidden} more in {statusLabel(lifecycle)}
          </div>
        ) : null}
      </div>
    </section>
  );
});

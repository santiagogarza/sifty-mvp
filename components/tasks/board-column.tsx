"use client";

import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import type { BoardColumn as BoardColumnModel } from "@/lib/store/selectors";
import { cn } from "@/lib/utils/cn";
import { Plus } from "lucide-react";
import * as React from "react";
import { BoardCard } from "./board-card";
import { STATUS_ICONS } from "./status-icon";

/** Fits the column header, an empty drop area, and the Add row. */
export const EMPTY_DROP_AREA_PX = 88;

/**
 * One status column. The section is the drop target; cards inside are not
 * reorderable, so there is no insertion line — the whole column tints.
 *
 * A11y shape: the board is one listbox, each column's cards are a named
 * `group` inside it ("Inbox, 2 tasks"), each card an `option`. One tab
 * stop, one selection, arrows move it.
 */
export function BoardColumn({
  column,
  previewDelta = 0,
  labels,
  selectedId,
  onSelect,
  onOpen,
  onComplete,
  onAdd,
  cardRef,
  liftedId,
  isOver,
  setDropRef,
  renderCard,
}: {
  column: BoardColumnModel;
  /** While a card is lifted: -1 on its source column, +1 on the column under the pointer. */
  previewDelta?: number;
  labels: Label[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
  onAdd?: (lifecycle: Lifecycle) => void;
  cardRef?: (id: string, el: HTMLDivElement | null) => void;
  /** Card currently lifted by a drag; it renders as a dashed ghost in place. */
  liftedId?: string | null;
  isOver?: boolean;
  setDropRef?: (el: HTMLElement | null) => void;
  /** Lets the board wrap each card with drag wiring without the column knowing about it. */
  renderCard?: (task: Task, card: React.ReactElement) => React.ReactNode;
}) {
  const Icon = STATUS_ICONS[column.status];
  const count = column.tasks.length;

  return (
    <section
      ref={setDropRef}
      data-status={column.status}
      data-over={isOver ? "" : undefined}
      className={cn(
        "flex shrink-0 flex-col w-[288px] md:w-auto md:flex-1 md:basis-0 md:min-w-[188px] md:shrink",
        "max-h-[calc(100dvh_-_var(--board-top,260px)_-_var(--board-bottom,96px))]",
        "rounded-[var(--radius-lg)] border bg-[var(--bg-sunken)]/70",
        "transition-[border-color,background-color] duration-150 ease-[var(--ease-product)]",
        isOver ? "border-[var(--accent)] bg-[var(--accent-soft)]/35" : "border-[var(--border)]",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-2 text-[13px] font-medium text-[var(--fg)]">
        <Icon size={14} className="text-[var(--fg-muted)]" />
        <span className="truncate">{column.label}</span>
        <BoardCount value={count} delta={previewDelta} />
      </header>

      <div
        role="group"
        aria-label={`${column.label}, ${count} ${count === 1 ? "task" : "tasks"}`}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2 pb-2"
        style={{ minHeight: EMPTY_DROP_AREA_PX }}
      >
        {column.tasks.map((task) => {
          const card = (
            <BoardCard
              key={task.id}
              ref={(el) => cardRef?.(task.id, el)}
              task={task}
              labels={labels}
              selected={task.id === selectedId}
              ghost={task.id === liftedId}
              onSelect={onSelect}
              onOpen={onOpen}
              onComplete={onComplete}
            />
          );
          return renderCard ? (
            <React.Fragment key={task.id}>{renderCard(task, card)}</React.Fragment>
          ) : (
            card
          );
        })}
        {isOver ? (
          <div
            aria-hidden
            className="shrink-0 rounded-[var(--radius-md)] border border-dashed border-[var(--accent)]/70"
            style={{ height: EMPTY_DROP_AREA_PX - 16 }}
          />
        ) : null}
      </div>

      {onAdd ? (
        <button
          type="button"
          onClick={() => onAdd(column.status)}
          className={cn(
            "flex items-center gap-1.5 rounded-b-[var(--radius-lg)] px-3 py-2 text-[12px]",
            "text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)]/60",
            "transition-colors duration-150 ease-[var(--ease-product)] focus:outline-none",
            "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--border-focus)]/60",
          )}
        >
          <Plus size={12} strokeWidth={2.4} />
          Add
        </button>
      ) : null}
    </section>
  );
}

/**
 * Column count that pulses once when it goes up — the landing cue after a
 * drop. The drag preview (`delta`) changes the number without pulsing; only
 * a real increase (a card actually arriving) remounts the span.
 */
function BoardCount({ value, delta }: { value: number; delta: number }) {
  const prevRef = React.useRef<number | null>(null);
  const [pulseKey, setPulseKey] = React.useState(0);

  React.useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (prev !== null && value > prev) setPulseKey((k) => k + 1);
  }, [value]);

  return (
    <span
      key={pulseKey}
      className={cn(
        "text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]",
        pulseKey > 0 && "animate-count-pulse",
      )}
    >
      {Math.max(0, value + delta)}
    </span>
  );
}

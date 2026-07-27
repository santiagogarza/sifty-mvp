"use client";

import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import type { BoardColumnData } from "@/lib/store/selectors";
import { cn } from "@/lib/utils/cn";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { STATUS_ICONS } from "../status-icon";
import { BoardCard } from "./board-card";

/**
 * One status column. The column is the drop target, not the gap between
 * cards — manual ordering is a non-goal this release, so an insertion line
 * would promise an order we don't keep. While a card hovers, the tray
 * tints, the header goes accent, and the count previews the result
 * (feedforward: the outcome is visible before release).
 *
 * The card list scrolls under the pinned header and never truncates —
 * the count stays the only truth. Empty is silent: no placeholder text,
 * just a card-height tray that still reads as somewhere to drop.
 */
export function BoardColumn({
  column,
  labels,
  dropPreview,
  selectedId,
  tabStopId,
  lastMoved,
  onOpen,
  onComplete,
  onCardKeyDown,
  onCardFocus,
  onLongPress,
}: {
  column: BoardColumnData;
  labels: Label[];
  /** A card from another column is hovering over this one. */
  dropPreview: boolean;
  selectedId: string | null;
  /** The one card that participates in the tab order (roving tabindex). */
  tabStopId: string | null;
  /** Last moved card — settles in with the fill-in / ai-wash animation. */
  lastMoved: { id: string; seq: number } | null;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
  onCardKeyDown: (e: React.KeyboardEvent, task: Task) => void;
  onCardFocus: (task: Task) => void;
  onLongPress: (task: Task) => void;
}) {
  const { setNodeRef } = useDroppable({
    id: `column-${column.status}`,
    data: { status: column.status },
  });
  const Icon = STATUS_ICONS[column.status];
  const count = column.tasks.length + (dropPreview ? 1 : 0);

  return (
    <section
      ref={setNodeRef}
      data-status={column.status}
      className={cn(
        "flex h-full min-h-0 flex-col rounded-[var(--radius-lg)] border",
        "w-[300px] shrink-0 snap-start md:w-auto md:min-w-0 md:flex-1",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        dropPreview
          ? "border-[var(--accent)] bg-[var(--accent-soft)]/40"
          : "border-[var(--border)] bg-[var(--surface-muted)]/50",
      )}
    >
      <header
        className={cn(
          "flex h-9 shrink-0 items-center gap-1.5 px-3",
          dropPreview ? "text-[var(--accent)]" : "text-[var(--fg)]",
        )}
      >
        <Icon size={14} className={cn(!dropPreview && "opacity-80")} />
        <span className="flex-1 truncate text-[13px] font-medium">{column.label}</span>
        <ColumnCount
          value={count}
          className={dropPreview ? "text-[var(--accent)]" : "text-[var(--fg-subtle)]"}
        />
      </header>
      <div
        role="listbox"
        aria-label={column.label}
        // Focus lives on the cards (roving tabindex); the container is only
        // programmatically focusable.
        tabIndex={-1}
        className="flex min-h-[76px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 focus:outline-none"
      >
        {column.tasks.map((task) => {
          const settled = lastMoved !== null && lastMoved.id === task.id;
          return (
            <div
              key={settled ? `${task.id}:${lastMoved.seq}` : task.id}
              className={cn("shrink-0", settled && "animate-fill-in")}
            >
              <DraggableBoardCard
                task={task}
                labels={labels}
                selected={selectedId === task.id}
                tabIndex={tabStopId === task.id ? 0 : -1}
                onOpen={onOpen}
                onComplete={onComplete}
                onKeyDown={(e) => onCardKeyDown(e, task)}
                onFocus={() => onCardFocus(task)}
                onLongPress={onLongPress}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DraggableBoardCard({
  task,
  ...rest
}: {
  task: Task;
  labels: Label[];
  selected: boolean;
  tabIndex: number;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onFocus: () => void;
  onLongPress: (task: Task) => void;
}) {
  // Pointer/touch only — the keyboard move is a direct setLifecycle in the
  // board's own key handler, so the hint bar stays honest about the keys.
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });
  return (
    <BoardCard
      ref={setNodeRef}
      task={task}
      ghost={isDragging}
      dragListeners={listeners as React.DOMAttributes<HTMLDivElement>}
      {...rest}
    />
  );
}

/**
 * Column count that pulses once when it goes up — the landing cue after a
 * drop, same pattern as the sidebar's NavCount.
 */
function ColumnCount({ value, className }: { value: number; className?: string }) {
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
        "text-num text-[11px] font-medium tabular-nums",
        pulseKey > 0 && "animate-count-pulse",
        className,
      )}
    >
      {value}
    </span>
  );
}

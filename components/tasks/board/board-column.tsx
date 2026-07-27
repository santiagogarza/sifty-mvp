"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import * as React from "react";
import { BoardCard } from "./board-card";

/**
 * One status, full height.
 *
 * Name, icon, order and count all come from `STATUS_META`, so the board
 * can never disagree with the sidebar or the status picker. The whole
 * column is the drop target — there is no insert slot, because the board
 * has no manual card order to insert into, and a 2px line would promise
 * a precision that does not exist.
 *
 * Columns are equal height rather than hugging their content: a nearly
 * empty column has to be just as easy to hit as a full one.
 */
export function BoardColumn({
  status,
  label,
  tasks,
  visibleCount,
  displayCount,
  labels,
  selectedTaskId,
  tabbableTaskId,
  isDropTarget,
  registerCard,
  onOpen,
  onComplete,
  onLongPress,
  onSelect,
  onShowMore,
  onAdd,
}: {
  status: Lifecycle;
  label: string;
  tasks: Task[];
  /** Cards actually rendered. The rest are behind "+N more". */
  visibleCount: number;
  /** The count in the header — previews the result while a card is over. */
  displayCount: number;
  labels: Map<string, Label>;
  selectedTaskId: string | null;
  /** The board's single tab stop — see the roving tabindex below. */
  tabbableTaskId: string | null;
  isDropTarget: boolean;
  registerCard: (taskId: string, node: HTMLDivElement | null) => void;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
  onLongPress?: (task: Task) => void;
  onSelect: (taskId: string) => void;
  onShowMore: (status: Lifecycle) => void;
  onAdd: (status: Lifecycle) => void;
}) {
  const { setNodeRef } = useDroppable({ id: status });
  const visible = tasks.slice(0, visibleCount);
  const remaining = tasks.length - visible.length;

  return (
    <section
      ref={setNodeRef}
      data-column={status}
      data-drop-target={isDropTarget || undefined}
      className={cn(
        "flex h-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border p-2",
        "transition-colors duration-150 ease-[var(--ease-soft)]",
        isDropTarget
          ? "border-[var(--accent)] bg-[var(--accent-soft)]/50"
          : "border-[var(--border)] bg-[var(--surface-muted)]",
      )}
    >
      <header className="flex shrink-0 items-center gap-2 px-1 py-0.5">
        <StatusIcon status={status} size={16} className="text-[var(--fg-muted)]" />
        <span className="text-[13px] font-medium leading-[18px] text-[var(--fg)]">{label}</span>
        <ColumnCount value={displayCount} />
      </header>

      <div
        role="listbox"
        // Roving tabindex: the options carry the tab stop, so the list
        // itself is only ever focused programmatically.
        tabIndex={-1}
        aria-label={`${label}, ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain"
      >
        {visible.map((task) => (
          <BoardCard
            key={task.id}
            ref={(node) => registerCard(task.id, node)}
            task={task}
            labels={labels}
            selected={task.id === selectedTaskId}
            tabIndex={task.id === tabbableTaskId ? 0 : -1}
            onOpen={onOpen}
            onComplete={onComplete}
            onLongPress={onLongPress}
            onSelect={() => onSelect(task.id)}
          />
        ))}
        {remaining > 0 ? (
          <button
            type="button"
            onClick={() => onShowMore(status)}
            className="shrink-0 px-1 py-1 text-left text-[12px] text-[var(--fg-subtle)]
            hover:text-[var(--fg)] transition-colors"
          >
            +{remaining} more
          </button>
        ) : null}
        {status === "done" ? null : (
          <button
            type="button"
            onClick={() => onAdd(status)}
            className="flex shrink-0 items-center gap-1 self-start rounded-[var(--radius-xs)] px-1 py-0.5
            text-[12px] text-[var(--fg-subtle)] hover:text-[var(--fg)] transition-colors"
          >
            <Plus size={12} />
            Add
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Reuses the sidebar's one-shot pulse on increment: remounting on every
 * bump restarts the CSS animation by construction, with no flag to get
 * stuck.
 */
function ColumnCount({ value }: { value: number }) {
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
        "text-num text-[12px] leading-4 text-[var(--fg-subtle)]",
        pulseKey > 0 && "animate-count-pulse",
      )}
    >
      {value}
    </span>
  );
}

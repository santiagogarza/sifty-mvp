"use client";

import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import {
  type BoardLens,
  DEFAULT_BOARD_LENS,
  adjacentColumn,
  partitionByLifecycle,
  resolveDrop,
} from "@/lib/store/board";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChevronRight } from "lucide-react";
import * as React from "react";
import { BoardColumn } from "./board-column";
import { TaskCardContent } from "./task-card";

/**
 * Kanban board over the stored `lifecycle` field. One column per status in
 * pipeline order; dragging a card between columns calls the exact mutation
 * path the Status picker uses (`setLifecycle`), so `completedAt` handling
 * comes for free from `updateTask`. There is no within-column reordering —
 * column order is derived from the same sorts as the list views.
 *
 * Input model:
 *  - Mouse drags need 5px of travel before they start, so a plain click
 *    still opens the detail sheet. Touch drags need a 200ms hold, so a
 *    plain swipe scrolls the board instead of picking cards up.
 *  - Keyboard is deliberately not a drag mode: ←/→ move the selection
 *    between columns, ↑/↓ (or j/k) within one, Enter opens the card, and
 *    Alt+←/→ moves the selected card one column. The global shortcut
 *    handler bails on `altKey`, so the move chord never collides.
 *
 * Dropped is not a pipeline column: it stays behind the trailing
 * "Show dropped" disclosure, mirroring the Done page.
 */

/**
 * Break out of the 820px reading column: sized and centered against the
 * <main> container (100cqw), capped for very wide screens. Browsers without
 * cqw support fall back to the reading column. Shared with the board-mode
 * page header so its text lines up with the first column.
 */
export const BOARD_BREAKOUT_CLASS = "w-[min(1360px,100cqw)] ml-[calc(50%-min(1360px,100cqw)/2)]";
export const BOARD_GUTTER_CLASS = "px-4 sm:px-6 md:px-8";

/** Keep history columns skimmable — the full archive lives in the list views. */
const HISTORY_VISIBLE_LIMIT = 25;
const HISTORY_COLUMNS: readonly Lifecycle[] = ["done", "dropped"];

// Prefer the column under the pointer; fall back to overlap so drops just
// outside a column edge still land somewhere sensible.
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

export function TaskBoard({
  onOpen,
  lens = DEFAULT_BOARD_LENS,
  focusLifecycle = null,
}: {
  onOpen: (id: string) => void;
  /** Which columns render and any extra membership predicate (Today). */
  lens?: BoardLens;
  /** The current route's own column — emphasized and scrolled into view. */
  focusLifecycle?: Lifecycle | null;
}) {
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);

  const [showDropped, setShowDropped] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // Partition includes Dropped whenever the disclosure exists so the
  // control can show a count while collapsed.
  const partitionColumns = React.useMemo(
    () => (lens.withDropped ? [...lens.columns, "dropped" as Lifecycle] : lens.columns),
    [lens],
  );
  const partition = React.useMemo(
    () => partitionByLifecycle(tasks, { filter: lens.filter }, partitionColumns),
    [tasks, lens.filter, partitionColumns],
  );
  const visibleColumns = showDropped && lens.withDropped ? partitionColumns : lens.columns;

  // The arrays the columns actually render (history columns are capped);
  // keyboard selection moves over these same arrays so it can never land
  // on an unrendered card.
  const visibleTasks = React.useMemo(() => {
    const out = new Map<Lifecycle, Task[]>();
    for (const lifecycle of partitionColumns) {
      const all = partition[lifecycle];
      out.set(
        lifecycle,
        HISTORY_COLUMNS.includes(lifecycle) ? all.slice(0, HISTORY_VISIBLE_LIMIT) : all,
      );
    }
    return out;
  }, [partition, partitionColumns]);

  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const activeTask = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;
  const droppedCount = partition.dropped.length;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const boardRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const columnRefs = React.useRef(new Map<Lifecycle, HTMLElement>());
  const didInitialFocus = React.useRef(false);

  const setCardRef = React.useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);
  const setColumnRef = React.useCallback((lifecycle: Lifecycle, el: HTMLElement | null) => {
    if (el) columnRefs.current.set(lifecycle, el);
    else columnRefs.current.delete(lifecycle);
  }, []);

  // Focus the board once tasks exist so the keyboard model works without
  // tabbing in first — the same behavior as the list view.
  React.useEffect(() => {
    if (didInitialFocus.current || tasks.length === 0) return;
    didInitialFocus.current = true;
    boardRef.current?.focus({ preventScroll: true });
  }, [tasks.length]);

  // The route still means something in board mode: bring its column into
  // view on mount (emphasis is handled by the column header).
  React.useEffect(() => {
    if (!focusLifecycle) return;
    columnRefs.current.get(focusLifecycle)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [focusLifecycle]);

  /** Where the selected card currently sits, over the rendered arrays. */
  const selectedPos = React.useMemo(() => {
    if (!selectedId) return null;
    for (let c = 0; c < visibleColumns.length; c++) {
      const index = (visibleTasks.get(visibleColumns[c]!) ?? []).findIndex(
        (t) => t.id === selectedId,
      );
      if (index !== -1) return { column: c, index };
    }
    return null;
  }, [selectedId, visibleTasks, visibleColumns]);

  // Selection follows into the card's new column after a move; keep focus
  // on the (remounted) element so the keyboard flow never drops. Remount
  // typically sends focus to body (or a detached node), so treat "no live
  // focus outside the board" as a restore — not only focus still inside.
  React.useEffect(() => {
    if (!selectedId || !selectedPos) return;
    const el = cardRefs.current.get(selectedId);
    if (!el) return;
    const active = document.activeElement;
    const boardHasFocus = !!boardRef.current?.contains(active);
    const focusLost =
      !active ||
      active === document.body ||
      active === document.documentElement ||
      !document.contains(active);
    if (el !== active && (boardHasFocus || focusLost)) {
      el.focus({ preventScroll: true });
    }
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId, selectedPos]);

  const selectFirstCard = () => {
    const startAt = focusLifecycle ? Math.max(0, visibleColumns.indexOf(focusLifecycle)) : 0;
    for (let step = 0; step < visibleColumns.length; step++) {
      const column = visibleColumns[(startAt + step) % visibleColumns.length]!;
      const first = visibleTasks.get(column)?.[0];
      if (first) {
        setSelectedId(first.id);
        return;
      }
    }
  };

  const moveSelectionHorizontal = (direction: -1 | 1) => {
    if (!selectedPos) {
      selectFirstCard();
      return;
    }
    for (
      let c = selectedPos.column + direction;
      c >= 0 && c < visibleColumns.length;
      c += direction
    ) {
      const list = visibleTasks.get(visibleColumns[c]!) ?? [];
      if (list.length > 0) {
        setSelectedId(list[Math.min(selectedPos.index, list.length - 1)]!.id);
        return;
      }
    }
  };

  const moveSelectionVertical = (direction: -1 | 1) => {
    if (!selectedPos) {
      selectFirstCard();
      return;
    }
    const list = visibleTasks.get(visibleColumns[selectedPos.column]!) ?? [];
    if (list.length === 0) return;
    const next = Math.min(list.length - 1, Math.max(0, selectedPos.index + direction));
    setSelectedId(list[next]!.id);
  };

  const moveSelectedCard = (direction: -1 | 1) => {
    if (!selectedId || !selectedPos) return;
    const target = adjacentColumn(visibleColumns, visibleColumns[selectedPos.column]!, direction);
    const drop = target ? resolveDrop(tasks, selectedId, target, { filter: lens.filter }) : null;
    if (drop) setLifecycle(drop.taskId, drop.lifecycle);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const horizontal = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (horizontal !== 0 && e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      moveSelectedCard(horizontal as -1 | 1);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (horizontal !== 0) {
      e.preventDefault();
      moveSelectionHorizontal(horizontal as -1 | 1);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      moveSelectionVertical(1);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      moveSelectionVertical(-1);
    } else if (e.key === "Enter") {
      if (!selectedId) return;
      e.preventDefault();
      onOpen(selectedId);
    }
  };

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setActiveId(id);
    setSelectedId(id);
  };

  // Commit on drag end only — never mid-drag — so the sync round-trip can
  // never fight the pointer.
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const drop = resolveDrop(tasks, String(e.active.id), e.over?.id ?? null, {
      filter: lens.filter,
    });
    if (drop) setLifecycle(drop.taskId, drop.lifecycle);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {/* select-none: a drag that starts a few px off a card must not start
          highlighting text; card text is readable in the detail sheet. */}
      <div className={cn(BOARD_BREAKOUT_CLASS, "select-none")}>
        <div
          ref={boardRef}
          role="listbox"
          aria-label="Task board"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className={cn(
            "flex gap-3 overflow-x-auto pb-10 snap-x snap-proximity focus:outline-none",
            BOARD_GUTTER_CLASS,
          )}
        >
          {visibleColumns.map((lifecycle) => (
            <BoardColumn
              key={lifecycle}
              lifecycle={lifecycle}
              tasks={visibleTasks.get(lifecycle) ?? []}
              totalCount={partition[lifecycle].length}
              labelMap={labelMap}
              onOpen={onOpen}
              onSelect={setSelectedId}
              selectedId={selectedId}
              dragging={activeId != null}
              emphasized={lifecycle === focusLifecycle}
              cardRef={setCardRef}
              columnRef={setColumnRef}
            />
          ))}
          {lens.withDropped ? (
            <div className="shrink-0 self-start pt-1.5">
              <button
                type="button"
                onClick={() => setShowDropped((v) => !v)}
                aria-expanded={showDropped}
                className={cn(
                  "flex items-center gap-1.5 rounded-[var(--radius-md)] border border-dashed",
                  "border-[var(--border-strong)] px-2.5 py-2 text-[12px] text-[var(--fg-muted)]",
                  "transition-colors duration-150 ease-[var(--ease-product)]",
                  "hover:text-[var(--fg)] hover:bg-[var(--surface-muted)]",
                )}
              >
                <ChevronRight
                  size={13}
                  className={cn(
                    "transition-transform duration-200 ease-[var(--ease-product)]",
                    showDropped && "rotate-90",
                  )}
                />
                {showDropped
                  ? `Hide ${statusLabel("dropped").toLowerCase()}`
                  : `Show ${statusLabel("dropped").toLowerCase()}`}
                {droppedCount > 0 ? (
                  <span className="text-num text-[11.5px] text-[var(--fg-subtle)]">
                    {droppedCount}
                  </span>
                ) : null}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.32, 0.72, 0.18, 1)" }}>
        {activeTask ? <TaskCardContent task={activeTask} labelMap={labelMap} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { StatusIcon } from "@/components/tasks/status-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS, statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { type BoardColumn as BoardColumnData, selectBoardColumns } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardCardOverlay } from "./board-card";
import { BoardColumn } from "./board-column";
import { BoardKeyboardHint } from "./board-keyboard-hint";
import { MoveToSheet } from "./move-to-sheet";
import { UndoPill } from "./undo-pill";
import { useBoardMove } from "./use-board-move";

/**
 * The board: five statuses laid out side by side, each holding exactly
 * what its list view holds.
 *
 * Board mode owns the whole pipeline rather than the view it was opened
 * from — a single-status board is one full column and four empty ones,
 * which is a worse list. The page header says so out loud.
 *
 * Three ways to file a card, all writing the same single field:
 *  - pointer: drag it onto a column (the column is the target, not the
 *    gap between cards — the board has no manual order to insert into),
 *  - keyboard: ⇧← / ⇧→,
 *  - touch: press and hold for the "Move to" sheet.
 *
 * dnd-kit handles the pointer only. The keyboard move is a direct store
 * write, which keeps the hint bar honest about what the keys do and
 * keeps dnd-kit's keyboard sensor from competing for the same arrows.
 */

/** Cards rendered per column before "+N more". Columns scroll; they never truncate. */
const COLUMN_PAGE = 25;

export function BoardView() {
  const { openDetail, openCapture } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const labelList = useStore((s) => s.labels);
  const hydrated = useStore((s) => s.hydrated);
  const updateTask = useStore((s) => s.updateTask);

  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);
  const labels = React.useMemo(() => new Map(labelList.map((l) => [l.id, l])), [labelList]);

  const { pending, announcement, move, undo } = useBoardMove();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [focusTick, setFocusTick] = React.useState(0);
  const [caps, setCaps] = React.useState<Partial<Record<Lifecycle, number>>>({});
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [overStatus, setOverStatus] = React.useState<Lifecycle | null>(null);
  const [moveSheetTask, setMoveSheetTask] = React.useState<Task | null>(null);

  const boardRef = React.useRef<HTMLDivElement>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const dragEndedAt = React.useRef(0);

  const registerCard = React.useCallback((taskId: string, node: HTMLDivElement | null) => {
    if (node) {
      cardRefs.current.set(taskId, node);
      return;
    }
    // A card that changed columns has already re-registered its new node;
    // only drop entries whose element really left the document.
    const existing = cardRefs.current.get(taskId);
    if (existing && !existing.isConnected) cardRefs.current.delete(taskId);
  }, []);

  const visibleColumns = React.useMemo(
    () =>
      columns.map((column) => ({
        ...column,
        visible: column.tasks.slice(0, caps[column.status] ?? COLUMN_PAGE),
      })),
    [columns, caps],
  );

  const draggingTask = draggingId ? tasks.find((t) => t.id === draggingId) : undefined;
  const selectedTask = selectedId ? tasks.find((t) => t.id === selectedId) : undefined;

  // Exactly one tab stop leads into the board: the selected card, or the
  // first one when nothing is selected yet.
  const tabbableTaskId =
    selectedTask?.id ?? visibleColumns.find((c) => c.visible.length > 0)?.visible[0]?.id ?? null;

  // Selection survives its card leaving the board (completed, dropped).
  React.useEffect(() => {
    if (selectedId && !tasks.some((t) => t.id === selectedId)) setSelectedId(null);
  }, [selectedId, tasks]);

  // The list view focuses its listbox on mount so j/k work without
  // tabbing in first; the board owes the keyboard the same courtesy.
  const didAutoFocus = React.useRef(false);
  React.useEffect(() => {
    if (didAutoFocus.current || tasks.length === 0) return;
    didAutoFocus.current = true;
    boardRef.current?.focus({ preventScroll: true });
  }, [tasks.length]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: focusTick is the trigger, not a value — a card that changes column keeps its id but gets a brand new DOM node, and focus has to follow it there.
  React.useEffect(() => {
    if (!selectedId) return;
    cardRefs.current.get(selectedId)?.focus({ preventScroll: false });
  }, [selectedId, focusTick]);

  const select = React.useCallback((taskId: string) => {
    setSelectedId((prev) => (prev === taskId ? prev : taskId));
  }, []);

  const focusOn = React.useCallback((taskId: string) => {
    setSelectedId(taskId);
    setFocusTick((t) => t + 1);
  }, []);

  // Undo puts the card back and takes focus with it. Without this the
  // pill's button unmounts under the pointer, focus falls to the body,
  // and the next keystroke goes nowhere.
  const undoAndFollow = React.useCallback(() => {
    const taskId = pending?.taskId;
    undo();
    if (taskId) focusOn(taskId);
  }, [focusOn, pending, undo]);

  const complete = React.useCallback(
    (task: Task) => {
      // Byte-for-byte what the list row's circle does, including the
      // completedAt stamp `updateTask` owns.
      updateTask(task.id, { lifecycle: task.lifecycle === "done" ? "active" : "done" });
    },
    [updateTask],
  );

  /* ---------------------------------------------------------------- *
   * Keyboard
   * ---------------------------------------------------------------- */

  const locate = React.useCallback(() => {
    if (!selectedId) return null;
    for (const [col, column] of visibleColumns.entries()) {
      const index = column.visible.findIndex((t) => t.id === selectedId);
      if (index >= 0) return { col, index };
    }
    return null;
  }, [selectedId, visibleColumns]);

  const firstSelectable = React.useCallback(() => {
    const column = visibleColumns.find((c) => c.visible.length > 0);
    return column?.visible[0]?.id ?? null;
  }, [visibleColumns]);

  /** Lands on the card nearest the current one vertically. Empty columns are skipped. */
  const acrossColumns = React.useCallback(
    (from: number, delta: number) => {
      const anchor = selectedId ? cardRefs.current.get(selectedId)?.getBoundingClientRect() : null;
      for (let col = from + delta; col >= 0 && col < visibleColumns.length; col += delta) {
        const candidates = visibleColumns[col]?.visible ?? [];
        let best = candidates[0];
        if (!best) continue;
        if (!anchor) return best.id;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const candidate of candidates) {
          const rect = cardRefs.current.get(candidate.id)?.getBoundingClientRect();
          if (!rect) continue;
          const distance = Math.abs(rect.top - anchor.top);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
          }
        }
        return best.id;
      }
      return null;
    },
    [selectedId, visibleColumns],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key;
    const navKeys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "j", "k"];
    const here = locate();

    if (!here && navKeys.includes(key)) {
      const first = firstSelectable();
      if (!first) return;
      e.preventDefault();
      focusOn(first);
      return;
    }
    if (!here) return;

    const column = visibleColumns[here.col]?.visible ?? [];

    if (key === "ArrowDown" || key === "j") {
      e.preventDefault();
      const next = column[Math.min(column.length - 1, here.index + 1)];
      if (next) focusOn(next.id);
    } else if (key === "ArrowUp" || key === "k") {
      e.preventDefault();
      const next = column[Math.max(0, here.index - 1)];
      if (next) focusOn(next.id);
    } else if (key === "ArrowRight" || key === "ArrowLeft") {
      e.preventDefault();
      const delta = key === "ArrowRight" ? 1 : -1;
      if (e.shiftKey) {
        const target = visibleColumns[here.col + delta];
        if (!target || !selectedTask) return;
        move(selectedTask, target.status);
        setFocusTick((t) => t + 1);
      } else {
        const next = acrossColumns(here.col, delta);
        if (next) focusOn(next);
      }
    } else if (key === "Enter") {
      e.preventDefault();
      if (selectedId) openDetail(selectedId);
    } else if (key === " ") {
      e.preventDefault();
      if (selectedTask) complete(selectedTask);
    } else if (key === "Escape") {
      setSelectedId(null);
      boardRef.current?.focus({ preventScroll: true });
    }
  };

  // ⌘Z reaches the last move from anywhere on the page — the pill's
  // shortcut has to work whether or not focus is still on a card.
  React.useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      undoAndFollow();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, undoAndFollow]);

  /* ---------------------------------------------------------------- *
   * Pointer drag
   * ---------------------------------------------------------------- */

  // 6px of travel means a click to open never reads as a failed drag.
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }));

  // The settle is a Web Animation, so the reduced-motion rule in
  // globals.css cannot collapse it. The state change still happens; only
  // the travel is removed.
  const reducedMotion = usePrefersReducedMotion();

  const onDragStart = (event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
    setOverStatus(null);
  };

  const onDragOver = (event: DragOverEvent) => {
    const over = event.over?.id;
    setOverStatus(typeof over === "string" ? (over as Lifecycle) : null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    const over = event.over?.id;
    setDraggingId(null);
    setOverStatus(null);
    dragEndedAt.current = Date.now();
    if (typeof over !== "string") return;
    const task = tasks.find((t) => t.id === id);
    if (task) move(task, over as Lifecycle);
  };

  // A mouseup that ends a drag still fires a click. Opening the sheet on
  // top of a card the user just filed would undo the whole point.
  const openCard = React.useCallback(
    (id: string) => {
      if (Date.now() - dragEndedAt.current < 250) return;
      openDetail(id);
    },
    [openDetail],
  );

  /** Previews the outcome while a card is in flight. */
  const displayCount = (column: BoardColumnData) => {
    const base = column.tasks.length;
    if (!draggingTask || !overStatus || draggingTask.lifecycle === overStatus) return base;
    if (column.status === overStatus) return base + 1;
    if (column.status === draggingTask.lifecycle) return base - 1;
    return base;
  };

  if (!hydrated) return <BoardSkeleton />;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDraggingId(null);
        setOverStatus(null);
      }}
    >
      <StatusPager
        columns={columns}
        stripRef={stripRef}
        onJump={(index) => {
          const strip = stripRef.current;
          const target = strip?.children[index] as HTMLElement | undefined;
          target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
        }}
      />

      {/* The board is the keyboard scope for its five listboxes, the same
          way the list view's container is the scope for its rows. */}
      <div
        ref={boardRef}
        tabIndex={-1}
        role="group"
        aria-label="Board"
        data-focus-scope
        onKeyDown={onKeyDown}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          ref={stripRef}
          className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto
          pb-1 md:snap-none md:overflow-x-visible"
        >
          {visibleColumns.map((column) => (
            <div
              key={column.status}
              className="h-full w-[288px] shrink-0 snap-start md:w-auto md:min-w-0 md:flex-1"
            >
              <BoardColumn
                status={column.status}
                label={column.label}
                tasks={column.tasks}
                visibleCount={caps[column.status] ?? COLUMN_PAGE}
                displayCount={displayCount(column)}
                labels={labels}
                selectedTaskId={selectedId}
                tabbableTaskId={tabbableTaskId}
                isDropTarget={overStatus === column.status}
                registerCard={registerCard}
                onOpen={openCard}
                onComplete={complete}
                onLongPress={setMoveSheetTask}
                onSelect={select}
                onShowMore={(status) =>
                  setCaps((prev) => ({
                    ...prev,
                    [status]: (prev[status] ?? COLUMN_PAGE) + COLUMN_PAGE,
                  }))
                }
                onAdd={(status) => openCapture({ lifecycle: status })}
              />
            </div>
          ))}
        </div>
        {tasks.length > 0 ? <BoardKeyboardHint /> : null}
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {pending ? <UndoPill move={pending} onUndo={undoAndFollow} /> : null}

      <MoveToSheet
        task={moveSheetTask}
        onClose={() => setMoveSheetTask(null)}
        onMove={(task, to) => move(task, to)}
      />

      <DragOverlay
        dropAnimation={
          reducedMotion ? null : { duration: 160, easing: "cubic-bezier(0.32, 0.72, 0.18, 1)" }
        }
      >
        {draggingTask ? <BoardCardOverlay task={draggingTask} labels={labels} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/**
 * Phones show one column at a time with the next peeking. The pager
 * names where you are without making you scroll to find out.
 */
function StatusPager({
  columns,
  stripRef,
  onJump,
}: {
  columns: BoardColumnData[];
  stripRef: React.RefObject<HTMLDivElement | null>;
  onJump: (index: number) => void;
}) {
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onScroll = () => {
      const width = strip.children[0]?.clientWidth ?? 1;
      setActive(Math.round(strip.scrollLeft / (width + 12)));
    };
    strip.addEventListener("scroll", onScroll, { passive: true });
    return () => strip.removeEventListener("scroll", onScroll);
  }, [stripRef]);

  return (
    <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5 md:hidden">
      {columns.map((column, index) => (
        <button
          key={column.status}
          type="button"
          onClick={() => onJump(index)}
          aria-current={index === active}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]",
            "transition-colors duration-150 ease-[var(--ease-product)]",
            index === active
              ? "border-[var(--accent)] bg-[var(--accent-soft)]/60 text-[var(--fg)]"
              : "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--fg-muted)]",
          )}
        >
          <StatusIcon status={column.status} size={12} />
          {column.label}
          <span className="text-num text-[var(--fg-subtle)]">{column.tasks.length}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Status vocabulary is static on the client, so headers render
 * immediately. Only the counts and the cards wait on the store — the
 * board never shows a blank rectangle where a column will be.
 */
function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden pb-1">
      {STATUS_VIEWS.map(({ status }) => (
        <div
          key={status}
          className="flex h-full w-[288px] shrink-0 flex-col gap-2 rounded-[var(--radius-lg)]
          border border-[var(--border)] bg-[var(--surface-muted)] p-2 md:w-auto md:min-w-0 md:flex-1"
        >
          <div className="flex items-center gap-2 px-1 py-0.5">
            <StatusIcon status={status} size={16} className="text-[var(--fg-muted)]" />
            <span className="text-[13px] font-medium leading-[18px] text-[var(--fg)]">
              {statusLabel(status)}
            </span>
            <Skeleton className="h-3 w-3 rounded" />
          </div>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)]
              bg-[var(--surface)] p-3"
            >
              <Skeleton className="h-3.5 w-[85%]" />
              <Skeleton className="h-3 w-[60%]" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

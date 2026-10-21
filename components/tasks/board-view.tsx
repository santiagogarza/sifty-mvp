"use client";

import { isEditableTarget } from "@/components/app-shell/keyboard";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { BOARD_LIFECYCLES, type BoardLifecycle, selectBoardColumns } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardCardContent } from "./board-card";
import { BoardColumn } from "./board-column";
import { StatusIcon } from "./status-icon";

/**
 * Kanban board: every open task in the five status columns, left to right
 * in sidebar order. Card order inside a column is derived (the list views'
 * sorts), so a move only ever changes `lifecycle` — dropping anywhere in a
 * column is enough, and any column accepts a card from any other.
 *
 * Input:
 *  - Mouse drags start after 8px of travel, so a click still opens the
 *    task. Touch drags need a 250ms hold, so a swipe scrolls the board.
 *    (Mouse rather than Pointer sensor: a pointer sensor would also claim
 *    touch pointers and turn every horizontal swipe into a drag.)
 *  - Keys are handled on the focusable board itself, never the document,
 *    so they are inert while typing or while an overlay holds focus.
 *  - Every move can be undone for a few seconds; a newer move replaces it.
 */

/**
 * Break out of the 820px reading column: sized and centered against the
 * <main> container (100cqw), capped for very wide screens. Shared with the
 * board-mode page header so its text lines up with the first column.
 */
export const BOARD_BREAKOUT_CLASS = "w-[min(1360px,100cqw)] ml-[calc(50%-min(1360px,100cqw)/2)]";
export const BOARD_GUTTER_CLASS = "px-4 sm:px-6 md:px-8";

/** Keep the Done column skimmable — history lives in the list views. */
const DONE_VISIBLE_LIMIT = 25;
export const BOARD_UNDO_MS = 6000;

// Prefer the column under the pointer; fall back to overlap so drops just
// outside a column edge still land somewhere sensible.
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

interface MoveRecord {
  taskId: string;
  from: Lifecycle;
  to: BoardLifecycle;
}

interface Selection {
  id: string | null;
  col: number;
  /** Remembered row, so crossing an empty column keeps the user's height. */
  index: number;
}

export function BoardView({
  tasks,
  onOpen,
  onAdd,
  syncError = false,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  /** A column's Add row: capture straight into that status. */
  onAdd?: (lifecycle: BoardLifecycle) => void;
  /** The sync notice is showing; the undo pill sits one row above it. */
  syncError?: boolean;
}) {
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const labelMap = React.useMemo(
    () => new Map<string, Label>(labels.map((l) => [l.id, l])),
    [labels],
  );

  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);
  const visible = React.useMemo(
    () =>
      columns.map((c) => (c.lifecycle === "done" ? c.tasks.slice(0, DONE_VISIBLE_LIMIT) : c.tasks)),
    [columns],
  );
  const visibleRef = React.useRef(visible);
  visibleRef.current = visible;
  const isEmpty = columns.every((c) => c.tasks.length === 0);

  const boardRef = React.useRef<HTMLDivElement>(null);

  // ---- Selection -------------------------------------------------------
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const position = React.useMemo(() => {
    if (!selection) return null;
    if (selection.id) {
      for (let col = 0; col < visible.length; col++) {
        const index = visible[col]!.findIndex((t) => t.id === selection.id);
        if (index >= 0) return { col, index };
      }
    }
    const len = visible[selection.col]!.length;
    return { col: selection.col, index: len === 0 ? -1 : Math.min(selection.index, len - 1) };
  }, [selection, visible]);
  const selectedTask =
    position && position.index >= 0 ? (visible[position.col]![position.index] ?? null) : null;
  const selectedId = selectedTask?.id ?? null;

  const selectAt = (col: number, index: number) => {
    setSelection({ id: visible[col]![index]?.id ?? null, col, index });
  };

  const onSelect = React.useCallback((id: string) => {
    const cols = visibleRef.current;
    for (let col = 0; col < cols.length; col++) {
      const index = cols[col]!.findIndex((t) => t.id === id);
      if (index >= 0) {
        setSelection({ id, col, index });
        return;
      }
    }
  }, []);

  React.useEffect(() => {
    if (!selectedId) return;
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-board-card="${selectedId}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId]);

  // Focus the board once there is something on it, so arrows work at once.
  const didInitialFocus = React.useRef(false);
  React.useEffect(() => {
    if (isEmpty || didInitialFocus.current) return;
    didInitialFocus.current = true;
    if (document.activeElement?.closest('[role="dialog"]')) return;
    boardRef.current?.focus({ preventScroll: true });
  }, [isEmpty]);

  // A moved card remounts in its new column, which drops focus to <body>.
  // Hand it to the card in its new place — unless focus went somewhere
  // real (the detail sheet, a dialog) in the meantime.
  const refocusId = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const id = refocusId.current;
    if (!id || !visible.some((col) => col.some((t) => t.id === id))) return;
    refocusId.current = null;
    const board = boardRef.current;
    const current = document.activeElement;
    if (!board || (current && current !== document.body && !board.contains(current))) return;
    const card = board.querySelector<HTMLElement>(`[data-board-card="${id}"]`);
    (card ?? board).focus({ preventScroll: true });
  }, [visible]);

  // ---- Moves, settle animation, undo ------------------------------------
  const [settled, setSettled] = React.useState<{ id: string; to: Lifecycle; n: number } | null>(
    null,
  );
  const settleSeq = React.useRef(0);
  const settle = React.useCallback((id: string, to: Lifecycle) => {
    settleSeq.current += 1;
    setSettled({ id, to, n: settleSeq.current });
    refocusId.current = id;
  }, []);

  const [undo, setUndo] = React.useState<MoveRecord | null>(null);
  React.useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), BOARD_UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const move = (task: Task, to: BoardLifecycle) => {
    if (task.lifecycle === to) return;
    setLifecycle(task.id, to);
    setUndo({ taskId: task.id, from: task.lifecycle, to });
    settle(task.id, to);
    setSelection((s) => ({ id: task.id, col: BOARD_LIFECYCLES.indexOf(to), index: s?.index ?? 0 }));
  };

  const runUndo = () => {
    if (!undo) return;
    setUndo(null);
    const task = useStore.getState().tasks.find((t) => t.id === undo.taskId);
    // Moved again some other way since (e.g. the sheet): leave it where it is.
    if (!task || task.lifecycle !== undo.to) return;
    setLifecycle(task.id, undo.from);
    settle(task.id, undo.from);
  };

  const onToggleComplete = React.useCallback(
    (task: Task) => {
      let to: Lifecycle = "done";
      if (task.lifecycle === "done") {
        const from = useStore.getState().completedFrom[task.id];
        to = from && from !== "done" && from !== "dropped" ? from : "active";
      }
      setLifecycle(task.id, to);
      settle(task.id, to);
    },
    [setLifecycle, settle],
  );

  // ---- Keyboard --------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Only the board itself or a card; a focused button keeps its own keys.
    if (target !== e.currentTarget && !target.hasAttribute("data-board-card")) return;
    if (isEditableTarget(target)) return;

    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z") {
      if (undo) {
        e.preventDefault();
        runUndo();
      }
      return;
    }
    if (mod || e.altKey || isEmpty) return;

    const horizontal = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    const vertical =
      e.key === "ArrowUp" || e.key === "k" ? -1 : e.key === "ArrowDown" || e.key === "j" ? 1 : 0;

    if (horizontal !== 0 && e.shiftKey) {
      e.preventDefault();
      if (!selectedTask || !position) return;
      const to = BOARD_LIFECYCLES[position.col + horizontal];
      if (to) move(selectedTask, to);
      return;
    }
    if (e.shiftKey) return;

    if (horizontal !== 0 || vertical !== 0) {
      e.preventDefault();
      if (!position || !selection) {
        const first = visible.findIndex((col) => col.length > 0);
        if (first >= 0) selectAt(first, 0);
        return;
      }
      if (horizontal !== 0) {
        const col = position.col + horizontal;
        if (col < 0 || col >= visible.length) return;
        const len = visible[col]!.length;
        const want = position.index >= 0 ? position.index : selection.index;
        selectAt(col, len === 0 ? want : Math.min(want, len - 1));
      } else if (position.index >= 0) {
        const len = visible[position.col]!.length;
        selectAt(position.col, Math.max(0, Math.min(len - 1, position.index + vertical)));
      }
      return;
    }
    if (e.key === "Enter" && selectedId) {
      e.preventDefault();
      onOpen(selectedId);
    }
  };

  // ---- Drag ------------------------------------------------------------
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overCol, setOverCol] = React.useState<BoardLifecycle | null>(null);
  const activeTask = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;
  const previewTarget = activeTask && overCol && overCol !== activeTask.lifecycle ? overCol : null;

  const endDrag = () => {
    setActiveId(null);
    setOverCol(null);
  };
  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setActiveId(id);
    onSelect(id);
  };
  const onDragOver = (e: DragOverEvent) => {
    setOverCol((e.over?.id as BoardLifecycle | undefined) ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    endDrag();
    const to = e.over?.id as BoardLifecycle | undefined;
    const task = tasks.find((t) => t.id === e.active.id);
    if (task && to) move(task, to);
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={endDrag}
      >
        {/* select-none: a drag that starts a few px off a card must not
            start highlighting text; card text is readable in the sheet. */}
        <div className={cn(BOARD_BREAKOUT_CLASS, "select-none")}>
          <div
            ref={boardRef}
            role="group"
            aria-roledescription="board"
            aria-label="Board"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the board owns arrow/Enter/Shift+arrow; it must take focus like the task listbox does.
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) boardRef.current?.focus();
            }}
            data-testid="board"
            className={cn(
              "flex gap-3 overflow-x-auto pb-4 focus:outline-none",
              "snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 md:snap-none",
              BOARD_GUTTER_CLASS,
            )}
          >
            {columns.map((column, col) => {
              const isSource = previewTarget !== null && activeTask?.lifecycle === column.lifecycle;
              const isTarget = previewTarget === column.lifecycle;
              return (
                <BoardColumn
                  key={column.lifecycle}
                  lifecycle={column.lifecycle}
                  tasks={visible[col]!}
                  count={column.tasks.length + (isTarget ? 1 : 0) - (isSource ? 1 : 0)}
                  hidden={column.tasks.length - visible[col]!.length}
                  labelMap={labelMap}
                  selectedId={selectedId}
                  settlingId={settled?.id ?? null}
                  countPulse={settled && settled.to === column.lifecycle ? settled.n : null}
                  isTarget={isTarget}
                  onOpen={onOpen}
                  onSelect={onSelect}
                  onToggleComplete={onToggleComplete}
                  onAdd={onAdd}
                />
              );
            })}
          </div>
          {isEmpty ? null : <BoardHint />}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className="rotate-[1.5deg] cursor-grabbing">
              <BoardCardContent task={activeTask} labelMap={labelMap} overlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {undo ? <UndoPill move={undo} onUndo={runUndo} raised={syncError} /> : null}
    </>
  );
}

function BoardHint() {
  return (
    <div
      data-testid="board-hint"
      className={cn(
        "hidden md:flex items-center gap-1.5 pt-1 pb-8 text-[11.5px] text-[var(--fg-subtle)]",
        BOARD_GUTTER_CLASS,
      )}
    >
      <Kbd>←</Kbd>
      <Kbd>→</Kbd>
      <span>to move</span>
      <span aria-hidden>·</span>
      <Kbd>⇧←</Kbd>
      <Kbd>⇧→</Kbd>
      <span>to file</span>
      <span aria-hidden>·</span>
      <Kbd>↵</Kbd>
      <span>to open</span>
    </div>
  );
}

function UndoPill({
  move,
  onUndo,
  raised,
}: {
  move: MoveRecord;
  onUndo: () => void;
  raised: boolean;
}) {
  return (
    <div
      role="status"
      data-testid="board-undo"
      className={cn(
        "fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 animate-fade-in",
        "rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur",
        "py-1 pl-3 pr-1.5 text-[12.5px] text-[var(--fg)] shadow-sm",
        // One row above the sync notice when it shows.
        raised ? "bottom-[132px] md:bottom-14" : "bottom-[92px] md:bottom-4",
      )}
    >
      <StatusIcon status={move.to} size={13} className="text-[var(--fg-muted)]" />
      <span>Moved to {statusLabel(move.to)}</span>
      <button
        type="button"
        onClick={onUndo}
        className="rounded-full px-1.5 py-0.5 font-medium text-[var(--accent)] transition-colors hover:bg-[var(--surface-hover)]"
      >
        Undo
      </button>
      <Kbd className="hidden md:inline-flex">⌘Z</Kbd>
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div className={BOARD_BREAKOUT_CLASS} data-testid="board-skeleton">
      <div className={cn("flex gap-3 overflow-hidden pb-4", BOARD_GUTTER_CLASS)}>
        {BOARD_LIFECYCLES.map((lifecycle, i) => (
          <div
            key={lifecycle}
            className="flex w-[288px] shrink-0 flex-col gap-1.5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-sunken)] p-1.5 md:w-auto md:min-w-[200px] md:flex-1 md:shrink"
          >
            <Skeleton className="mx-2 mt-1.5 mb-2 h-3.5 w-20" />
            {[0, 1, 2].slice(0, 3 - (i % 2)).map((j) => (
              <Skeleton key={j} className="h-[68px] rounded-[var(--radius-md)]" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

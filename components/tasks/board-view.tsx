"use client";

import { isEditableTarget } from "@/components/app-shell/keyboard";
import { Kbd } from "@/components/ui/kbd";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { type BoardColumnData, selectBoardColumns } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardCard } from "./board-card";
import { BoardColumn } from "./board-column";
import { StatusIcon } from "./status-icon";

export const UNDO_WINDOW_MS = 6000;
const SETTLE_MS = 1300;

/**
 * Mouse and pen only: touch goes through the TouchSensor's long-press so a
 * swipe on a card scrolls the board instead of picking the card up.
 */
class MousePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: React.PointerEvent) =>
        event.isPrimary && event.button === 0 && event.pointerType !== "touch",
    },
  ];
}

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/**
 * Status a Done card returns to when unchecked, keyed by task id. Tied to
 * the completion it was recorded for, so a task re-completed elsewhere
 * (e.g. the detail sheet) falls back to Focus instead of a stale status.
 */
const restoreFromDone = new Map<string, { from: Lifecycle; completedAt: string | null }>();

interface Selection {
  status: Lifecycle;
  index: number;
  taskId: string | null;
}

interface UndoRecord {
  taskId: string;
  from: Lifecycle;
  to: Lifecycle;
}

function locate(columns: BoardColumnData[], sel: Selection) {
  if (sel.taskId) {
    for (let col = 0; col < columns.length; col++) {
      const index = columns[col]!.tasks.findIndex((t) => t.id === sel.taskId);
      if (index >= 0) return { col, index, task: columns[col]!.tasks[index]! };
    }
  }
  const col = Math.max(
    0,
    columns.findIndex((c) => c.status === sel.status),
  );
  const list = columns[col]!.tasks;
  const index = Math.min(Math.max(sel.index, 0), Math.max(list.length - 1, 0));
  return { col, index, task: list[index] ?? null };
}

/**
 * Board layout over the same tasks the lists show: one column per status
 * with a view. Every write goes through `setLifecycle`, so completedAt and
 * sync behave exactly as they do from the list and the detail sheet.
 */
export function BoardView({
  tasks,
  onOpen,
  onAdd,
  syncError = false,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  onAdd?: (status: Lifecycle) => void;
  /** The offline notice is visible; the undo pill sits one row above it. */
  syncError?: boolean;
}) {
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);

  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);
  const labelsById = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const totalCards = columns.reduce((n, c) => n + c.tasks.length, 0);

  const boardRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLElement>());
  const pendingFocus = React.useRef(false);
  const didInitialFocus = React.useRef(false);

  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [undo, setUndo] = React.useState<UndoRecord | null>(null);
  const [settled, setSettled] = React.useState<{
    taskId: string;
    status: Lifecycle;
    nonce: number;
  } | null>(null);
  const nonce = React.useRef(0);
  const [drag, setDrag] = React.useState<{
    task: Task;
    from: Lifecycle;
    height: number;
  } | null>(null);
  const [over, setOver] = React.useState<Lifecycle | null>(null);

  const located = selection ? locate(columns, selection) : null;

  const registerRef = React.useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  React.useEffect(() => {
    if (didInitialFocus.current || totalCards === 0) return;
    didInitialFocus.current = true;
    boardRef.current?.focus({ preventScroll: true });
  }, [totalCards]);

  // Focus follows keyboard actions only; re-sorts from sync or triage must
  // never pull focus out of an open sheet or dialog.
  const focusTaskId = located?.task?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `located.col` re-runs this after a filed card remounts in its new column.
  React.useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const el = focusTaskId ? cardRefs.current.get(focusTaskId) : null;
    const target = el ?? boardRef.current;
    target?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [focusTaskId, located?.col]);

  React.useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  React.useEffect(() => {
    if (!settled) return;
    const timer = setTimeout(() => setSettled(null), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settled]);

  const move = React.useCallback(
    (taskId: string, from: Lifecycle, to: Lifecycle, opts: { undoable: boolean }) => {
      if (from === to) return;
      setLifecycle(taskId, to);
      if (to === "done") {
        const completedAt =
          useStore.getState().tasks.find((t) => t.id === taskId)?.completedAt ?? null;
        restoreFromDone.set(taskId, { from, completedAt });
      }
      nonce.current += 1;
      setSettled({ taskId, status: to, nonce: nonce.current });
      if (opts.undoable) setUndo({ taskId, from, to });
    },
    [setLifecycle],
  );

  const performUndo = React.useCallback(() => {
    if (!undo) return;
    setUndo(null);
    pendingFocus.current = true;
    const live = useStore.getState().tasks.find((t) => t.id === undo.taskId);
    // Moved again elsewhere (e.g. the sheet) since: that newer intent wins.
    if (!live || live.lifecycle !== undo.to) return;
    move(undo.taskId, undo.to, undo.from, { undoable: false });
  }, [undo, move]);

  const toggleComplete = React.useCallback(
    (task: Task) => {
      if (task.lifecycle === "done") {
        const entry = restoreFromDone.get(task.id);
        restoreFromDone.delete(task.id);
        const to = entry && entry.completedAt === task.completedAt ? entry.from : "active";
        move(task.id, "done", to, { undoable: false });
      } else {
        move(task.id, task.lifecycle, "done", { undoable: false });
      }
    },
    [move],
  );

  // Read through a ref so `open` stays stable: every memoized card takes it,
  // and a new identity per write would re-render the whole board.
  const latest = React.useRef({ columns, onOpen });
  latest.current = { columns, onOpen };
  const open = React.useCallback((id: string) => {
    const { columns, onOpen } = latest.current;
    for (const column of columns) {
      const index = column.tasks.findIndex((t) => t.id === id);
      if (index >= 0) setSelection({ status: column.status, index, taskId: id });
    }
    onOpen(id);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
      if (undo) {
        e.preventDefault();
        performUndo();
      }
      return;
    }
    if (mod || e.altKey) return;

    const isNav = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "j", "k"].includes(e.key);
    if (e.key === "Enter") {
      if (e.target instanceof HTMLElement && e.target.closest("button")) return;
      if (located?.task) {
        e.preventDefault();
        open(located.task.id);
      }
      return;
    }
    if (!isNav) return;
    e.preventDefault();

    if (!located) {
      const first = columns.find((c) => c.tasks.length > 0);
      if (!first) return;
      pendingFocus.current = true;
      setSelection({ status: first.status, index: 0, taskId: first.tasks[0]!.id });
      return;
    }

    const { col, index, task } = located;
    const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "k" ? -1 : 1;

    if (horizontal && e.shiftKey) {
      const target = columns[col + step];
      if (!task || !target) return;
      pendingFocus.current = true;
      move(task.id, task.lifecycle, target.status, { undoable: true });
      return;
    }

    pendingFocus.current = true;
    if (horizontal) {
      const nextCol = Math.min(Math.max(col + step, 0), columns.length - 1);
      const list = columns[nextCol]!.tasks;
      const nextIndex = Math.min(index, Math.max(list.length - 1, 0));
      setSelection({
        status: columns[nextCol]!.status,
        index: nextIndex,
        taskId: list[nextIndex]?.id ?? null,
      });
    } else {
      const list = columns[col]!.tasks;
      if (list.length === 0) return;
      const nextIndex = Math.min(Math.max(index + step, 0), list.length - 1);
      setSelection({ status: columns[col]!.status, index: nextIndex, taskId: list[nextIndex]!.id });
    }
  };

  const sensors = useSensors(
    useSensor(MousePointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const onDragStart = (e: DragStartEvent) => {
    const task = tasks.find((t) => t.id === e.active.id);
    if (!task) return;
    setDrag({ task, from: task.lifecycle, height: e.active.rect.current.initial?.height ?? 72 });
    setOver(task.lifecycle);
  };

  const onDragOver = (e: DragOverEvent) => {
    setOver((e.over?.id as Lifecycle | undefined) ?? null);
  };

  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const current = drag;
    endDrag();
    const to = e.over?.id as Lifecycle | undefined;
    if (!current || !to || to === current.from) return;
    // The dragged card remounts in its new column; keep focus on the board
    // so ⌘Z reaches it.
    boardRef.current?.focus({ preventScroll: true });
    move(current.task.id, current.from, to, { undoable: true });
  };

  const dropTarget = drag && over && over !== drag.from ? over : null;

  return (
    <div className="pb-8">
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={endDrag}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Press Shift and the left or right arrow to file this card into the next column. Press Enter to open it.",
          },
        }}
      >
        <div
          ref={boardRef}
          role="group"
          aria-label="Board"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the board is the keyboard surface (arrows, Shift+arrows, Enter), like the task listbox.
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) boardRef.current?.focus();
          }}
          className={cn(
            "flex gap-3 overflow-x-auto focus:outline-none",
            drag ? "snap-none" : "snap-x snap-mandatory md:snap-none",
            "-mx-4 px-4 scroll-px-4 sm:-mx-6 sm:px-6 sm:scroll-px-6 md:mx-0 md:px-0 pb-2",
          )}
        >
          {columns.map((column) => {
            let count = column.tasks.length;
            if (dropTarget && drag) {
              if (column.status === drag.from) count -= 1;
              if (column.status === dropTarget) count += 1;
            }
            const isSelectedColumn = located && columns[located.col]?.status === column.status;
            return (
              <BoardColumn
                key={column.status}
                status={column.status}
                tasks={column.tasks}
                count={count}
                countPulse={settled?.status === column.status ? settled.nonce : null}
                labelsById={labelsById}
                selectedTaskId={located?.task?.id ?? null}
                emptySelected={!!isSelectedColumn && !located?.task}
                settlingTaskId={settled?.taskId ?? null}
                dropTarget={dropTarget === column.status}
                slotHeight={drag?.height ?? 72}
                onOpen={open}
                onToggleComplete={toggleComplete}
                onAdd={onAdd}
                registerRef={registerRef}
              />
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {drag ? <BoardCard task={drag.task} labelsById={labelsById} overlay /> : null}
        </DragOverlay>
      </DndContext>

      {totalCards > 0 ? (
        <div className="hidden md:flex items-center gap-1.5 mt-4 text-[11.5px] text-[var(--fg-subtle)]">
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
      ) : null}

      {undo ? (
        <div
          role="status"
          className={cn(
            "fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 animate-rise",
            "rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur",
            "pl-3 pr-1.5 py-1 text-[12px] text-[var(--fg-muted)] shadow-sm",
            syncError ? "bottom-[132px] md:bottom-14" : "bottom-[92px] md:bottom-4",
          )}
        >
          <StatusIcon status={undo.to} size={13} className="text-[var(--fg-muted)]" />
          <span>
            Moved to <span className="text-[var(--fg)]">{statusLabel(undo.to)}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              boardRef.current?.focus({ preventScroll: true });
              performUndo();
            }}
            className="rounded-full px-2 py-0.5 font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            Undo
          </button>
          <Kbd className="hidden sm:inline-flex">⌘Z</Kbd>
        </div>
      ) : null}
    </div>
  );
}

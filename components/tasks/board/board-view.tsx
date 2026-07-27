"use client";

import { useOptionalFrame } from "@/components/app-shell/app-frame";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { selectBoardColumns } from "@/lib/store/selectors";
import { getSyncHooks, useStore } from "@/lib/store/store";
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
import { STATUS_ICONS } from "../status-icon";
import { BoardCard } from "./board-card";
import { BoardColumn } from "./board-column";
import { BoardKeyboardHint, useBoardHint } from "./board-keyboard-hint";
import { MoveToSheet } from "./move-to-sheet";
import { UndoPill } from "./undo-pill";

/**
 * The board: the five statuses that have a view, in pipeline order, as
 * columns. It deliberately owns the whole pipeline — entering the board
 * from any status page shows the same five columns, because the board is
 * the overview, not another filter.
 *
 * Interaction model:
 *  - Drag (pointer) files a card by dropping it on a column. The move is
 *    optimistic — the store first, the network in the background — and
 *    every drop is reversible through the undo pill (6s, ⌘Z).
 *  - Keyboard mirrors the list: j/k and ↑/↓ within a column, ←/→ across
 *    columns, ⇧←/⇧→ file the selected card, ↵ opens it. dnd-kit handles
 *    pointer and touch only; the keyboard move is a direct status change.
 *  - Touch: columns snap-scroll horizontally with a status pager, and a
 *    long-press opens the "Move to" sheet — no touch dragging.
 *
 * If a move's background push doesn't land, the card keeps its new column
 * (the dirty ledger replays the move on the next mount); the pill switches
 * to "Saved locally" instead of rolling back an intent the system is
 * committed to delivering.
 */

const UNDO_WINDOW_MS = 6000;
/** Mobile column width (px) + the gap-3 between columns; used by the pager. */
const MOBILE_COLUMN_STRIDE = 300 + 12;

interface UndoEntry {
  seq: number;
  taskId: string;
  title: string;
  from: Lifecycle;
  to: Lifecycle;
  prevCompletedAt: string | null;
  savedLocally: boolean;
}

export function BoardView({ onOpen }: { onOpen: (id: string) => void }) {
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const updateTask = useStore((s) => s.updateTask);
  const frame = useOptionalFrame();

  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const height = useMeasuredHeight(rootRef);
  const reducedMotion = usePrefersReducedMotion();
  const { hintVisible, retireHint } = useBoardHint();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activeTask, setActiveTask] = React.useState<Task | null>(null);
  const [overStatus, setOverStatus] = React.useState<Lifecycle | null>(null);
  const [undo, setUndo] = React.useState<UndoEntry | null>(null);
  const [lastMoved, setLastMoved] = React.useState<{
    id: string;
    seq: number;
    viaKeyboard: boolean;
  } | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [sheetTask, setSheetTask] = React.useState<Task | null>(null);
  const [pagerIndex, setPagerIndex] = React.useState(0);

  const seqRef = React.useRef(0);

  const focusCard = React.useCallback((id: string) => {
    const root = rootRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>("[data-task-id]")) {
      if (el.dataset.taskId === id) {
        el.focus();
        return;
      }
    }
  }, []);

  const moveTask = React.useCallback(
    (task: Task, to: Lifecycle, opts: { viaKeyboard?: boolean } = {}) => {
      if (task.lifecycle === to) return;
      seqRef.current += 1;
      const seq = seqRef.current;
      updateTask(task.id, { lifecycle: to });
      setUndo({
        seq,
        taskId: task.id,
        title: task.title,
        from: task.lifecycle,
        to,
        prevCompletedAt: task.completedAt,
        savedLocally: false,
      });
      setLastMoved({ id: task.id, seq, viaKeyboard: opts.viaKeyboard ?? false });
      setSelectedId(task.id);
      setAnnouncement(`${task.title} moved to ${statusLabel(to)}`);
      if (opts.viaKeyboard) retireHint();

      // "Saved locally" detection: flush the debounced push, and if the
      // task is still marked dirty once its chain settles, the push failed
      // — the ledger will replay it, so the pill tells the truth without
      // rolling the card back.
      const hooks = getSyncHooks();
      if (hooks) {
        void hooks.waitForTask(task.id).then(() => {
          if (hooks.isTaskDirty(task.id)) {
            setUndo((u) => (u && u.seq === seq ? { ...u, savedLocally: true } : u));
          }
        });
      }
    },
    [updateTask, retireHint],
  );

  const undoMove = React.useCallback(() => {
    if (!undo) return;
    updateTask(undo.taskId, { lifecycle: undo.from, completedAt: undo.prevCompletedAt });
    setAnnouncement(`Move undone — back in ${statusLabel(undo.from)}`);
    setLastMoved({ id: undo.taskId, seq: undo.seq, viaKeyboard: false });
    setUndo(null);
  }, [undo, updateTask]);

  // The undo window: 6 seconds, then the pill retires itself.
  React.useEffect(() => {
    if (!undo) return;
    const seq = undo.seq;
    const timer = setTimeout(() => {
      setUndo((u) => (u && u.seq === seq ? null : u));
    }, UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  // ⌘Z / Ctrl+Z while the window is open.
  React.useEffect(() => {
    if (!undo) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        const target = e.target;
        if (
          target instanceof HTMLElement &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        undoMove();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, undoMove]);

  // After a keyboard move the card remounts in its new column; put real
  // DOM focus back on it so the selection travels with the card.
  React.useEffect(() => {
    if (lastMoved?.viaKeyboard) focusCard(lastMoved.id);
  }, [lastMoved, focusCard]);

  const completeTask = React.useCallback(
    (task: Task) => {
      if (task.lifecycle === "done") {
        // Uncheck: back to Focus, same as the list rows.
        moveTask(task, "active");
      } else {
        moveTask(task, "done");
      }
    },
    [moveTask],
  );

  // --- Keyboard model -------------------------------------------------------

  const onCardKeyDown = React.useCallback(
    (e: React.KeyboardEvent, task: Task) => {
      const colIndex = columns.findIndex((c) => c.status === task.lifecycle);
      const column = columns[colIndex];
      if (!column) return;
      const cards = column.tasks;
      const cardIndex = cards.findIndex((t) => t.id === task.id);

      const selectCard = (t: Task | undefined) => {
        if (!t) return;
        setSelectedId(t.id);
        focusCard(t.id);
      };

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        selectCard(cards[Math.min(cards.length - 1, cardIndex + 1)]);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        selectCard(cards[Math.max(0, cardIndex - 1)]);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        if (e.shiftKey) {
          const to = columns[colIndex + dir]?.status;
          if (to) moveTask(task, to, { viaKeyboard: true });
        } else {
          // Selection crosses to the nearest non-empty column, keeping the
          // row position where it can.
          for (let i = colIndex + dir; i >= 0 && i < columns.length; i += dir) {
            const target = columns[i]?.tasks ?? [];
            if (target.length > 0) {
              selectCard(target[Math.min(target.length - 1, cardIndex)]);
              break;
            }
          }
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen(task.id);
      }
    },
    [columns, moveTask, onOpen, focusCard],
  );

  // Roving tabindex: the selected card is the tab stop; before any
  // selection, the first card of the first non-empty column is.
  const tabStopId = React.useMemo(() => {
    if (selectedId && tasks.some((t) => t.id === selectedId)) return selectedId;
    return columns.find((c) => c.tasks.length > 0)?.tasks[0]?.id ?? null;
  }, [selectedId, tasks, columns]);

  // --- Drag ----------------------------------------------------------------

  const sensors = useSensors(
    // Mouse only: a 5px threshold keeps plain clicks opening the detail
    // sheet. Touch never drags — it scrolls, and long-press files.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
  );

  const onDragStart = React.useCallback((event: DragStartEvent) => {
    const task = event.active.data.current?.task as Task | undefined;
    if (task) {
      setActiveTask(task);
      setSelectedId(task.id);
    }
  }, []);

  const onDragOver = React.useCallback((event: DragOverEvent) => {
    setOverStatus((event.over?.data.current?.status as Lifecycle | undefined) ?? null);
  }, []);

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const task = event.active.data.current?.task as Task | undefined;
      const to = event.over?.data.current?.status as Lifecycle | undefined;
      if (task && to && to !== task.lifecycle) moveTask(task, to);
      setActiveTask(null);
      setOverStatus(null);
    },
    [moveTask],
  );

  const onDragCancel = React.useCallback(() => {
    setActiveTask(null);
    setOverStatus(null);
  }, []);

  // --- Mobile pager ---------------------------------------------------------

  const scrollToColumn = (index: number) => {
    scrollRef.current?.scrollTo({
      left: index * MOBILE_COLUMN_STRIDE,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  const onBoardScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setPagerIndex(
      Math.max(0, Math.min(columns.length - 1, Math.round(el.scrollLeft / MOBILE_COLUMN_STRIDE))),
    );
  };

  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-1 flex-col"
      style={height !== null ? { height } : undefined}
    >
      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 md:hidden">
        {columns.map((col, i) => {
          const Icon = STATUS_ICONS[col.status];
          const active = i === pagerIndex;
          return (
            <button
              key={col.status}
              type="button"
              aria-current={active || undefined}
              onClick={() => scrollToColumn(i)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]",
                "transition-colors duration-150 ease-[var(--ease-product)]",
                active
                  ? "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--fg)]"
                  : "border-[var(--border)] bg-transparent text-[var(--fg-muted)]",
              )}
            >
              <Icon size={12} className="opacity-80" />
              {col.label}
              <span className="text-num text-[11px] text-[var(--fg-subtle)]">
                {col.tasks.length}
              </span>
            </button>
          );
        })}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div
          ref={scrollRef}
          onScroll={onBoardScroll}
          className={cn(
            "flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1",
            "snap-x snap-mandatory md:snap-none",
          )}
        >
          {columns.map((col) => (
            <BoardColumn
              key={col.status}
              column={col}
              labels={labels}
              dropPreview={
                overStatus === col.status &&
                activeTask !== null &&
                activeTask.lifecycle !== col.status
              }
              selectedId={selectedId}
              tabStopId={tabStopId}
              lastMoved={lastMoved}
              onOpen={onOpen}
              onComplete={completeTask}
              onCardKeyDown={onCardKeyDown}
              onCardFocus={(task) => setSelectedId(task.id)}
              onLongPress={setSheetTask}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
          {activeTask ? (
            <BoardCard task={activeTask} labels={labels} overlay selected={false} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {hintVisible ? <BoardKeyboardHint /> : null}

      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      {undo ? (
        <UndoPill
          message={
            undo.savedLocally
              ? "Saved locally — Sifty will sync it"
              : `Moved to ${statusLabel(undo.to)}`
          }
          onUndo={undoMove}
          raised={frame?.syncDegraded ?? false}
        />
      ) : null}

      <MoveToSheet task={sheetTask} onClose={() => setSheetTask(null)} onMove={moveTask} />
    </div>
  );
}

/**
 * Column scroll needs a real height ceiling ("columns scroll; they never
 * truncate"), but the space above the board differs per page (header,
 * description). Measure the board's own top edge instead of hardcoding it.
 */
function useMeasuredHeight(ref: React.RefObject<HTMLDivElement | null>): number | null {
  const [height, setHeight] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const mdUp = window.matchMedia("(min-width: 768px)").matches;
      // Below md the fixed bottom nav (80px) needs clearance.
      const clearance = mdUp ? 16 : 96;
      setHeight(Math.max(320, window.innerHeight - top - clearance));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref]);

  return height;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

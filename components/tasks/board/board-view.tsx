"use client";

import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { selectBoardColumns } from "@/lib/store/selectors";
import { getSyncHooks, useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardCardOverlay } from "./board-card";
import { BoardColumn, BoardColumnSkeleton } from "./board-column";
import { BoardKeyboardHint, markHintSeen, readHintSeen } from "./board-keyboard-hint";
import { MoveToSheet } from "./move-to-sheet";
import { UndoPill } from "./undo-pill";

const UNDO_WINDOW_MS = 6000;
const COLUMN_ORDER = ["inbox", "active", "waiting", "someday", "done"] as const;

/** Prefer column droppables — cards are never insertion targets. */
const boardCollision: CollisionDetection = (args) => {
  const columns = args.droppableContainers.filter((c) => String(c.id).startsWith("column:"));
  const pointerHits = pointerWithin({ ...args, droppableContainers: columns });
  if (pointerHits.length > 0) return pointerHits;
  const rectHits = rectIntersection({ ...args, droppableContainers: columns });
  if (rectHits.length > 0) return rectHits;
  // Fall back so a drag over a card still resolves to some column via center.
  return closestCenter({ ...args, droppableContainers: columns });
};

interface PendingUndo {
  taskId: string;
  from: Lifecycle;
  to: Lifecycle;
  previousCompletedAt: string | null;
  expiresAt: number;
}

/**
 * Five-column Kanban over STATUS_VIEWS. Pointer drag files between columns;
 * keyboard mirrors the list (j/k, arrows, ⇧arrows); mobile uses snap-scroll
 * + long-press "Move to" instead of fighting horizontal scroll with drag.
 */
export function BoardView({ onOpen }: { onOpen: (id: string) => void }) {
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const updateTask = useStore((s) => s.updateTask);

  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);

  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [overStatus, setOverStatusState] = React.useState<Lifecycle | null>(null);
  const overStatusRef = React.useRef<Lifecycle | null>(null);
  const setOverStatus = React.useCallback((status: Lifecycle | null) => {
    overStatusRef.current = status;
    setOverStatusState(status);
  }, []);
  const [settlingTaskId, setSettlingTaskId] = React.useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = React.useState<PendingUndo | null>(null);
  const [pillState, setPillState] = React.useState<"undo" | "saved-locally">("undo");
  const [hintVisible, setHintVisible] = React.useState(false);
  const [announce, setAnnounce] = React.useState("");
  const [mobileColumn, setMobileColumn] = React.useState(0);
  const [moveSheetTaskId, setMoveSheetTaskId] = React.useState<string | null>(null);
  const [isMobileBoard, setIsMobileBoard] = React.useState(false);

  const boardRef = React.useRef<HTMLDivElement>(null);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement | null>());
  const undoTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Suppress the click that browsers fire after a successful drag. */
  const suppressClickRef = React.useRef(false);

  React.useEffect(() => {
    setHintVisible(!readHintSeen());
    // Narrow viewports get snap-scroll + long-press Move-to (drag fights the
    // horizontal strip). Wide coarse pointers (iPad landscape) keep pointer
    // drag — they have room for columns side-by-side.
    const narrow = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileBoard(narrow.matches);
    update();
    narrow.addEventListener("change", update);
    return () => narrow.removeEventListener("change", update);
  }, []);

  // Seed selection when columns first gain tasks.
  React.useEffect(() => {
    if (selectedTaskId) {
      const stillThere = columns.some((c) => c.tasks.some((t) => t.id === selectedTaskId));
      if (stillThere) return;
    }
    const first = columns.find((c) => c.tasks.length > 0)?.tasks[0];
    if (first) setSelectedTaskId(first.id);
  }, [columns, selectedTaskId]);

  React.useEffect(() => {
    if (!selectedTaskId) return;
    cardRefs.current.get(selectedTaskId)?.focus({ preventScroll: true });
  }, [selectedTaskId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const clearUndoTimer = React.useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  const moveTask = React.useCallback(
    (taskId: string, to: Lifecycle, opts?: { viaKeyboard?: boolean }) => {
      const task = useStore.getState().tasks.find((t) => t.id === taskId);
      if (!task || task.lifecycle === to) return;

      const from = task.lifecycle;
      const previousCompletedAt = task.completedAt;

      updateTask(taskId, { lifecycle: to });

      setSettlingTaskId(taskId);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => setSettlingTaskId(null), 500);

      const undo: PendingUndo = {
        taskId,
        from,
        to,
        previousCompletedAt,
        expiresAt: Date.now() + UNDO_WINDOW_MS,
      };
      setPendingUndo(undo);
      setPillState("undo");
      clearUndoTimer();
      undoTimerRef.current = setTimeout(() => {
        setPendingUndo(null);
      }, UNDO_WINDOW_MS);

      setSelectedTaskId(taskId);
      setAnnounce(`Moved to ${statusLabel(to)}`);

      if (opts?.viaKeyboard) {
        markHintSeen();
        setHintVisible(false);
      }

      // If the push is still dirty after settle, flip the pill copy — don't
      // snap the card back; the dirty ledger will replay on next mount.
      const hooks = getSyncHooks();
      if (hooks) {
        void hooks.waitForTask(taskId).then(() => {
          if (hooks.isTaskDirty(taskId)) {
            setPillState("saved-locally");
          }
        });
        // Also check shortly after — waitForTask may resolve before dirty clears.
        window.setTimeout(() => {
          if (hooks.isTaskDirty(taskId)) setPillState("saved-locally");
        }, 800);
      }
    },
    [updateTask, clearUndoTimer],
  );

  const undoMove = React.useCallback(() => {
    if (!pendingUndo) return;
    const { taskId, from, previousCompletedAt } = pendingUndo;
    updateTask(taskId, { lifecycle: from, completedAt: previousCompletedAt });
    setPendingUndo(null);
    clearUndoTimer();
    setSelectedTaskId(taskId);
    setAnnounce(`Restored to ${statusLabel(from)}`);
  }, [pendingUndo, updateTask, clearUndoTimer]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && pendingUndo) {
        // Don't steal undo from text fields.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
          return;
        }
        e.preventDefault();
        undoMove();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingUndo, undoMove]);

  const findTaskLocation = React.useCallback(
    (taskId: string | null): { col: number; row: number } | null => {
      if (!taskId) return null;
      for (let col = 0; col < columns.length; col++) {
        const column = columns[col];
        if (!column) continue;
        const row = column.tasks.findIndex((t) => t.id === taskId);
        if (row >= 0) return { col, row };
      }
      return null;
    },
    [columns],
  );

  const handleBoardKey = React.useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      const loc = findTaskLocation(selectedTaskId);
      if (!loc && columns.every((c) => c.tasks.length === 0)) return;

      const focusAt = (col: number, row: number) => {
        const clampedCol = Math.max(0, Math.min(columns.length - 1, col));
        const column = columns[clampedCol];
        if (!column) return;
        if (column.tasks.length === 0) {
          // Skip empty columns when moving horizontally.
          const dir = col > (loc?.col ?? 0) ? 1 : -1;
          let next = clampedCol + dir;
          while (next >= 0 && next < columns.length) {
            const candidate = columns[next];
            if (candidate && candidate.tasks.length > 0) break;
            next += dir;
          }
          const landed = columns[next];
          if (!landed || landed.tasks.length === 0) return;
          const r = Math.min(row, landed.tasks.length - 1);
          const task = landed.tasks[r];
          if (task) setSelectedTaskId(task.id);
          return;
        }
        const r = Math.max(0, Math.min(column.tasks.length - 1, row));
        const task = column.tasks[r];
        if (task) setSelectedTaskId(task.id);
      };

      if (e.key === "ArrowDown" || e.key === "j") {
        if (!loc) return;
        e.preventDefault();
        focusAt(loc.col, loc.row + 1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        if (!loc) return;
        e.preventDefault();
        focusAt(loc.col, loc.row - 1);
      } else if (e.key === "ArrowRight" && !e.shiftKey) {
        if (!loc) return;
        e.preventDefault();
        focusAt(loc.col + 1, loc.row);
      } else if (e.key === "ArrowLeft" && !e.shiftKey) {
        if (!loc) return;
        e.preventDefault();
        focusAt(loc.col - 1, loc.row);
      } else if (e.key === "ArrowRight" && e.shiftKey) {
        if (!loc || !selectedTaskId) return;
        e.preventDefault();
        const nextStatus = COLUMN_ORDER[Math.min(COLUMN_ORDER.length - 1, loc.col + 1)] ?? "done";
        moveTask(selectedTaskId, nextStatus, { viaKeyboard: true });
      } else if (e.key === "ArrowLeft" && e.shiftKey) {
        if (!loc || !selectedTaskId) return;
        e.preventDefault();
        const nextStatus = COLUMN_ORDER[Math.max(0, loc.col - 1)] ?? "inbox";
        moveTask(selectedTaskId, nextStatus, { viaKeyboard: true });
      } else if (e.key === "Enter") {
        if (!selectedTaskId) return;
        e.preventDefault();
        onOpen(selectedTaskId);
      }
    },
    [columns, findTaskLocation, moveTask, onOpen, selectedTaskId],
  );

  // Scoped like TaskList: only when focus is inside the board (or on a card
  // option). Avoids stealing j/k from the sidebar, toggle, or other chrome.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const root = boardRef.current;
      if (!root || !target) return;
      const inside = root.contains(target);
      const onOption = target.getAttribute("role") === "option";
      if (!inside && !onOption) return;
      handleBoardKey(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleBoardKey]);

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setDraggingId(id);
    setSelectedTaskId(id);
  };

  const onDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id;
    if (!overId) {
      setOverStatus(null);
      return;
    }
    const id = String(overId);
    if (id.startsWith("column:")) {
      setOverStatus(id.slice("column:".length) as Lifecycle);
      return;
    }
    const data = event.over?.data.current;
    if (data?.type === "column" && data.status) {
      setOverStatus(data.status as Lifecycle);
      return;
    }
    setOverStatus(null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const taskId = String(event.active.id);
    const live = useStore.getState().tasks.find((t) => t.id === taskId);
    const from =
      live?.lifecycle ?? (event.active.data.current?.from as Lifecycle | undefined) ?? null;

    // Column-only collision means over is a column id; also trust the ref
    // (state can be a frame behind when drag-end fires in the same tick).
    let to: Lifecycle | null = overStatusRef.current;
    const overId = event.over ? String(event.over.id) : null;
    if (overId?.startsWith("column:")) {
      to = overId.slice("column:".length) as Lifecycle;
    } else if (event.over?.data.current?.type === "column") {
      to = event.over.data.current.status as Lifecycle;
    }

    setDraggingId(null);
    setOverStatus(null);
    if (from && to && from !== to) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 250);
      moveTask(taskId, to);
    }
  };

  const onDragCancel = () => {
    setDraggingId(null);
    setOverStatus(null);
  };

  const draggingTask = draggingId ? tasks.find((t) => t.id === draggingId) : null;

  const previewCounts = React.useMemo(() => {
    if (!draggingId || !overStatus) return null;
    const task = tasks.find((t) => t.id === draggingId);
    if (!task || task.lifecycle === overStatus) return null;
    const map = new Map<Lifecycle, number>();
    for (const col of columns) {
      let n = col.tasks.length;
      if (col.status === task.lifecycle) n -= 1;
      if (col.status === overStatus) n += 1;
      map.set(col.status, n);
    }
    return map;
  }, [draggingId, overStatus, tasks, columns]);

  // Mobile snap pager: observe which column is most visible.
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const children = Array.from(scroller.querySelectorAll<HTMLElement>("[data-column]"));
      if (children.length === 0) return;
      const scrollLeft = scroller.scrollLeft;
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      children.forEach((child, i) => {
        const dist = Math.abs(child.offsetLeft - scrollLeft);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setMobileColumn(best);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToColumn = (index: number) => {
    const scroller = scrollerRef.current;
    const child = scroller?.querySelectorAll<HTMLElement>("[data-column]")[index];
    child?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    setMobileColumn(index);
  };

  const moveSheetTask = moveSheetTaskId
    ? (tasks.find((t) => t.id === moveSheetTaskId) ?? null)
    : null;

  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div className="relative flex flex-col gap-3 pb-4">
      <div className="md:hidden flex gap-1.5 overflow-x-auto px-0.5 pb-1">
        {columns.map((col, i) => (
          <button
            key={col.status}
            type="button"
            onClick={() => scrollToColumn(i)}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium",
              "border border-[var(--border)] transition-colors duration-150",
              i === mobileColumn
                ? "bg-[var(--surface)] text-[var(--fg)] border-[var(--border-strong)]"
                : "bg-[var(--surface-muted)] text-[var(--fg-muted)]",
            )}
          >
            {col.label}
            <span className="ml-1 text-num text-[10.5px] text-[var(--fg-subtle)]">
              {col.tasks.length}
            </span>
          </button>
        ))}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={boardCollision}
        onDragStart={isMobileBoard ? undefined : onDragStart}
        onDragOver={isMobileBoard ? undefined : onDragOver}
        onDragEnd={isMobileBoard ? undefined : onDragEnd}
        onDragCancel={isMobileBoard ? undefined : onDragCancel}
      >
        <div
          ref={boardRef}
          className="outline-none"
          aria-label="Task board"
          onClickCapture={(e) => {
            if (!suppressClickRef.current) return;
            e.preventDefault();
            e.stopPropagation();
            suppressClickRef.current = false;
          }}
        >
          <div
            ref={scrollerRef}
            className={cn(
              "flex gap-2.5 overflow-x-auto pb-2",
              "snap-x snap-mandatory md:snap-none",
              "md:overflow-x-auto",
            )}
          >
            {columns.map((col) => (
              <BoardColumn
                key={col.status}
                status={col.status}
                label={col.label}
                tasks={col.tasks}
                labels={labels}
                selectedTaskId={selectedTaskId}
                draggingTaskId={draggingId}
                over={overStatus === col.status}
                previewCount={previewCounts?.get(col.status) ?? null}
                settlingTaskId={reducedMotion ? null : settlingTaskId}
                cardRefs={cardRefs}
                onOpen={onOpen}
                onSelect={setSelectedTaskId}
                onLongPress={isMobileBoard ? (id) => setMoveSheetTaskId(id) : undefined}
                draggable={!isMobileBoard}
                suppressOpenRef={suppressClickRef}
              />
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
          {draggingTask ? <BoardCardOverlay task={draggingTask} labels={labels} /> : null}
        </DragOverlay>
      </DndContext>

      <BoardKeyboardHint visible={hintVisible} className="mt-1" />

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </div>

      {pendingUndo ? (
        <UndoPill
          message={
            pillState === "saved-locally"
              ? "Saved locally — Sifty will sync it"
              : `Moved to ${statusLabel(pendingUndo.to)}`
          }
          state={pillState}
          onUndo={pillState === "undo" ? undoMove : undefined}
        />
      ) : null}

      <MoveToSheet
        open={!!moveSheetTask}
        onOpenChange={(open) => {
          if (!open) setMoveSheetTaskId(null);
        }}
        currentStatus={moveSheetTask?.lifecycle ?? "inbox"}
        taskTitle={moveSheetTask?.title ?? ""}
        onMove={(status) => {
          if (moveSheetTask) moveTask(moveSheetTask.id, status);
        }}
      />
    </div>
  );
}

export function BoardViewSkeleton() {
  return (
    <div className="flex gap-2.5 overflow-hidden">
      {COLUMN_ORDER.map((s) => (
        <BoardColumnSkeleton key={s} />
      ))}
    </div>
  );
}

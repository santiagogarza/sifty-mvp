"use client";

import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS, statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { selectBoardColumns } from "@/lib/store/selectors";
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
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardCard } from "./board-card";
import { BoardColumn, EMPTY_DROP_AREA_PX } from "./board-column";
import { StatusIcon } from "./status-icon";

export const BOARD_TITLE = "Everything, by status";
export const BOARD_DESCRIPTION =
  "Drag a card to another column to file it. Same order, words, and icons as the sidebar.";

/** How long a move can be undone. After this the record is dropped and ⌘Z does nothing. */
export const UNDO_WINDOW_MS = 6000;

interface UndoRecord {
  id: string;
  prev: Lifecycle;
  next: Lifecycle;
}

interface Lifted {
  id: string;
  from: Lifecycle;
}

/**
 * Board layout over the same tasks and the same `lifecycle` field as the
 * lists. Columns come from `STATUS_VIEWS`; cards come from the same
 * selectors as each status view, so List and Board never disagree on where
 * a task sits or in what order.
 *
 * Every status write — drop, Shift+arrow, complete, undo — goes through
 * `setLifecycle` / `updateTask`, the same path as the Status picker, so a
 * move syncs and survives refresh like any other edit.
 *
 * Takes `tasks` and `onOpen` as props (like `TaskList`) rather than reading
 * the frame itself, so it renders in tests without `AppFrame`.
 */
export function BoardView({
  tasks,
  onOpen,
  onAdd,
  stackAboveNotice = false,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  onAdd?: (lifecycle: Lifecycle) => void;
  /** The offline notice shares the undo pill's fixed slot; sit one row above it. */
  stackAboveNotice?: boolean;
}) {
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const updateTask = useStore((s) => s.updateTask);
  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [lifted, setLifted] = React.useState<Lifted | null>(null);
  const [overStatus, setOverStatus] = React.useState<Lifecycle | null>(null);
  const [undo, setUndo] = React.useState<UndoRecord | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const didInitialFocus = React.useRef(false);
  const focusingProgrammatically = React.useRef(false);
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // A drop releases the pointer over some card (often the lifted card's own
  // ghost); the click that follows must not open the sheet.
  const dragJustEnded = React.useRef(false);

  // Status a task had before this session completed it, so unchecking a
  // Done card puts it back where it came from. Unknown → Focus, matching
  // `TaskRow`'s `uncompleteTo` default.
  const priorRef = React.useRef(new Map<string, Lifecycle>());

  const position = React.useMemo(() => {
    const map = new Map<string, { col: number; row: number }>();
    columns.forEach((column, col) => {
      column.tasks.forEach((task, row) => map.set(task.id, { col, row }));
    });
    return map;
  }, [columns]);

  const hasTasks = columns.some((c) => c.tasks.length > 0);

  const setCardRef = React.useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  React.useEffect(() => {
    if (!hasTasks || didInitialFocus.current) return;
    didInitialFocus.current = true;
    focusingProgrammatically.current = true;
    containerRef.current?.focus({ preventScroll: true });
    focusingProgrammatically.current = false;
  }, [hasTasks]);

  // Focus follows the selection, including after a card changes column and
  // remounts (its column index is the signal). Only when focus is already
  // ours, or fell to body because the old node went away — never steal it
  // from the toggle or a dialog.
  const selectedColumn = selectedId ? position.get(selectedId)?.col : undefined;
  React.useEffect(() => {
    if (!selectedId || selectedColumn === undefined) return;
    const el = cardRefs.current.get(selectedId);
    if (!el) return;
    const active = document.activeElement;
    const ours =
      !active ||
      active === document.body ||
      !active.isConnected ||
      !!containerRef.current?.contains(active);
    if (!ours || active === el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId, selectedColumn]);

  React.useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const armUndo = React.useCallback((record: UndoRecord) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(record);
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      setUndo(null);
    }, UNDO_WINDOW_MS);
  }, []);

  const clearUndo = React.useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndo(null);
  }, []);

  const performUndo = React.useCallback(() => {
    if (!undo) return;
    const task = useStore.getState().tasks.find((t) => t.id === undo.id);
    // Only revert what we moved; if something else re-filed it since, leave it.
    if (task && task.lifecycle === undo.next) {
      if (undo.prev === "done") priorRef.current.delete(undo.id);
      updateTask(undo.id, { lifecycle: undo.prev });
    }
    clearUndo();
  }, [undo, updateTask, clearUndo]);

  /** The one status write. Same-column is a no-op: no write, no pill. */
  const moveTask = React.useCallback(
    (id: string, to: Lifecycle): boolean => {
      const task = useStore.getState().tasks.find((t) => t.id === id);
      if (!task || task.lifecycle === to) return false;
      if (to === "done") priorRef.current.set(id, task.lifecycle);
      setLifecycle(id, to);
      armUndo({ id, prev: task.lifecycle, next: to });
      return true;
    },
    [setLifecycle, armUndo],
  );

  const onComplete = React.useCallback(
    (id: string) => {
      const task = useStore.getState().tasks.find((t) => t.id === id);
      if (!task) return;
      if (task.lifecycle === "done") moveTask(id, priorRef.current.get(id) ?? "active");
      else moveTask(id, "done");
    },
    [moveTask],
  );

  const handleOpen = React.useCallback(
    (id: string) => {
      if (dragJustEnded.current) return;
      onOpen(id);
    },
    [onOpen],
  );

  const selectFirst = () => {
    const column = columns.find((c) => c.tasks.length > 0);
    const first = column?.tasks[0];
    if (first) setSelectedId(first.id);
  };

  // Tabbing onto the board lands on a card, so keyboard focus is shown by
  // the card's border rather than a ring around the whole board. Mouse
  // focus (clicking empty board) and the mount autofocus select nothing.
  const onContainerFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || selectedId || focusingProgrammatically.current) return;
    if (matchesFocusVisible(e.currentTarget)) selectFirst();
  };

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

    // Everything below is navigation for the board itself and its cards,
    // not for other controls inside it (Add, the pill's Undo button).
    const target = e.target as HTMLElement;
    if (target !== e.currentTarget && target.getAttribute("role") !== "option") return;

    const pos = selectedId ? position.get(selectedId) : undefined;

    switch (e.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (!pos || !selectedId) {
          if (!e.shiftKey) selectFirst();
          return;
        }
        if (e.shiftKey) {
          const destination = columns[pos.col + dir];
          if (destination) moveTask(selectedId, destination.status);
          return;
        }
        for (let col = pos.col + dir; col >= 0 && col < columns.length; col += dir) {
          const destination = columns[col];
          if (!destination || destination.tasks.length === 0) continue;
          const row = Math.min(pos.row, destination.tasks.length - 1);
          setSelectedId(destination.tasks[row]!.id);
          return;
        }
        return;
      }
      case "ArrowDown":
      case "j":
      case "ArrowUp":
      case "k": {
        e.preventDefault();
        const dir = e.key === "ArrowDown" || e.key === "j" ? 1 : -1;
        if (!pos) {
          selectFirst();
          return;
        }
        const column = columns[pos.col];
        if (!column) return;
        const row = Math.max(0, Math.min(column.tasks.length - 1, pos.row + dir));
        setSelectedId(column.tasks[row]!.id);
        return;
      }
      case "Enter": {
        if (!selectedId) return;
        e.preventDefault();
        onOpen(selectedId);
        return;
      }
      default:
        return;
    }
  };

  // Mouse and touch get their own constraints: a click (under 8px) still
  // opens the sheet, and a touch has to hold for a beat so scrolling the
  // columns is not a drag. No keyboard sensor — filing from the keyboard is
  // Shift+arrow, above.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    const from = e.active.data.current?.lifecycle as Lifecycle | undefined;
    if (!from) return;
    setLifted({ id, from });
    setSelectedId(id);
  };

  const onDragOver = (e: DragOverEvent) => {
    setOverStatus(e.over ? (e.over.id as Lifecycle) : null);
  };

  const settleDrag = () => {
    setLifted(null);
    setOverStatus(null);
    dragJustEnded.current = true;
    setTimeout(() => {
      dragJustEnded.current = false;
    }, 0);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const destination = e.over ? (e.over.id as Lifecycle) : null;
    if (destination) moveTask(String(e.active.id), destination);
    settleDrag();
  };

  const liftedTask = lifted ? tasks.find((t) => t.id === lifted.id) : undefined;
  const dropTarget = lifted && overStatus && overStatus !== lifted.from ? overStatus : null;

  const boardTop = useBoardTop(containerRef);

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Board"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={onContainerFocus}
      // Inline because the global `:focus-visible` outline is unlayered and
      // so outranks the `focus:outline-none` utility; a ring around the whole
      // board on mount autofocus is the one thing we never want here.
      style={{ "--board-top": `${boardTop}px`, outline: "none" } as React.CSSProperties}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={columnUnderPointer}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={settleDrag}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "To file this task in another column, press Shift with the Left or Right arrow key.",
          },
          announcements: {
            onDragStart: ({ active }) => `Picked up ${titleOf(tasks, active.id)}.`,
            onDragOver: ({ over }) =>
              over ? `Over ${statusLabel(over.id as Lifecycle)}.` : "Not over a column.",
            onDragEnd: ({ active, over }) =>
              over
                ? `Moved ${titleOf(tasks, active.id)} to ${statusLabel(over.id as Lifecycle)}.`
                : `Dropped ${titleOf(tasks, active.id)}.`,
            onDragCancel: ({ active }) => `Cancelled moving ${titleOf(tasks, active.id)}.`,
          },
        }}
      >
        <div
          className={cn(
            "flex items-start gap-3 overflow-x-auto overscroll-x-contain pb-2",
            "-mx-4 px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0",
          )}
        >
          {columns.map((column) => (
            <DroppableColumn
              key={column.status}
              column={column}
              isOver={dropTarget === column.status}
              previewDelta={
                dropTarget === null
                  ? 0
                  : column.status === dropTarget
                    ? 1
                    : column.status === lifted?.from
                      ? -1
                      : 0
              }
              onAdd={onAdd}
              renderCard={(task) => (
                <DraggableCard
                  key={task.id}
                  task={task}
                  lifecycle={column.status}
                  labels={labels}
                  selected={task.id === selectedId}
                  onSelect={setSelectedId}
                  onOpen={handleOpen}
                  onComplete={onComplete}
                  cardRef={setCardRef}
                />
              )}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {liftedTask ? <BoardCard task={liftedTask} labels={labels} lifted /> : null}
        </DragOverlay>
      </DndContext>

      {hasTasks ? <BoardHint /> : null}

      {undo ? (
        <div
          role="status"
          className={cn(
            "fixed left-1/2 z-40 -translate-x-1/2 animate-rise",
            "flex items-center gap-2 rounded-full border border-[var(--border)]",
            "bg-[var(--bg-elevated)]/95 backdrop-blur shadow-sm",
            "pl-3 pr-1.5 py-1 text-[12.5px] text-[var(--fg)]",
            stackAboveNotice ? "bottom-[136px] md:bottom-[56px]" : "bottom-[92px] md:bottom-4",
          )}
        >
          <StatusIcon status={undo.next} size={13} className="text-[var(--fg-muted)]" />
          <span>Moved to {statusLabel(undo.next)}</span>
          <button
            type="button"
            onClick={performUndo}
            className="ml-1 rounded-full px-1.5 py-0.5 font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]/60"
          >
            Undo
          </button>
          <Kbd className="hidden md:inline-flex">⌘Z</Kbd>
        </div>
      ) : null}
    </div>
  );
}

/** The column under the pointer wins; off the pointer, whatever the card overlaps most. */
const columnUnderPointer: CollisionDetection = (args) => {
  const under = pointerWithin(args);
  return under.length > 0 ? under : rectIntersection(args);
};

function titleOf(tasks: Task[], id: string | number): string {
  return tasks.find((t) => t.id === String(id))?.title ?? "task";
}

function matchesFocusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function DroppableColumn(props: Omit<React.ComponentProps<typeof BoardColumn>, "setDropRef">) {
  const { setNodeRef } = useDroppable({ id: props.column.status });
  return <BoardColumn {...props} setDropRef={setNodeRef} />;
}

function DraggableCard({
  task,
  lifecycle,
  cardRef,
  ...card
}: {
  task: Task;
  lifecycle: Lifecycle;
  cardRef: (id: string, el: HTMLDivElement | null) => void;
} & Omit<React.ComponentProps<typeof BoardCard>, "task" | "ghost" | "lifted">) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: task.id,
    data: { lifecycle },
  });
  const setRefs = React.useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      cardRef(task.id, el);
    },
    [setNodeRef, cardRef, task.id],
  );
  return <BoardCard ref={setRefs} task={task} ghost={isDragging} {...listeners} {...card} />;
}

function BoardHint() {
  return (
    <div className="mt-3 hidden items-center gap-1.5 text-[11.5px] text-[var(--fg-subtle)] md:flex">
      <Kbd>←</Kbd>
      <Kbd>→</Kbd>
      <span>to move</span>
      <span className="mx-1 opacity-60">·</span>
      <Kbd>⇧←</Kbd>
      <Kbd>⇧→</Kbd>
      <span>to file</span>
      <span className="mx-1 opacity-60">·</span>
      <Kbd>↵</Kbd>
      <span>to open</span>
    </div>
  );
}

/**
 * Columns scroll inside the viewport instead of growing the page. Their
 * max-height is `100dvh` minus where the board starts, which depends on
 * the header's wrapped height — so measure it rather than guess.
 */
function useBoardTop(ref: React.RefObject<HTMLElement | null>): number {
  const [top, setTop] = React.useState(260);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref]);
  return top;
}

const SKELETON_ROWS = ["a", "b", "c"] as const;

export function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden -mx-4 px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0">
      {STATUS_VIEWS.map((view, i) => (
        <div
          key={view.status}
          className="flex w-[288px] shrink-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-sunken)]/70 p-2 md:w-auto md:flex-1 md:basis-0 md:min-w-[188px] md:shrink"
          style={{ minHeight: EMPTY_DROP_AREA_PX + 40 }}
        >
          <div className="flex items-center gap-2 px-1 pt-0.5 pb-1">
            <Skeleton className="size-3.5 rounded" />
            <Skeleton className="h-3 w-14" />
          </div>
          {SKELETON_ROWS.slice(0, (i % 3) + 1).map((row) => (
            <div
              key={row}
              className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
            >
              <Skeleton className="h-3 w-[80%] mb-1.5" />
              <Skeleton className="h-2.5 w-[55%] mb-2.5" />
              <Skeleton className="h-4 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

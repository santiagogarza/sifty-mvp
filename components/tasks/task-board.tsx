"use client";

import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { BOARD_STATUSES, selectBoardColumns } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  type Announcements,
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
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { BoardCard, BoardCardOverlay } from "./board-card";
import { type NavDirection, adjacentStatus, locate, navigate } from "./board-navigation";
import { MoveUndoToast } from "./move-undo-toast";
import { STATUS_ICONS } from "./status-icon";

/**
 * Board view: one column per status, in the sidebar's order, words and
 * icons. A card changes status by dragging it to another column, or with
 * ⇧←/⇧→ on the keyboard. The column is the drop target — there is no
 * manual card order, so cards land wherever their column's list sort puts
 * them.
 *
 * Every move goes through `updateTask` (optimistic, synced in the
 * background, replayed from the dirty ledger) and stays undoable for a few
 * seconds via the pill or ⌘Z.
 *
 * Drag notes: mouse drags need a few px of travel so a click still opens
 * the card; touch drags need a long-press so a swipe scrolls the columns.
 */

/** Done grows forever; keep its column skimmable. */
const DONE_VISIBLE = 25;

const COLUMN_SIZE = cn(
  "w-[288px] shrink-0 snap-start",
  "md:w-auto md:min-w-[194px] md:flex-1 md:basis-0 md:snap-align-none",
);

const ARROW_KEYS: Record<string, NavDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  k: "up",
  j: "down",
};

interface Move {
  key: number;
  taskId: string;
  title: string;
  from: Lifecycle;
  to: Lifecycle;
}

// Inside a column the pointer decides; in the gap between columns, fall
// back to whichever column the dragged card overlaps most.
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

export function TaskBoard({
  onOpen,
  onAdd,
  liftToast = false,
}: {
  onOpen: (id: string) => void;
  /** Capture straight into a column. Omitted for Done. */
  onAdd: (status: Lifecycle) => void;
  /** The offline notice is showing; stack the undo pill above it. */
  liftToast?: boolean;
}) {
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);

  const [showAllDone, setShowAllDone] = React.useState(false);
  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);
  // What is actually rendered — the keyboard can only land on these.
  const visibleColumns = React.useMemo(
    () =>
      columns.map((c) =>
        c.status === "done" && !showAllDone ? { ...c, tasks: c.tasks.slice(0, DONE_VISIBLE) } : c,
      ),
    [columns, showAllDone],
  );
  const labelsById = React.useMemo(
    () => new Map<string, Label>(labels.map((l) => [l.id, l])),
    [labels],
  );
  const isEmpty = columns.every((c) => c.tasks.length === 0);

  const boardRef = React.useRef<HTMLDivElement>(null);
  const cardNodes = React.useRef(new Map<string, HTMLElement>());
  const registerNode = React.useCallback((id: string, node: HTMLElement | null) => {
    if (node) cardNodes.current.set(id, node);
    else cardNodes.current.delete(id);
  }, []);

  // Selection is a task id, so it follows a card across columns. It is
  // only drawn while the keyboard is driving; a click just remembers it.
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectionVisible, setSelectionVisible] = React.useState(false);
  const focusPending = React.useRef(false);
  const pointerDriving = React.useRef(false);

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overStatus, setOverStatus] = React.useState<Lifecycle | null>(null);
  const suppressClickUntil = React.useRef(0);

  const [lastMove, setLastMove] = React.useState<Move | null>(null);
  const moveSeq = React.useRef(0);
  const [settlingId, setSettlingId] = React.useState<string | null>(null);
  const [pulses, setPulses] = React.useState<Partial<Record<Lifecycle, number>>>({});
  const [announcement, setAnnouncement] = React.useState("");
  /** Status each card had before it was completed here, for unchecking. */
  const completedFrom = React.useRef(new Map<string, Lifecycle>());

  // Roving tabindex: the selected card is the board's tab stop when it is
  // rendered; otherwise the board container is.
  const tabStopId = locate(visibleColumns, selectedId) ? selectedId : null;

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : undefined;
  const activeFrom = activeTask?.lifecycle ?? null;
  const dropTarget = overStatus && overStatus !== activeFrom ? overStatus : null;
  const countDelta = (status: Lifecycle) =>
    !dropTarget ? 0 : status === dropTarget ? 1 : status === activeFrom ? -1 : 0;

  const land = React.useCallback((taskId: string, status: Lifecycle) => {
    setSettlingId(taskId);
    setPulses((p) => ({ ...p, [status]: (p[status] ?? 0) + 1 }));
  }, []);

  React.useEffect(() => {
    if (!settlingId) return;
    const t = setTimeout(() => setSettlingId(null), 1200);
    return () => clearTimeout(t);
  }, [settlingId]);

  const move = React.useCallback(
    (taskId: string, to: Lifecycle): boolean => {
      const store = useStore.getState();
      const task = store.tasks.find((t) => t.id === taskId);
      if (!task || task.lifecycle === to) return false;
      const from = task.lifecycle;
      if (to === "done") completedFrom.current.set(taskId, from);
      store.updateTask(taskId, { lifecycle: to });
      moveSeq.current += 1;
      setLastMove({ key: moveSeq.current, taskId, title: task.title, from, to });
      land(taskId, to);
      setAnnouncement(`${task.title} moved to ${statusLabel(to)}. Press Command Z to undo.`);
      return true;
    },
    [land],
  );

  const undo = React.useCallback(() => {
    if (!lastMove) return;
    setLastMove(null);
    const store = useStore.getState();
    const task = store.tasks.find((t) => t.id === lastMove.taskId);
    // Moved again elsewhere (or deleted) since: the undo is stale.
    if (!task || task.lifecycle !== lastMove.to) return;
    store.updateTask(lastMove.taskId, { lifecycle: lastMove.from });
    land(lastMove.taskId, lastMove.from);
    setSelectedId(lastMove.taskId);
    focusPending.current = true;
    setAnnouncement(`${lastMove.title} moved back to ${statusLabel(lastMove.from)}.`);
  }, [lastMove, land]);

  const toggleComplete = React.useCallback(
    (task: Task) => {
      if (task.lifecycle === "done") {
        move(task.id, completedFrom.current.get(task.id) ?? "active");
      } else {
        move(task.id, "done");
      }
    },
    [move],
  );

  const openCard = React.useCallback(
    (id: string) => {
      if (Date.now() < suppressClickUntil.current) return;
      onOpen(id);
    },
    [onOpen],
  );

  const onFocusCard = React.useCallback((id: string) => {
    setSelectedId(id);
    if (!pointerDriving.current) setSelectionVisible(true);
  }, []);

  // Focus follows the selection — into a new column after a move, too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: columns re-render the moved card's node.
  React.useEffect(() => {
    if (!focusPending.current || !selectedId) return;
    const node = cardNodes.current.get(selectedId);
    if (!node) return;
    focusPending.current = false;
    node.focus({ preventScroll: true });
    node.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId, columns]);

  // Like the list, take focus on arrival so the arrow keys work at once.
  const didAutoFocus = React.useRef(false);
  React.useEffect(() => {
    if (didAutoFocus.current || isEmpty) return;
    didAutoFocus.current = true;
    boardRef.current?.focus({ preventScroll: true });
  }, [isEmpty]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || isEditable(e.target)) return;
    pointerDriving.current = false;

    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z") {
      if (lastMove) {
        e.preventDefault();
        undo();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const task = selectedId ? tasks.find((t) => t.id === selectedId) : undefined;
      if (!task) return;
      const to = adjacentStatus(
        BOARD_STATUSES,
        task.lifecycle,
        e.key === "ArrowLeft" ? "left" : "right",
      );
      if (to && move(task.id, to)) {
        setSelectionVisible(true);
        focusPending.current = true;
      }
      return;
    }

    const direction = e.shiftKey ? undefined : ARROW_KEYS[e.key];
    if (direction) {
      e.preventDefault();
      const next = navigate(visibleColumns, selectedId, direction);
      if (next) {
        setSelectedId(next);
        setSelectionVisible(true);
        focusPending.current = true;
      }
      return;
    }

    const onCard = e.target instanceof HTMLElement && e.target.dataset.taskId !== undefined;
    if ((e.key === "Enter" || e.key === " ") && onCard && selectedId) {
      e.preventDefault();
      onOpen(selectedId);
      return;
    }

    if (e.key === "Escape" && selectedId) {
      setSelectedId(null);
      setSelectionVisible(false);
      boardRef.current?.focus({ preventScroll: true });
    }
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const titleOf = (id: string | number) => tasks.find((t) => t.id === id)?.title ?? "Task";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ over }) =>
      over ? `Over ${statusLabel(over.id as Lifecycle)}.` : "Not over a column.",
    // A real move is announced by the board's live region, with the undo hint.
    onDragEnd: ({ active, over }) =>
      over && over.id !== active.data.current?.status
        ? undefined
        : `${titleOf(active.id)} stays where it was.`,
    onDragCancel: ({ active }) => `Cancelled. ${titleOf(active.id)} stays where it was.`,
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setOverStatus(null);
    setSelectionVisible(false);
  };

  const onDragOver = ({ over }: DragOverEvent) => {
    setOverStatus(over ? (over.id as Lifecycle) : null);
  };

  const endDrag = () => {
    setActiveId(null);
    setOverStatus(null);
    // The mouseup can land on the card's own slot and fire a click.
    suppressClickUntil.current = Date.now() + 250;
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    endDrag();
    const id = String(active.id);
    if (over) move(id, over.id as Lifecycle);
    // Keep focus on the card so ⌘Z and the arrows pick up from here.
    setSelectedId(id);
    focusPending.current = true;
  };

  return (
    <DndContext
      id="task-board"
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Press Shift and the Left or Right arrow to move this task to the next status. " +
            "Use the arrow keys to move between tasks, and Enter to open one.",
        },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={endDrag}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          ref={boardRef}
          role="group"
          aria-label="Board"
          tabIndex={tabStopId ? -1 : 0}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            pointerDriving.current = true;
            setSelectionVisible(false);
            if (e.target === e.currentTarget) boardRef.current?.focus({ preventScroll: true });
          }}
          className={cn(
            "flex min-h-0 flex-1 gap-2 overflow-x-auto px-4 pb-1 sm:px-6 md:px-8",
            "snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 md:snap-none",
            "!outline-none",
          )}
        >
          {columns.map((column, i) => (
            <BoardColumnView
              key={column.status}
              status={column.status}
              total={column.tasks.length}
              tasks={visibleColumns[i]!.tasks}
              onShowAll={() => setShowAllDone(true)}
              countDelta={countDelta(column.status)}
              isDropTarget={dropTarget === column.status}
              pulseKey={pulses[column.status] ?? 0}
              onAdd={column.status === "done" ? undefined : onAdd}
            >
              {(task) => (
                <BoardCard
                  key={task.id}
                  task={task}
                  labelsById={labelsById}
                  selected={selectionVisible && selectedId === task.id}
                  tabbable={tabStopId === task.id}
                  settling={settlingId === task.id}
                  onOpen={openCard}
                  onFocusCard={onFocusCard}
                  onToggleComplete={toggleComplete}
                  registerNode={registerNode}
                />
              )}
            </BoardColumnView>
          ))}
        </div>

        {/* The undo pill takes this strip while it shows; both teach ⌘Z. */}
        {isEmpty ? null : <BoardKeyboardHint hidden={!!lastMove} />}

        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
      </div>

      {createPortal(
        <DragOverlay dropAnimation={null}>
          {activeTask ? <BoardCardOverlay task={activeTask} labelsById={labelsById} /> : null}
        </DragOverlay>,
        document.body,
      )}

      {lastMove ? (
        <MoveUndoToast
          moveKey={lastMove.key}
          to={lastMove.to}
          lifted={liftToast}
          onUndo={undo}
          onExpire={() => setLastMove(null)}
        />
      ) : null}
    </DndContext>
  );
}

function BoardColumnView({
  status,
  total,
  tasks,
  onShowAll,
  countDelta,
  isDropTarget,
  pulseKey,
  onAdd,
  children,
}: {
  status: Lifecycle;
  /** Every task in this status, including any not rendered yet. */
  total: number;
  /** The tasks to render. */
  tasks: Task[];
  onShowAll: () => void;
  /** Mid-drag preview of the count after the drop: +1 target, −1 source. */
  countDelta: number;
  isDropTarget: boolean;
  /** Bumped when a move lands here; remounting the count replays the pulse. */
  pulseKey: number;
  onAdd?: (status: Lifecycle) => void;
  children: (task: Task) => React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: status });

  const label = statusLabel(status);
  const Icon = STATUS_ICONS[status];
  const count = total + countDelta;
  const hidden = total - tasks.length;

  return (
    <section
      ref={setNodeRef}
      data-status={status}
      className={cn(
        COLUMN_SIZE,
        "flex min-h-0 flex-col rounded-[var(--radius-lg)] border bg-[var(--surface-muted)]",
        "transition-[background-color,border-color] duration-[120ms] ease-[var(--ease-soft)]",
        isDropTarget &&
          "!border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent-soft)_35%,var(--surface-muted))]",
      )}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-2.5">
        <Icon size={14} className="shrink-0 text-[var(--fg-muted)]" />
        <h2 className="truncate text-[13px] font-medium tracking-[-0.005em] text-[var(--fg)]">
          {label}
        </h2>
        <span
          key={pulseKey}
          className={cn(
            "text-num text-[11.5px] text-[var(--fg-subtle)]",
            pulseKey > 0 && "animate-count-pulse",
          )}
        >
          {count}
        </span>
      </header>

      <ul
        aria-label={`${label}, ${count} ${count === 1 ? "task" : "tasks"}`}
        className={cn(
          "flex min-h-[88px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2",
          "[scrollbar-width:thin]",
        )}
      >
        {tasks.map((task) => (
          <li key={task.id}>{children(task)}</li>
        ))}
        {hidden > 0 ? (
          <li>
            <button
              type="button"
              onClick={onShowAll}
              className="w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12px] text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-muted)]"
            >
              Show {hidden} older
            </button>
          </li>
        ) : null}
      </ul>

      {onAdd ? (
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={() => onAdd(status)}
            aria-label={`Add a task to ${label}`}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5",
              "text-[12.5px] text-[var(--fg-subtle)]",
              "transition-colors duration-150 ease-[var(--ease-product)]",
              "hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
            )}
          >
            <Plus size={13} />
            Add
          </button>
        </div>
      ) : null}
    </section>
  );
}

function BoardKeyboardHint({ hidden }: { hidden: boolean }) {
  return (
    <div
      aria-hidden={hidden || undefined}
      className={cn(
        "hidden items-center gap-4 px-8 pt-3 text-[11.5px] text-[var(--fg-subtle)] md:flex",
        "transition-opacity duration-200 ease-[var(--ease-soft)]",
        hidden && "opacity-0",
      )}
    >
      <span className="flex items-center gap-1">
        <Kbd>←</Kbd>
        <Kbd>→</Kbd>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        <span className="ml-1">to select</span>
      </span>
      <span className="flex items-center gap-1">
        <Kbd>⇧</Kbd>
        <Kbd>←</Kbd>
        <Kbd>→</Kbd>
        <span className="ml-1">to move</span>
      </span>
      <span className="flex items-center gap-1">
        <Kbd>↵</Kbd>
        <span className="ml-1">to open</span>
      </span>
      <span className="flex items-center gap-1">
        <Kbd>⌘</Kbd>
        <Kbd>Z</Kbd>
        <span className="ml-1">to undo</span>
      </span>
    </div>
  );
}

/** Columns-shaped placeholder until the local store has rehydrated. */
export function TaskBoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-2 overflow-hidden px-4 pb-1 sm:px-6 md:px-8">
      {BOARD_STATUSES.map((status, i) => (
        <div
          key={status}
          className={cn(
            COLUMN_SIZE,
            "flex flex-col gap-2 rounded-[var(--radius-lg)] border bg-[var(--surface-muted)] p-2",
          )}
        >
          <Skeleton className="mx-1 my-1 h-3.5 w-20" />
          {Array.from({ length: 3 - (i % 2) }, (_, n) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
              key={n}
              className="rounded-[var(--radius-md)] border bg-[var(--surface)] p-3"
            >
              <Skeleton className="mb-1.5 h-3.5 w-[80%]" />
              <Skeleton className="h-3 w-[55%]" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable ||
    target.getAttribute("role") === "textbox"
  );
}

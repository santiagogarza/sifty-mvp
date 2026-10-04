"use client";

import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import { statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import {
  BOARD_LIFECYCLES,
  type BoardColumn,
  type BoardLifecycle,
  type BoardViewArgs,
  selectBoardColumns,
} from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
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
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Check, Plus } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";
import { StatusIcon } from "./status-icon";

/**
 * Kanban over the same tasks and the same `lifecycle` field.
 *
 * There is no manual card order, so the column — not a gap between cards —
 * is the drop target. A drop writes through `setLifecycle`, the same path
 * as the Status picker, and a quiet pill offers undo for a few seconds.
 * Reversibility is what makes the drag feel physical instead of final.
 */

/** History stays skimmable; the rest of Done lives behind "+N more". */
const DONE_VISIBLE_LIMIT = 50;
const UNDO_MS = 6000;

/**
 * Break out of the 820px reading column: sized against the <main> container
 * (100cqw), capped for very wide screens. Shared with the board-mode header
 * so its text lines up with the first column.
 */
export const BOARD_BREAKOUT_CLASS = "w-[min(1360px,100cqw)] ml-[calc(50%-min(1360px,100cqw)/2)]";
export const BOARD_GUTTER_CLASS = "px-4 sm:px-6 md:px-8";

const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

interface UndoMove {
  taskId: string;
  from: Lifecycle;
  to: BoardLifecycle;
}

export function TaskBoard({
  onOpen,
  onCapture,
  lens,
}: {
  onOpen: (id: string) => void;
  /** Column Add row. Receives the column the row belongs to. */
  onCapture: (lifecycle: BoardLifecycle) => void;
  lens?: BoardViewArgs["lens"];
}) {
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);

  const columns = React.useMemo(
    () => selectBoardColumns(tasks, lens ? { lens } : {}, new Date()),
    [tasks, lens],
  );
  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const ghosts = useColumnGhosts(columns);

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [settledId, setSettledId] = React.useState<string | null>(null);
  const [undo, setUndo] = React.useState<UndoMove | null>(null);
  const [focusNonce, setFocusNonce] = React.useState(0);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const suppressClick = React.useRef(false);

  const activeTask = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;
  const hasTasks = columns.some((column) => column.tasks.length > 0);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const recordMove = React.useCallback((move: UndoMove) => {
    setUndo(move);
    setSettledId(move.taskId);
    setSelectedId(move.taskId);
    // The card unmounts from the old column, so bump focus even when the
    // selection id itself does not change.
    setFocusNonce((nonce) => nonce + 1);
  }, []);

  const moveTask = React.useCallback(
    (taskId: string, to: BoardLifecycle) => {
      const task = useStore.getState().tasks.find((t) => t.id === taskId);
      if (!task || task.lifecycle === to) return;
      const from = task.lifecycle;
      setLifecycle(taskId, to);
      recordMove({ taskId, from, to });
    },
    [recordMove, setLifecycle],
  );

  const undoMove = React.useCallback(() => {
    if (!undo) return;
    setLifecycle(undo.taskId, undo.from);
    setSelectedId(undo.taskId);
    setUndo(null);
  }, [setLifecycle, undo]);

  React.useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  React.useEffect(() => {
    if (!settledId) return;
    const timer = setTimeout(() => setSettledId(null), 1300);
    return () => clearTimeout(timer);
  }, [settledId]);

  React.useEffect(() => {
    if (!undo) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      undoMove();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, undoMove]);

  React.useEffect(() => {
    if (!selectedId) return;
    // focusNonce changes when a card is filed. The id stays the same, but
    // the node is new — without this, Enter after a keyboard file does nothing.
    if (focusNonce < 0) return;
    cardRefs.current.get(selectedId)?.focus({ preventScroll: false });
  }, [focusNonce, selectedId]);

  const onDragStart = (e: DragStartEvent) => {
    suppressClick.current = true;
    setActiveId(String(e.active.id));
  };

  const releaseClick = () => {
    // A drag ends with a click the browser still emits. Swallow that one,
    // then arm the next real click — otherwise a missed click event would
    // eat the following open.
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    releaseClick();
    const target = e.over?.id;
    if (typeof target !== "string" || !isBoardLifecycle(target)) return;
    moveTask(String(e.active.id), target);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const position = selectedId ? findCard(columns, selectedId) : null;
    const focusedId = cardIdFromTarget(e.target);

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      if (e.shiftKey) {
        const id = focusedId ?? position?.task.id;
        const located = id ? findCard(columns, id) : null;
        if (!located) {
          selectFirst(columns, setSelectedId);
          return;
        }
        const target = columns[located.column + delta];
        if (!target) return;
        moveTask(located.task.id, target.lifecycle);
        return;
      }
      if (!position) {
        selectFirst(columns, setSelectedId);
        return;
      }
      const column = columns[position.column + delta];
      if (!column || column.tasks.length === 0) return;
      const row = Math.min(position.row, column.tasks.length - 1);
      setSelectedId(column.tasks[row]?.id ?? null);
      return;
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "j" || e.key === "k") {
      e.preventDefault();
      if (!position) {
        selectFirst(columns, setSelectedId);
        return;
      }
      const delta = e.key === "ArrowDown" || e.key === "j" ? 1 : -1;
      const column = columns[position.column];
      if (!column) return;
      const row = Math.min(column.tasks.length - 1, Math.max(0, position.row + delta));
      setSelectedId(column.tasks[row]?.id ?? null);
      return;
    }

    if (e.key === "Enter") {
      const id = focusedId ?? position?.task.id;
      if (!id) return;
      e.preventDefault();
      onOpen(id);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      // A phone column only peeks by ~60px. The default 20% edge zone is
      // wider than that peek, so a drop on the next column scrolls it away.
      autoScroll={{ threshold: { x: 0.06, y: 0.2 } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        releaseClick();
      }}
    >
      <div
        ref={boardRef}
        data-testid="task-board"
        role="listbox"
        aria-label="Task board"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="select-none outline-none"
      >
        <div
          data-testid="board-columns"
          className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory md:snap-proximity"
        >
          {columns.map((column) => (
            <BoardColumnView
              key={column.lifecycle}
              column={column}
              labelMap={labelMap}
              ghosts={ghosts.get(column.lifecycle) ?? []}
              onOpen={onOpen}
              onCapture={onCapture}
              onComplete={(task) =>
                moveTask(task.id, task.lifecycle === "done" ? "active" : "done")
              }
              selectedId={selectedId}
              settledId={settledId}
              draggingFrom={activeTask?.lifecycle ?? null}
              cardRef={(id, el) => {
                if (el) cardRefs.current.set(id, el);
                else cardRefs.current.delete(id);
              }}
              onCardClick={(id) => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                onOpen(id);
              }}
            />
          ))}
        </div>
        {hasTasks ? <BoardKeyboardHint /> : null}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.32, 0.72, 0.18, 1)" }}>
        {activeTask ? <BoardCardContent task={activeTask} labelMap={labelMap} overlay /> : null}
      </DragOverlay>
      {undo ? <MoveUndoPill to={undo.to} onUndo={undoMove} /> : null}
    </DndContext>
  );
}

function isBoardLifecycle(value: string): value is BoardLifecycle {
  return (BOARD_LIFECYCLES as readonly string[]).includes(value);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function cardIdFromTarget(target: EventTarget): string | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest("[data-task-id]")?.getAttribute("data-task-id") ?? null;
}

function findCard(
  columns: BoardColumn[],
  id: string,
): { column: number; row: number; task: Task } | null {
  for (let column = 0; column < columns.length; column++) {
    const row = columns[column]?.tasks.findIndex((task) => task.id === id) ?? -1;
    const task = row >= 0 ? columns[column]?.tasks[row] : undefined;
    if (task) return { column, row, task };
  }
  return null;
}

function selectFirst(columns: BoardColumn[], setSelectedId: (id: string) => void) {
  for (const column of columns) {
    const first = column.tasks[0];
    if (first) {
      setSelectedId(first.id);
      return;
    }
  }
}

function BoardColumnView({
  column,
  labelMap,
  ghosts,
  onOpen,
  onCapture,
  onComplete,
  selectedId,
  settledId,
  draggingFrom,
  cardRef,
  onCardClick,
}: {
  column: BoardColumn;
  labelMap: Map<string, Label>;
  ghosts: Task[];
  onOpen: (id: string) => void;
  onCapture: (lifecycle: BoardLifecycle) => void;
  onComplete: (task: Task) => void;
  selectedId: string | null;
  settledId: string | null;
  draggingFrom: Lifecycle | null;
  cardRef: (id: string, el: HTMLDivElement | null) => void;
  onCardClick: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.lifecycle });
  const isTarget = isOver && draggingFrom !== null && draggingFrom !== column.lifecycle;
  const visible =
    column.lifecycle === "done" ? column.tasks.slice(0, DONE_VISIBLE_LIMIT) : column.tasks;
  const hidden = column.tasks.length - visible.length;
  const displayCount = isTarget ? column.tasks.length + 1 : column.tasks.length;

  return (
    <section
      ref={setNodeRef}
      data-column={column.lifecycle}
      aria-label={`${statusLabel(column.lifecycle)} column`}
      className={cn(
        "flex w-[288px] min-w-[288px] snap-start flex-col self-start",
        "md:w-auto md:min-w-[194px] md:flex-1",
        "max-h-[calc(100dvh-16rem)] rounded-[var(--radius-lg)] border p-2",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        isTarget
          ? "border-[var(--accent)] bg-[var(--accent-soft)]/35"
          : "border-[var(--border)] bg-[var(--surface-muted)]",
      )}
    >
      <header className="flex items-center gap-2 px-1 py-0.5">
        <StatusIcon status={column.lifecycle} size={16} className="text-[var(--fg-muted)]" />
        <span className="text-[13px] font-medium leading-[18px] text-[var(--fg)]">
          {statusLabel(column.lifecycle)}
        </span>
        <ColumnCount count={column.tasks.length} display={displayCount} />
      </header>

      <div className="mt-2 flex min-h-[88px] flex-1 flex-col gap-2 overflow-y-auto">
        {visible.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            labelMap={labelMap}
            selected={task.id === selectedId}
            settled={task.id === settledId}
            onOpen={onOpen}
            onClick={() => onCardClick(task.id)}
            onComplete={() => onComplete(task)}
            cardRef={cardRef}
          />
        ))}
        {ghosts.map((task) => (
          <div key={`ghost-${task.id}`} className="ghost-collapse">
            <div>
              <BoardCardContent task={task} labelMap={labelMap} />
            </div>
          </div>
        ))}
        {visible.length === 0 && ghosts.length === 0 ? (
          draggingFrom ? (
            <div className="h-[88px] rounded-[var(--radius-md)] border border-dashed border-[var(--accent)] bg-[var(--accent-soft)]/35" />
          ) : (
            <div className="h-[88px]" />
          )
        ) : null}
        {hidden > 0 ? (
          <div className="px-1 py-0.5 text-[12px] text-[var(--fg-subtle)]">+{hidden} more</div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onCapture(column.lifecycle)}
        aria-label={`Add a task to ${statusLabel(column.lifecycle)}`}
        className="mt-2 flex items-center gap-1 px-1 py-0.5 text-[12px] leading-[16px] text-[var(--fg-subtle)] hover:text-[var(--fg-muted)]"
      >
        <Plus size={12} />
        Add
      </button>
    </section>
  );
}

function ColumnCount({ count, display }: { count: number; display: number }) {
  const prevRef = React.useRef<number | null>(null);
  const [pulseKey, setPulseKey] = React.useState(0);

  React.useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = count;
    if (prev !== null && count > prev) setPulseKey((key) => key + 1);
  }, [count]);

  return (
    <span
      key={pulseKey}
      className={cn(
        "text-num text-[12px] leading-[16px] text-[var(--fg-subtle)]",
        pulseKey > 0 && "animate-count-pulse",
      )}
    >
      {display}
    </span>
  );
}

function BoardCard({
  task,
  labelMap,
  selected,
  settled,
  onOpen,
  onClick,
  onComplete,
  cardRef,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  selected: boolean;
  settled: boolean;
  onOpen: (id: string) => void;
  onClick: () => void;
  onComplete: () => void;
  cardRef: (id: string, el: HTMLDivElement | null) => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: task.id });

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        cardRef(task.id, el);
      }}
      {...listeners}
      {...attributes}
      role="option"
      aria-selected={selected}
      data-task-id={task.id}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          onOpen(task.id);
        }
      }}
      className={cn("touch-manipulation outline-none", isDragging && "cursor-grabbing")}
    >
      {isDragging ? (
        <div className="h-[88px] rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)]" />
      ) : (
        <BoardCardContent
          task={task}
          labelMap={labelMap}
          selected={selected}
          settled={settled}
          onComplete={onComplete}
        />
      )}
    </div>
  );
}

function BoardCardContent({
  task,
  labelMap,
  selected,
  settled,
  overlay,
  onComplete,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  selected?: boolean;
  settled?: boolean;
  overlay?: boolean;
  onComplete?: () => void;
}) {
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];
  const dueLabel = formatRelativeDay(task.due);
  const overdue = isOverdue(task.due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";
  const isDone = task.lifecycle === "done";
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const extraBadge = assignee
    ? { key: "assignee", label: assignee, tone: "neutral" as const }
    : taskLabels[0]
      ? { key: taskLabels[0].id, label: taskLabels[0].name, tone: taskLabels[0].tone }
      : null;
  const showAi = task.aiStatus === "pending" || task.aiStatus === "running";

  return (
    <div
      className={cn(
        "group/card flex flex-col gap-2 rounded-[var(--radius-md)] border bg-[var(--surface)] p-3",
        "cursor-grab transition-shadow duration-150 ease-[var(--ease-product)]",
        overlay && "border-[var(--accent)] shadow-[0_8px_24px_-6px_rgba(0,0,0,0.5)]",
        !overlay && selected && "border-[var(--accent)]",
        !overlay &&
          !selected &&
          "border-[var(--border)] hover:border-[var(--border-strong)] hover:shadow-[0_1px_2px_rgba(0,0,0,0.18)]",
        settled && "animate-fill-in",
      )}
    >
      <div className="min-w-0">
        <p
          className={cn(
            "line-clamp-2 text-[13px] leading-[18px] tracking-[-0.005em]",
            isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </p>
        {task.nextAction && !isDone ? (
          <p className="mt-0.5 truncate text-[12px] leading-[16px] text-[var(--fg-muted)]">
            {task.nextAction}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CompleteSlot done={isDone} onComplete={onComplete} bucket={task.priorityBucket} />
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
        {extraBadge ? <Badge tone={extraBadge.tone}>{extraBadge.label}</Badge> : null}
        {showAi ? <AiStatusInline status={task.aiStatus} /> : null}
      </div>
    </div>
  );
}

/**
 * One 16px slot. The glyph sits there at rest; the complete circle replaces
 * it on hover so revealing the control never reflows the card. Done keeps
 * the filled circle — the same shape the list uses for a finished task.
 */
function CompleteSlot({
  done,
  bucket,
  onComplete,
}: {
  done: boolean;
  bucket: Task["priorityBucket"];
  onComplete?: () => void;
}) {
  if (!onComplete) {
    return done ? <DoneCheck /> : <PriorityGlyph bucket={bucket} />;
  }
  if (done) {
    return (
      <button
        type="button"
        aria-label="Mark as not done"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onComplete();
        }}
        className="flex size-4 items-center justify-center rounded-full border border-[var(--done)] bg-[var(--done)]"
      >
        <Check size={9} className="text-white" strokeWidth={3} />
      </button>
    );
  }
  return (
    <span className="relative size-4 shrink-0">
      <span className="absolute inset-0 flex items-center justify-center group-hover/card:opacity-0 group-focus-within/card:opacity-0">
        <PriorityGlyph bucket={bucket} />
      </span>
      <button
        type="button"
        aria-label="Mark as done"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onComplete();
        }}
        className={cn(
          "absolute inset-0 size-4 rounded-full border border-[var(--border-strong)] bg-[var(--surface-muted)]",
          "opacity-0 pointer-events-none",
          "group-hover/card:opacity-100 group-hover/card:pointer-events-auto",
          "group-focus-within/card:opacity-100 group-focus-within/card:pointer-events-auto",
          "hover:border-[var(--accent)]",
        )}
      />
    </span>
  );
}

function DoneCheck() {
  return (
    <span className="flex size-4 items-center justify-center rounded-full border border-[var(--done)] bg-[var(--done)]">
      <Check size={9} className="text-white" strokeWidth={3} />
    </span>
  );
}

function BoardKeyboardHint() {
  return (
    <div className="mt-3 hidden items-center gap-1 md:flex" data-testid="board-keyboard-hint">
      <Kbd>←</Kbd>
      <Kbd>→</Kbd>
      <span className="text-[11px] font-medium leading-[14px] text-[var(--fg-muted)]">to move</span>
      <span className="text-[11px] font-medium leading-[14px] text-[var(--fg-subtle)]">·</span>
      <Kbd>⇧←</Kbd>
      <Kbd>⇧→</Kbd>
      <span className="text-[11px] font-medium leading-[14px] text-[var(--fg-muted)]">to file</span>
      <span className="text-[11px] font-medium leading-[14px] text-[var(--fg-subtle)]">·</span>
      <Kbd>↵</Kbd>
      <span className="text-[11px] font-medium leading-[14px] text-[var(--fg-muted)]">to open</span>
    </div>
  );
}

function MoveUndoPill({ to, onUndo }: { to: BoardLifecycle; onUndo: () => void }) {
  return (
    <div
      role="status"
      className="fixed bottom-[92px] md:bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] py-1.5 pl-3 pr-2 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.35)]"
    >
      <StatusIcon status={to} size={12} className="text-[var(--fg-muted)]" />
      <span className="text-[12px] leading-[16px] text-[var(--fg)]">
        Moved to {statusLabel(to)}
      </span>
      <button
        type="button"
        onClick={onUndo}
        className="inline-flex items-center gap-1 pl-1 text-[11px] font-medium leading-[14px] text-[var(--accent)]"
      >
        Undo
        <Kbd>⌘Z</Kbd>
      </button>
    </div>
  );
}

interface ColumnGhost {
  task: Task;
  lifecycle: BoardLifecycle;
}

/**
 * A card that a lens just filtered out (Today → Someday, for instance)
 * lingers in the destination column for one collapse, so the drop reads as
 * a landing rather than a disappearance.
 */
function useColumnGhosts(columns: BoardColumn[]): Map<BoardLifecycle, Task[]> {
  const [ghosts, setGhosts] = React.useState<ReadonlyMap<string, ColumnGhost>>(new Map());
  const prevIds = React.useRef<Set<string> | null>(null);

  const dismiss = React.useCallback((id: string) => {
    setGhosts((old) => {
      if (!old.has(id)) return old;
      const next = new Map(old);
      next.delete(id);
      return next;
    });
  }, []);

  React.useLayoutEffect(() => {
    const ids = new Set(columns.flatMap((column) => column.tasks.map((task) => task.id)));
    const prev = prevIds.current;
    prevIds.current = ids;
    if (!prev) return;

    const additions: ColumnGhost[] = [];
    const storeTasks = useStore.getState().tasks;
    for (const id of prev) {
      if (ids.has(id)) continue;
      const live = storeTasks.find((task) => task.id === id);
      if (!live || !isBoardLifecycle(live.lifecycle)) continue;
      additions.push({ task: live, lifecycle: live.lifecycle });
    }
    if (additions.length === 0) return;
    setGhosts((old) => {
      const next = new Map(old);
      for (const ghost of additions) next.set(ghost.task.id, ghost);
      return next;
    });
  }, [columns]);

  React.useEffect(() => {
    if (ghosts.size === 0) return;
    const visible = new Set(columns.flatMap((column) => column.tasks.map((task) => task.id)));
    for (const id of ghosts.keys()) {
      if (visible.has(id)) dismiss(id);
    }
  }, [columns, dismiss, ghosts]);

  React.useEffect(() => {
    if (ghosts.size === 0) return;
    const timers = [...ghosts.keys()].map((id) => setTimeout(() => dismiss(id), 4000));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [dismiss, ghosts]);

  return React.useMemo(() => {
    const byColumn = new Map<BoardLifecycle, Task[]>();
    for (const ghost of ghosts.values()) {
      const list = byColumn.get(ghost.lifecycle) ?? [];
      list.push(ghost.task);
      byColumn.set(ghost.lifecycle, list);
    }
    return byColumn;
  }, [ghosts]);
}

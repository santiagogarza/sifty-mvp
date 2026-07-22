"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BOARD_LIFECYCLES,
  type BoardLifecycle,
  isBoardLifecycle,
  lifecycleLabel,
} from "@/lib/domain/lifecycle";
import type { Label, Task } from "@/lib/domain/types";
import { selectBoardColumns } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  type ScreenReaderInstructions,
  TouchSensor,
  type UniqueIdentifier,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CircleCheck, Inbox, ListTodo, type LucideIcon, PauseCircle, Target } from "lucide-react";
import * as React from "react";
import { BoardCard, BoardCardContent } from "./board-card";
import { TaskEmptyState } from "./empty-state";

/**
 * The board: the whole lifecycle pipeline as columns, Linear-style.
 *
 * Interaction model:
 *  - Drag a card into a column to change its stage. The pointer drag only
 *    activates after 4px (mouse) or a 200ms hold (touch), so clicking a
 *    card still opens the detail sheet and columns still scroll on touch.
 *  - Keyboard: arrows / j k h l move focus across cards, Enter opens,
 *    `[` and `]` move the focused card a column left or right. Focus is
 *    real DOM focus and every move is announced politely.
 *  - Position inside a column is not draggable — each stage keeps the
 *    same sort its list view uses, so the two layouts never disagree.
 */

const COLUMN_ICONS: Record<BoardLifecycle, LucideIcon> = {
  inbox: Inbox,
  active: Target,
  waiting: PauseCircle,
  someday: ListTodo,
  done: CircleCheck,
};

/** First paint stays cheap when Done has years of history; the rest is one click away. */
const DONE_PREVIEW_COUNT = 30;

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "To move this task to another column, press the left or right bracket key. To drag it with a pointer, press and hold, then move.",
};

/** Pointer position decides the target; rect overlap covers fast flicks past the pointer. */
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

function findPosition(grid: Task[][], taskId: string): { col: number; row: number } | null {
  for (let col = 0; col < grid.length; col++) {
    const row = grid[col]?.findIndex((t) => t.id === taskId) ?? -1;
    if (row !== -1) return { col, row };
  }
  return null;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function TaskBoard() {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const hydrated = useStore((s) => s.hydrated);
  const updateTask = useStore((s) => s.updateTask);

  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);
  const taskById = React.useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const [showAllDone, setShowAllDone] = React.useState(false);
  const visibleColumns = React.useMemo(() => {
    if (showAllDone || columns.done.length <= DONE_PREVIEW_COUNT) return columns;
    return { ...columns, done: columns.done.slice(0, DONE_PREVIEW_COUNT) };
  }, [columns, showAllDone]);
  const grid = React.useMemo(
    () => BOARD_LIFECYCLES.map((l) => visibleColumns[l]),
    [visibleColumns],
  );

  const [activeTask, setActiveTask] = React.useState<Task | null>(null);
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const cardNodes = React.useRef(new Map<string, HTMLElement>());
  const pendingFocusId = React.useRef<string | null>(null);
  const lastDropAt = React.useRef(0);

  const reducedMotion = usePrefersReducedMotion();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const registerNode = React.useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardNodes.current.set(id, el);
    else cardNodes.current.delete(id);
  }, []);

  // A moved card re-mounts in its new column; put focus back on it so a
  // keyboard flow ([ / ]) never loses its place.
  React.useEffect(() => {
    const id = pendingFocusId.current;
    if (!id) return;
    pendingFocusId.current = null;
    const el = cardNodes.current.get(id);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });

  const moveTask = React.useCallback(
    (task: Task, target: BoardLifecycle, opts: { refocus: boolean }) => {
      if (task.lifecycle === target) return;
      updateTask(task.id, { lifecycle: target });
      setAnnouncement(`Moved “${task.title}” to ${lifecycleLabel(target)}.`);
      if (opts.refocus) {
        setFocusedId(task.id);
        pendingFocusId.current = task.id;
      }
    },
    [updateTask],
  );

  const openCard = React.useCallback(
    (id: string) => {
      // The click that trails a drop is a leftover of the drag gesture,
      // not an intent to open the sheet.
      if (Date.now() - lastDropAt.current < 250) return;
      openDetail(id);
    },
    [openDetail],
  );

  const onDragStart = React.useCallback(
    (e: DragStartEvent) => {
      setActiveTask(taskById.get(String(e.active.id)) ?? null);
    },
    [taskById],
  );

  const onDragEnd = React.useCallback(
    (e: DragEndEvent) => {
      setActiveTask(null);
      lastDropAt.current = Date.now();
      const task = taskById.get(String(e.active.id));
      const target = e.over ? String(e.over.id) : null;
      if (!task || !target || !isBoardLifecycle(target)) return;
      moveTask(task, target, { refocus: false });
    },
    [taskById, moveTask],
  );

  const onDragCancel = React.useCallback(() => {
    setActiveTask(null);
    lastDropAt.current = Date.now();
  }, []);

  const announcements: Announcements = React.useMemo(() => {
    const titleOf = (id: UniqueIdentifier) => taskById.get(String(id))?.title ?? "task";
    const columnOf = (id: UniqueIdentifier | undefined) => {
      const key = id === undefined ? "" : String(id);
      return isBoardLifecycle(key) ? lifecycleLabel(key) : null;
    };
    return {
      onDragStart({ active }) {
        return `Picked up “${titleOf(active.id)}”.`;
      },
      onDragOver({ active, over }) {
        const column = columnOf(over?.id);
        return column ? `“${titleOf(active.id)}” is over ${column}.` : undefined;
      },
      onDragEnd({ active, over }) {
        const column = columnOf(over?.id);
        return column
          ? `“${titleOf(active.id)}” dropped into ${column}.`
          : `“${titleOf(active.id)}” dropped.`;
      },
      onDragCancel({ active }) {
        return `Cancelled moving “${titleOf(active.id)}”.`;
      },
    };
  }, [taskById]);

  const onBoardKeyDown = (e: React.KeyboardEvent) => {
    if (activeTask) return; // a pointer drag owns the interaction
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const pos = focusedId ? findPosition(grid, focusedId) : null;

    const focusTask = (task: Task | undefined) => {
      if (!task) return;
      setFocusedId(task.id);
      const el = cardNodes.current.get(task.id);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const firstTask = () => grid.find((col) => col.length > 0)?.[0];
    const vertical = (delta: 1 | -1) => {
      if (!pos) return focusTask(firstTask());
      const col = grid[pos.col];
      if (!col) return;
      focusTask(col[Math.min(Math.max(pos.row + delta, 0), col.length - 1)]);
    };
    const horizontal = (delta: 1 | -1) => {
      if (!pos) return focusTask(firstTask());
      for (let c = pos.col + delta; c >= 0 && c < grid.length; c += delta) {
        const col = grid[c];
        if (col && col.length > 0) {
          return focusTask(col[Math.min(pos.row, col.length - 1)]);
        }
      }
    };
    const shiftColumn = (delta: 1 | -1) => {
      if (!pos) return;
      const task = grid[pos.col]?.[pos.row];
      const target = BOARD_LIFECYCLES[pos.col + delta];
      if (task && target) moveTask(task, target, { refocus: true });
    };

    switch (e.key) {
      case "ArrowDown":
      case "j":
        e.preventDefault();
        vertical(1);
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        vertical(-1);
        break;
      case "ArrowRight":
      case "l":
        e.preventDefault();
        horizontal(1);
        break;
      case "ArrowLeft":
      case "h":
        e.preventDefault();
        horizontal(-1);
        break;
      case "]":
        e.preventDefault();
        shiftColumn(1);
        break;
      case "[":
        e.preventDefault();
        shiftColumn(-1);
        break;
      case "Enter":
      case " ":
        if (focusedId && pos) {
          e.preventDefault();
          openCard(focusedId);
        }
        break;
    }
  };

  if (!hydrated) return <BoardShell header={boardHeader()} body={<BoardSkeleton />} />;

  const boardEmpty = grid.every((col) => col.length === 0);
  if (boardEmpty) {
    return (
      <BoardShell
        header={boardHeader()}
        body={
          <TaskEmptyState
            title="The board is clear."
            description="Capture a task and it will land in Inbox, ready to move through the pipeline."
          />
        }
      />
    );
  }

  const focusedPos = focusedId ? findPosition(grid, focusedId) : null;
  const tabbableId = focusedPos && focusedId ? focusedId : (firstTaskId(grid) ?? null);
  const hiddenDone = columns.done.length - visibleColumns.done.length;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
    >
      <BoardShell
        header={boardHeader()}
        body={
          <div
            role="group"
            aria-label="Board columns"
            onKeyDown={onBoardKeyDown}
            className={cn(
              "flex flex-1 min-h-0 items-stretch gap-2.5 overflow-x-auto pb-3 focus:outline-none",
              !activeTask && "snap-x snap-proximity md:snap-none",
            )}
          >
            {BOARD_LIFECYCLES.map((lifecycle) => (
              <BoardColumn
                key={lifecycle}
                lifecycle={lifecycle}
                tasks={visibleColumns[lifecycle]}
                totalCount={columns[lifecycle].length}
                labels={labels}
                dragging={activeTask != null}
                tabbableId={tabbableId}
                focusedId={focusedId}
                onOpen={openCard}
                onCardFocus={setFocusedId}
                registerNode={registerNode}
                footer={
                  lifecycle === "done" && hiddenDone > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mx-1 mb-1 text-[12px] text-[var(--fg-muted)]"
                      onClick={() => setShowAllDone(true)}
                    >
                      Show all {columns.done.length}
                    </Button>
                  ) : null
                }
              />
            ))}
          </div>
        }
      />
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
      <DragOverlay
        dropAnimation={
          reducedMotion ? null : { duration: 200, easing: "cubic-bezier(0.32, 0.72, 0.18, 1)" }
        }
      >
        {activeTask ? (
          <div className="scale-[1.02] cursor-grabbing rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-[0_16px_40px_-12px_oklch(0%_0_0/0.35)]">
            <BoardCardContent task={activeTask} labels={labels} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function firstTaskId(grid: Task[][]): string | undefined {
  return grid.find((col) => col.length > 0)?.[0]?.id;
}

function boardHeader(): React.ReactNode {
  return (
    <PageHeader
      title="Board"
      description={
        <>
          Every task by stage, left to right. Drag a card to move it — or focus one and press{" "}
          <Kbd>[</Kbd> <Kbd>]</Kbd>.
        </>
      }
    />
  );
}

/**
 * The board owns the viewport below the top bar (h-14) so columns scroll
 * independently instead of growing the page. On mobile the app frame
 * reserves 80px for the bottom nav, hence the smaller calc.
 */
function BoardShell({ header, body }: { header: React.ReactNode; body: React.ReactNode }) {
  return (
    <div className="flex h-[calc(100dvh-3.5rem-80px)] flex-col md:h-[calc(100dvh-3.5rem)]">
      {header}
      {body}
    </div>
  );
}

function BoardColumn({
  lifecycle,
  tasks,
  totalCount,
  labels,
  dragging,
  tabbableId,
  focusedId,
  onOpen,
  onCardFocus,
  registerNode,
  footer,
}: {
  lifecycle: BoardLifecycle;
  tasks: Task[];
  totalCount: number;
  labels: Label[];
  dragging: boolean;
  tabbableId: string | null;
  focusedId: string | null;
  onOpen: (id: string) => void;
  onCardFocus: (id: string) => void;
  registerNode: (id: string, el: HTMLElement | null) => void;
  footer?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lifecycle });
  const Icon = COLUMN_ICONS[lifecycle];
  const label = lifecycleLabel(lifecycle);

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label} column`}
      data-column={lifecycle}
      className={cn(
        "flex min-h-0 w-[min(78vw,272px)] shrink-0 snap-start flex-col",
        "md:w-auto md:min-w-[232px] md:flex-1 md:basis-0",
        "rounded-[var(--radius-lg)] border bg-[var(--surface-muted)]/50",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        isOver
          ? "border-[var(--border-strong)] bg-[var(--surface-muted)]"
          : dragging
            ? "border-[var(--border)]"
            : "border-transparent",
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <Icon
          size={13}
          aria-hidden
          className={lifecycle === "done" ? "text-[var(--done)]" : "text-[var(--fg-subtle)]"}
        />
        <h2 className="text-[12.5px] font-medium text-[var(--fg)] tracking-[-0.005em]">{label}</h2>
        {totalCount > 0 ? (
          <span aria-hidden className="text-num text-[11.5px] text-[var(--fg-subtle)]">
            {totalCount}
          </span>
        ) : null}
      </header>
      <div
        role="listbox"
        aria-label={`${label} tasks`}
        // Options carry a roving tabindex; the listbox itself is only
        // programmatically focusable so it never adds a Tab stop.
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5 focus:outline-none"
      >
        {tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            labels={labels}
            tabbable={task.id === tabbableId}
            focused={task.id === focusedId}
            onOpen={onOpen}
            onFocus={onCardFocus}
            registerNode={registerNode}
          />
        ))}
        {footer}
      </div>
    </section>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-1 min-h-0 gap-2.5 overflow-hidden pb-3">
      {BOARD_LIFECYCLES.map((lifecycle, col) => (
        <div
          key={lifecycle}
          className="flex w-[min(78vw,272px)] shrink-0 flex-col gap-1.5 rounded-[var(--radius-lg)] bg-[var(--surface-muted)]/50 p-1.5 md:w-auto md:min-w-[232px] md:flex-1 md:basis-0"
        >
          <div className="flex items-center gap-2 px-1.5 pt-1 pb-1.5">
            <Skeleton className="size-3.5 rounded" />
            <Skeleton className="h-3.5 w-16" />
          </div>
          {Array.from({ length: 3 - (col % 2) }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows with no identity.
            <Skeleton key={i} className="h-[72px] w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ))}
    </div>
  );
}

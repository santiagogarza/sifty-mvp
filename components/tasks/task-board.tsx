"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS, statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import {
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import {
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  type DroppableContainer,
  KeyboardCode,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MouseSensor,
  type ScreenReaderInstructions,
  TouchSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardCardContent, type BoardDragData } from "./board-card";
import { BoardColumn } from "./board-column";
import { ViewToggle } from "./view-toggle";

/**
 * The Kanban board: every status side by side, one card per task, drag a
 * card into a column to change its status. Moves go through the same
 * `updateTask(id, { lifecycle })` as the Status picker, so optimistic
 * sync, `completedAt` bookkeeping, and sidebar counts all just follow.
 *
 * Within-column order stays computed — each column applies the same
 * (filter, sort) as its list view, so Board and list can never disagree.
 */

/** Per-column ordering; exhaustive so a new status must declare its sort. */
const COLUMN_SELECTORS: Record<Lifecycle, (tasks: Task[]) => Task[]> = {
  inbox: selectInboxTasks,
  active: selectFocusTasks,
  waiting: (tasks) => selectByLifecycle(tasks, "waiting"),
  someday: (tasks) => selectByLifecycle(tasks, "someday"),
  done: selectDoneTasks,
  dropped: (tasks) => selectByLifecycle(tasks, "dropped"),
};

/** `--ease-product` — WAAPI can't resolve CSS variables in easing strings. */
const EASE_PRODUCT = "cubic-bezier(0.32, 0.72, 0.18, 1)";
/** Must mirror the `.board-card-lifted` end state in globals.css. */
const LIFTED_SHADOW = "0 12px 28px -10px oklch(0% 0 0 / 0.28), 0 2px 8px oklch(0% 0 0 / 0.1)";
/** Must mirror the resting card shadow in board-card.tsx. */
const RESTING_SHADOW = "0 1px 2px oklch(0% 0 0 / 0.04)";

/**
 * Release: dnd-kit translates the overlay to the card's landing slot while
 * the card itself settles — scale and shadow relax back down in the same
 * beat, so the drop ends the gesture on a calm note.
 */
const dropAnimation: DropAnimation = {
  duration: 220,
  easing: EASE_PRODUCT,
  sideEffects: (params) => {
    const cleanup = defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0" } },
    })(params);
    const card = params.dragOverlay.node.firstElementChild;
    if (card instanceof HTMLElement) {
      card.animate(
        [
          { transform: "scale(1.03)", boxShadow: LIFTED_SHADOW },
          { transform: "scale(1)", boxShadow: RESTING_SHADOW },
        ],
        { duration: 220, easing: EASE_PRODUCT, fill: "forwards" },
      );
    }
    return cleanup;
  },
};

const ARROW_CODES: string[] = [
  KeyboardCode.Left,
  KeyboardCode.Right,
  KeyboardCode.Up,
  KeyboardCode.Down,
];

/**
 * Keyboard drags hop whole columns: ← and → move the card to the center
 * of the nearest column on that side. Up/down don't apply — a column is
 * one drop target — so they're swallowed rather than left to scroll the
 * board underneath a held card.
 */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context: { active, collisionRect, droppableRects, droppableContainers } },
) => {
  if (!ARROW_CODES.includes(event.code)) return undefined;
  event.preventDefault();
  if (event.code !== KeyboardCode.Left && event.code !== KeyboardCode.Right) return undefined;
  if (!active || !collisionRect) return undefined;

  const candidates: DroppableContainer[] = [];
  for (const container of droppableContainers.getEnabled()) {
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    if (event.code === KeyboardCode.Left && rect.left + rect.width <= collisionRect.left) {
      candidates.push(container);
    }
    if (
      event.code === KeyboardCode.Right &&
      rect.left >= collisionRect.left + collisionRect.width
    ) {
      candidates.push(container);
    }
  }

  const collisions = closestCorners({
    active,
    collisionRect,
    droppableRects,
    droppableContainers: candidates,
    pointerCoordinates: null,
  });
  const targetId = getFirstCollision(collisions, "id");
  if (targetId === null) return undefined;
  const target = droppableRects.get(targetId);
  if (!target) return undefined;

  return {
    x: target.left + (target.width - collisionRect.width) / 2,
    y: collisionRect.top,
  };
};

/**
 * Pointer drags land where the pointer is; keyboard drags (no pointer)
 * fall back to overlay-rectangle intersection.
 */
const boardCollisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const collisions = pointerWithin(args);
    if (collisions.length > 0) return collisions;
  }
  return rectIntersection(args);
};

const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    "To pick up a task, press space. Use the left and right arrow keys to choose a status column, press space again to drop, or press escape to cancel.",
};

function dragTitle(data: BoardDragData | undefined): string {
  return data?.title ?? "Task";
}

const announcements: Announcements = {
  onDragStart({ active }) {
    return `Picked up ${dragTitle(active.data.current as BoardDragData | undefined)}.`;
  },
  onDragOver({ active, over }) {
    if (!over) return undefined;
    const title = dragTitle(active.data.current as BoardDragData | undefined);
    return `${title} is over ${statusLabel(over.id as Lifecycle)}.`;
  },
  onDragEnd({ active, over }) {
    const title = dragTitle(active.data.current as BoardDragData | undefined);
    if (!over) return `${title} was dropped.`;
    return `${title} moved to ${statusLabel(over.id as Lifecycle)}.`;
  },
  onDragCancel({ active }) {
    return `Moving ${dragTitle(active.data.current as BoardDragData | undefined)} was cancelled.`;
  },
};

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
  const reducedMotion = usePrefersReducedMotion();

  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const columns = React.useMemo(
    () => STATUS_VIEWS.map((view) => ({ view, tasks: COLUMN_SELECTORS[view.status](tasks) })),
    [tasks],
  );

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const activeTask = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;

  // A click that lands right after a drop is the drag's residue, not intent.
  const dragEndedAt = React.useRef(0);
  const openTask = React.useCallback(
    (id: string) => {
      if (Date.now() - dragEndedAt.current < 250) return;
      openDetail(id);
    },
    [openDetail],
  );

  const sensors = useSensors(
    // 4px of travel before lift: a plain click still opens the card.
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // On touch, a short hold lifts the card so vertical scrolling stays free.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: boardKeyboardCoordinates,
      // Space only for pickup — Enter keeps opening the task, as in lists.
      keyboardCodes: {
        start: [KeyboardCode.Space],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space, KeyboardCode.Enter],
      },
    }),
  );

  const onDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    dragEndedAt.current = Date.now();
    if (!over) return;
    const from = (active.data.current as BoardDragData | undefined)?.status;
    const to = over.id as Lifecycle;
    if (!from || from === to) return;
    updateTask(String(active.id), { lifecycle: to });
  };

  const onDragCancel = () => {
    setActiveId(null);
    dragEndedAt.current = Date.now();
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem-80px)] flex-col md:h-[calc(100dvh-3.5rem)]">
      <PageHeader
        title="Board"
        description="Drag a card between columns to change its status."
        actions={<ViewToggle active="board" />}
      />
      {!hydrated ? (
        <BoardSkeleton />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollisionDetection}
          accessibility={{ announcements, screenReaderInstructions }}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div className="-mx-4 flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
            {columns.map(({ view, tasks: columnTasks }) => (
              <BoardColumn
                key={view.status}
                status={view.status}
                label={view.label}
                tasks={columnTasks}
                labelMap={labelMap}
                onOpen={openTask}
              />
            ))}
          </div>
          <DragOverlay zIndex={40} dropAnimation={reducedMotion ? null : dropAnimation}>
            {activeTask ? <BoardCardContent task={activeTask} labelMap={labelMap} lifted /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="-mx-4 flex min-h-0 flex-1 gap-3 overflow-x-hidden px-4 pb-3 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
      {STATUS_VIEWS.map((view) => (
        <div key={view.status} className="flex min-w-[224px] flex-1 flex-col">
          <div className="flex items-center gap-2 px-2 pb-2">
            <Skeleton className="size-3.5 rounded" />
            <Skeleton className="h-3.5 w-16" />
          </div>
          <div className="flex flex-col gap-1.5 rounded-[var(--radius-lg)] bg-[var(--surface-muted)]/50 p-1.5">
            <Skeleton className="h-[74px] rounded-[var(--radius-md)]" />
            <Skeleton className="h-[74px] rounded-[var(--radius-md)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

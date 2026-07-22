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
import { cn } from "@/lib/utils/cn";
import {
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardCode,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  type ScreenReaderInstructions,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Columns3, LayoutList } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { BoardCardFace } from "./board-card";
import { BoardColumn } from "./board-column";

/**
 * Kanban board over the five routed statuses. Dragging a card to another
 * column is exactly `updateTask(id, { lifecycle })` — the same optimistic
 * mutation the Status picker uses, so sync, `completedAt`, and the sidebar
 * counts all follow for free. Cross-column only: within-column order stays
 * computed by the per-view selectors, matching the list pages.
 */
export function TaskBoard() {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const hydrated = useStore((s) => s.hydrated);
  const updateTask = useStore((s) => s.updateTask);

  const [activeTask, setActiveTask] = React.useState<Task | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  // A click on a card opens the detail sheet — but not the click that
  // trails a completed drag, and not Enter while a keyboard drag holds
  // the card.
  const dragActive = React.useRef(false);
  const settleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleOpen = React.useCallback(
    (id: string) => {
      if (dragActive.current) return;
      openDetail(id);
    },
    [openDetail],
  );
  const settleDrag = React.useCallback(() => {
    // The browser fires the trailing click synchronously after pointerup,
    // so releasing the flag on a macrotask is enough to swallow it.
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      dragActive.current = false;
    }, 0);
  }, []);
  React.useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const columns = React.useMemo(
    () =>
      STATUS_VIEWS.map((view) => ({
        status: view.status,
        tasks: selectColumnTasks(tasks, view.status),
      })),
    [tasks],
  );

  const sensors = useSensors(
    // 5px of travel before a drag starts, so a plain click still opens
    // the card.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: boardKeyboardCoordinates,
      // Space picks up and drops; Enter is reserved for opening the card
      // (it still drops while a drag is in flight).
      keyboardCodes: {
        start: [KeyboardCode.Space],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space, KeyboardCode.Enter],
      },
    }),
  );

  const onDragStart = React.useCallback((event: DragStartEvent) => {
    dragActive.current = true;
    setActiveTask(taskOf(event.active) ?? null);
  }, []);

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null);
      settleDrag();
      const task = taskOf(event.active);
      const target = event.over?.id as Lifecycle | undefined;
      if (!task || !target || target === task.lifecycle) return;
      updateTask(task.id, { lifecycle: target });
    },
    [updateTask, settleDrag],
  );

  const onDragCancel = React.useCallback(() => {
    setActiveTask(null);
    settleDrag();
  }, [settleDrag]);

  return (
    <div className="flex h-[calc(100dvh-3.5rem-80px)] flex-col md:h-[calc(100dvh-3.5rem)]">
      <PageHeader
        title="Board"
        description="Drag a card between columns to change its status — or focus one and press Space to move it with the arrow keys."
        actions={<ViewToggle />}
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
          <div className="flex flex-1 min-h-0 gap-3 overflow-x-auto pb-4">
            {columns.map((column) => (
              <BoardColumn
                key={column.status}
                status={column.status}
                tasks={column.tasks}
                labels={labels}
                onOpen={handleOpen}
              />
            ))}
          </div>
          <DragOverlay
            // Settle into place on release rather than snapping —
            // matches --ease-product at a standard 200ms beat.
            dropAnimation={
              reducedMotion ? null : { duration: 200, easing: "cubic-bezier(0.32, 0.72, 0.18, 1)" }
            }
          >
            {activeTask ? <BoardCardFace task={activeTask} labels={labels} lifted /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

/** Same (filter, sort) pairs as the corresponding list pages. */
function selectColumnTasks(tasks: Task[], status: Lifecycle): Task[] {
  switch (status) {
    case "inbox":
      return selectInboxTasks(tasks);
    case "active":
      return selectFocusTasks(tasks);
    case "done":
      return selectDoneTasks(tasks);
    default:
      return selectByLifecycle(tasks, status);
  }
}

function taskOf(active: { data: { current?: { task?: unknown } | undefined } }): Task | undefined {
  return active.data.current?.task as Task | undefined;
}

/**
 * Pointer drags land on the column under the cursor; keyboard drags (no
 * pointer) fall through to rect intersection of the lifted card.
 */
const boardCollisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : rectIntersection(args);
};

/**
 * Keyboard drags move column-to-column, not by pixel: ←/→ centers the
 * lifted card over the adjacent column so every press is one legible step
 * (the sensor scrolls the board to keep it in view).
 */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context: { droppableRects, droppableContainers, collisionRect } },
) => {
  if (event.code !== KeyboardCode.Right && event.code !== KeyboardCode.Left) return;
  if (!collisionRect) return;

  const columnRects = droppableContainers
    .getEnabled()
    .flatMap((container) => {
      const rect = droppableRects.get(container.id);
      return rect ? [rect] : [];
    })
    .sort((a, b) => a.left - b.left);
  if (columnRects.length === 0) return;

  const cardCenterX = collisionRect.left + collisionRect.width / 2;
  let currentIndex = columnRects.findIndex(
    (rect) => cardCenterX >= rect.left && cardCenterX <= rect.left + rect.width,
  );
  if (currentIndex === -1) {
    // Between columns (e.g. picked up mid-scroll): snap to the nearest
    // column before stepping.
    let bestDistance = Number.POSITIVE_INFINITY;
    columnRects.forEach((rect, index) => {
      const distance = Math.abs(cardCenterX - (rect.left + rect.width / 2));
      if (distance < bestDistance) {
        bestDistance = distance;
        currentIndex = index;
      }
    });
  }

  const target =
    columnRects[event.code === KeyboardCode.Right ? currentIndex + 1 : currentIndex - 1];
  if (!target) return;
  return {
    x: currentCoordinates.x + (target.left + target.width / 2) - cardCenterX,
    y: currentCoordinates.y,
  };
};

const announcements: Announcements = {
  onDragStart({ active }) {
    const task = taskOf(active);
    if (!task) return;
    return `Picked up "${task.title}" from ${statusLabel(task.lifecycle)}.`;
  },
  onDragOver({ active, over }) {
    const task = taskOf(active);
    if (!task) return;
    return over
      ? `"${task.title}" is over ${statusLabel(over.id as Lifecycle)}.`
      : `"${task.title}" is not over a column.`;
  },
  onDragEnd({ active, over }) {
    const task = taskOf(active);
    if (!task) return;
    return over
      ? `"${task.title}" moved to ${statusLabel(over.id as Lifecycle)}.`
      : `"${task.title}" was dropped back in ${statusLabel(task.lifecycle)}.`;
  },
  onDragCancel({ active }) {
    const task = taskOf(active);
    if (!task) return;
    return `Cancelled — "${task.title}" stays in ${statusLabel(task.lifecycle)}.`;
  },
};

const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    "To move a task to another column, press Space to pick it up, use the left and right arrow keys to choose a column, and press Space again to drop it. Press Escape to cancel. Press Enter to open the task.",
};

/**
 * List/Board segmented switch — quiet, in the header where a view control
 * is expected. Board is the page you're on, so only List navigates.
 */
function ViewToggle() {
  const segment =
    "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-[12.5px] transition-colors duration-150 ease-[var(--ease-product)]";
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5"
    >
      <Link
        href="/today"
        className={cn(
          segment,
          "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
        )}
      >
        <LayoutList size={13} />
        List
      </Link>
      <span
        aria-current="page"
        className={cn(segment, "bg-[var(--surface-muted)] text-[var(--fg)]")}
      >
        <Columns3 size={13} />
        Board
      </span>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-1 min-h-0 gap-3 overflow-x-hidden pb-4">
      {STATUS_VIEWS.map((view) => (
        <div
          key={view.status}
          className="flex w-[272px] shrink-0 flex-col gap-1.5 rounded-[var(--radius-lg)] bg-[var(--bg-sunken)]/60 px-2 pt-3 pb-2"
        >
          <Skeleton className="mx-1.5 mb-2 h-3.5 w-24" />
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-[72px] w-full rounded-[var(--radius-md)]" />
          ))}
        </div>
      ))}
    </div>
  );
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

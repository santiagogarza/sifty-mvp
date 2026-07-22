"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { BoardCardPreview } from "@/components/tasks/board-card";
import { BoardColumn } from "@/components/tasks/board-column";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS, statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
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
  KeyboardCode,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Columns3, LayoutList } from "lucide-react";
import Link from "next/link";
import * as React from "react";

const BOARD_STATUSES = STATUS_VIEWS.map((view) => view.status);
const PRODUCT_EASING = "cubic-bezier(0.32, 0.72, 0.18, 1)";

const boardKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  if (event.code !== KeyboardCode.Left && event.code !== KeyboardCode.Right) return;

  const currentStatus = context.over?.id ?? context.active?.data.current?.lifecycle;
  const currentIndex = BOARD_STATUSES.findIndex((status) => status === currentStatus);
  if (currentIndex < 0) return;

  const direction = event.code === KeyboardCode.Right ? 1 : -1;
  const targetStatus = BOARD_STATUSES[currentIndex + direction];
  if (!targetStatus) return;

  const targetRect = context.droppableRects.get(targetStatus);
  const targetNode = context.droppableContainers.get(targetStatus)?.node.current;
  const activeRect = context.collisionRect;
  if (!targetRect || !targetNode || !activeRect) return;

  const board = targetNode.closest<HTMLElement>('[aria-label="Task lifecycle board"]');
  if (board) {
    const boardRect = board.getBoundingClientRect();
    if (targetRect.right > boardRect.right) {
      board.scrollLeft += targetRect.right - boardRect.right + 12;
    } else if (targetRect.left < boardRect.left) {
      board.scrollLeft -= boardRect.left - targetRect.left + 12;
    }
  }

  const visibleTargetRect = targetNode.getBoundingClientRect();

  const y = Math.min(
    Math.max(currentCoordinates.y, visibleTargetRect.top + 44),
    visibleTargetRect.bottom - activeRect.height,
  );

  return {
    x: visibleTargetRect.left + (visibleTargetRect.width - activeRect.width) / 2,
    y,
  };
};

const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);
};

export function TaskBoard() {
  const { openDetail } = useFrame();
  const tasks = useStore((state) => state.tasks);
  const labels = useStore((state) => state.labels);
  const hydrated = useStore((state) => state.hydrated);
  const updateTask = useStore((state) => state.updateTask);
  const [activeTask, setActiveTask] = React.useState<Task | null>(null);
  const reducedMotion = useReducedMotion();
  const suppressOpen = React.useRef(false);
  const releaseSuppression = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: boardKeyboardCoordinates,
    scrollBehavior: reducedMotion ? "auto" : "smooth",
    keyboardCodes: {
      start: [KeyboardCode.Space],
      cancel: [KeyboardCode.Esc],
      end: [KeyboardCode.Space],
    },
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  const columns = React.useMemo(
    () =>
      STATUS_VIEWS.map((view) => ({
        ...view,
        tasks: selectColumnTasks(tasks, view.status),
      })),
    [tasks],
  );

  const announcements = React.useMemo<Announcements>(
    () => ({
      onDragStart({ active }) {
        const task = tasks.find((candidate) => candidate.id === active.id);
        return task
          ? `Picked up ${task.title}. It is in ${statusLabel(task.lifecycle)}.`
          : "Picked up task.";
      },
      onDragOver({ active, over }) {
        if (!over || !isBoardStatus(over.id)) return;
        const task = tasks.find((candidate) => candidate.id === active.id);
        return task ? `${task.title} is over ${statusLabel(over.id)}.` : undefined;
      },
      onDragEnd({ active, over }) {
        const task = tasks.find((candidate) => candidate.id === active.id);
        if (!task) return "Task dropped.";
        if (!over || !isBoardStatus(over.id)) return `${task.title} returned to its column.`;
        if (task.lifecycle === over.id) return `${task.title} stayed in ${statusLabel(over.id)}.`;
        return `${task.title} moved to ${statusLabel(over.id)}.`;
      },
      onDragCancel({ active }) {
        const task = tasks.find((candidate) => candidate.id === active.id);
        return task ? `Moving ${task.title} was cancelled.` : "Move cancelled.";
      },
    }),
    [tasks],
  );

  React.useEffect(
    () => () => {
      if (releaseSuppression.current) clearTimeout(releaseSuppression.current);
    },
    [],
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    suppressOpen.current = true;
    setActiveTask(tasks.find((task) => task.id === active.id) ?? null);
  };

  const finishDrag = () => {
    setActiveTask(null);
    if (releaseSuppression.current) clearTimeout(releaseSuppression.current);
    releaseSuppression.current = setTimeout(() => {
      suppressOpen.current = false;
    }, 0);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const task = tasks.find((candidate) => candidate.id === active.id);
    if (task && over && isBoardStatus(over.id) && task.lifecycle !== over.id) {
      updateTask(task.id, { lifecycle: over.id });
    }
    finishDrag();
  };

  const onDragCancel = () => finishDrag();

  const onOpen = (id: string) => {
    if (!suppressOpen.current) openDetail(id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Board"
        description="Move tasks through their lifecycle. Order within each column stays automatic."
        actions={<ViewToggle />}
      />

      {!hydrated ? (
        <BoardSkeleton />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollisionDetection}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                "To move a task, press Space to pick it up, then use the Left and Right arrow keys to choose a column. Press Space again to drop, or Escape to cancel.",
            },
          }}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div
            className="flex min-h-0 flex-1 gap-3 overflow-x-auto overscroll-x-contain pb-4"
            aria-label="Task lifecycle board"
          >
            {columns.map((column) => (
              <BoardColumn
                key={column.status}
                status={column.status}
                tasks={column.tasks}
                labels={labels}
                onOpen={onOpen}
              />
            ))}
          </div>

          <DragOverlay
            dropAnimation={
              reducedMotion
                ? null
                : {
                    duration: 200,
                    easing: PRODUCT_EASING,
                  }
            }
          >
            {activeTask ? (
              <BoardCardPreview task={activeTask} labels={labels} elevated={!reducedMotion} />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function selectColumnTasks(tasks: Task[], status: Lifecycle): Task[] {
  if (status === "inbox") return selectInboxTasks(tasks);
  if (status === "active") return selectFocusTasks(tasks);
  if (status === "done") return selectDoneTasks(tasks);
  return selectByLifecycle(tasks, status);
}

function isBoardStatus(value: unknown): value is Lifecycle {
  return BOARD_STATUSES.some((status) => status === value);
}

function ViewToggle() {
  return (
    <div
      className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-sunken)] p-0.5"
      aria-label="Task view"
    >
      <Link
        href="/today"
        className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
      >
        <LayoutList size={13} />
        List
      </Link>
      <Link
        href="/board"
        aria-current="page"
        className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--surface)] px-2.5 text-[12.5px] text-[var(--fg)] shadow-sm"
      >
        <Columns3 size={13} />
        Board
      </Link>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div
      className="flex min-h-[360px] gap-3 overflow-hidden"
      role="status"
      aria-label="Loading board"
    >
      {STATUS_VIEWS.map((view) => (
        <div
          key={view.status}
          className="w-[min(82vw,280px)] shrink-0 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-sunken)]/55 p-2"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-1 pb-2.5">
            <Skeleton className="size-3.5" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="mt-2 h-24 w-full rounded-[var(--radius-md)]" />
          <Skeleton className="mt-2 h-20 w-full rounded-[var(--radius-md)]" />
        </div>
      ))}
    </div>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

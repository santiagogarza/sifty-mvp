"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { buttonVariants } from "@/components/ui/button";
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
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MouseSensor,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Columns3, LayoutList } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { BoardCard } from "./board-card";
import { BoardColumn } from "./board-column";

const BOARD_STATUSES = STATUS_VIEWS.map((view) => view.status);
const BOARD_STATUS_SET = new Set<Lifecycle>(BOARD_STATUSES);

function selectTasksForStatus(tasks: Task[], status: Lifecycle): Task[] {
  if (status === "inbox") return selectInboxTasks(tasks);
  if (status === "active") return selectFocusTasks(tasks);
  if (status === "done") return selectDoneTasks(tasks);
  return selectByLifecycle(tasks, status);
}

export function TaskBoard() {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const hydrated = useStore((s) => s.hydrated);
  const updateTask = useStore((s) => s.updateTask);
  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
  const [overStatus, setOverStatus] = React.useState<Lifecycle | null>(null);
  const keyboardStatusRef = React.useRef<Lifecycle | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const dropEasing = useCssVariable("--ease-product", "cubic-bezier(0.32, 0.72, 0.18, 1)");

  const labelsById = React.useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels],
  );
  const tasksById = React.useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const columns = React.useMemo(
    () =>
      STATUS_VIEWS.map((view) => ({
        ...view,
        tasks: selectTasksForStatus(tasks, view.status),
      })),
    [tasks],
  );
  const activeTask = activeTaskId ? tasksById.get(activeTaskId) : null;

  const keyboardCoordinates = React.useMemo(
    () => createColumnKeyboardCoordinates(tasksById, keyboardStatusRef),
    [tasksById],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
    }),
  );

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveTaskId(id);
    const task = tasksById.get(id);
    const status = task?.lifecycle && isBoardStatus(task.lifecycle) ? task.lifecycle : null;
    keyboardStatusRef.current = status;
    setOverStatus(status);
  };

  const onDragOver = (event: DragOverEvent) => {
    const status = statusFromOver(event.over?.id);
    if (status) keyboardStatusRef.current = status;
    setOverStatus(status);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const targetStatus = statusFromOver(event.over?.id);
    const task = tasksById.get(activeId);

    setActiveTaskId(null);
    setOverStatus(null);
    keyboardStatusRef.current = null;

    if (!task || !targetStatus || task.lifecycle === targetStatus) return;
    updateTask(activeId, { lifecycle: targetStatus });
  };

  const onDragCancel = () => {
    setActiveTaskId(null);
    setOverStatus(null);
    keyboardStatusRef.current = null;
  };

  return (
    <>
      <PageHeader
        eyebrow="Board"
        title="Kanban"
        description="Move work across its lifecycle. Cross-column moves update status; order within a column stays computed."
        actions={<ViewToggle />}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{ announcements }}
      >
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
          <div className="flex min-w-max gap-3 pb-2">
            {hydrated
              ? columns.map((column) => (
                  <BoardColumn
                    key={column.status}
                    status={column.status}
                    label={column.label}
                    tasks={column.tasks}
                    labelsById={labelsById}
                    activeTaskId={activeTaskId}
                    onOpenTask={openDetail}
                  />
                ))
              : STATUS_VIEWS.map((view) => (
                  <BoardColumn
                    key={view.status}
                    status={view.status}
                    label={view.label}
                    tasks={[]}
                    labelsById={labelsById}
                    activeTaskId={null}
                    onOpenTask={openDetail}
                  />
                ))}
          </div>
        </div>

        <DragOverlay
          dropAnimation={
            prefersReducedMotion
              ? null
              : {
                  duration: 200,
                  easing: dropEasing,
                  sideEffects: defaultDropAnimationSideEffects({
                    styles: {
                      active: {
                        opacity: "0.4",
                      },
                    },
                  }),
                }
          }
        >
          {activeTask ? (
            <BoardCard
              task={activeTask}
              labels={
                activeTask.labelIds.map((id) => labelsById.get(id)).filter(Boolean) as Label[]
              }
              overlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="sr-only" aria-live="polite">
        {activeTask && overStatus
          ? `${activeTask.title} over ${statusLabel(overStatus)}. Drop to move.`
          : null}
      </div>
    </>
  );
}

function ViewToggle() {
  return (
    <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5">
      <Link
        href="/today"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "h-7 rounded-[var(--radius-sm)] px-2.5 text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]",
        )}
      >
        <LayoutList size={13} />
        List
      </Link>
      <span
        aria-current="page"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "h-7 rounded-[var(--radius-sm)] bg-[var(--surface-muted)] px-2.5 text-[12.5px] text-[var(--fg)]",
        )}
      >
        <Columns3 size={13} />
        Board
      </span>
    </div>
  );
}

function createColumnKeyboardCoordinates(
  tasksById: Map<string, Task>,
  keyboardStatusRef: React.MutableRefObject<Lifecycle | null>,
): KeyboardCoordinateGetter {
  return (event, { active, currentCoordinates, context }) => {
    const direction = keyDirection(event.code);
    if (direction === 0) return;

    const task = tasksById.get(String(active));
    const currentStatus =
      keyboardStatusRef.current ??
      statusFromOver(context.over?.id) ??
      (task?.lifecycle && isBoardStatus(task.lifecycle) ? task.lifecycle : null);
    if (!currentStatus) return;

    const currentIndex = BOARD_STATUSES.indexOf(currentStatus);
    const targetStatus = BOARD_STATUSES[currentIndex + direction];
    if (!targetStatus) return currentCoordinates;
    keyboardStatusRef.current = targetStatus;

    const currentElement = document.querySelector<HTMLElement>(
      `[data-board-column-id="${currentStatus}"]`,
    );
    const targetElement = document.querySelector<HTMLElement>(
      `[data-board-column-id="${targetStatus}"]`,
    );
    targetElement?.scrollIntoView({ block: "nearest", inline: "center" });
    const currentRect = currentElement?.getBoundingClientRect();
    const targetRect = targetElement?.getBoundingClientRect();
    if (!currentRect || !targetRect) return currentCoordinates;

    return {
      x: currentCoordinates.x + targetRect.left - currentRect.left,
      y: currentCoordinates.y,
    };
  };
}

function keyDirection(code: string): -1 | 0 | 1 {
  if (code === "ArrowLeft" || code === "ArrowUp") return -1;
  if (code === "ArrowRight" || code === "ArrowDown") return 1;
  return 0;
}

function statusFromOver(id: unknown): Lifecycle | null {
  if (typeof id !== "string") return null;
  return isBoardStatus(id) ? id : null;
}

function isBoardStatus(value: string): value is Lifecycle {
  return BOARD_STATUS_SET.has(value as Lifecycle);
}

const announcements = {
  onDragStart({ active }: { active: { id: string | number } }) {
    return `Picked up task ${active.id}. Use arrow keys to move between columns, space to drop, or escape to cancel.`;
  },
  onDragOver({ over }: { over: { id: string | number } | null }) {
    const status = statusFromOver(over?.id);
    return status ? `Over ${statusLabel(status)}.` : undefined;
  },
  onDragEnd({ over }: { over: { id: string | number } | null }) {
    const status = statusFromOver(over?.id);
    return status ? `Dropped in ${statusLabel(status)}.` : "Drop cancelled.";
  },
  onDragCancel() {
    return "Drag cancelled.";
  },
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

function useCssVariable(name: string, fallback: string): string {
  const [value, setValue] = React.useState(fallback);

  React.useEffect(() => {
    const resolved = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    setValue(resolved || fallback);
  }, [name, fallback]);

  return value;
}

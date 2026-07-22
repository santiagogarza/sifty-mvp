"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import {
  type ViewArgs,
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
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Columns3, LayoutList } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { BoardCard } from "./board-card";
import { BoardColumn } from "./board-column";

const PRODUCT_EASE = "cubic-bezier(0.32, 0.72, 0.18, 1)";

const COLUMN_SELECTORS: Record<Lifecycle, (tasks: Task[], args?: ViewArgs) => Task[]> = {
  inbox: selectInboxTasks,
  active: selectFocusTasks,
  waiting: (tasks, args) => selectByLifecycle(tasks, "waiting", args),
  someday: (tasks, args) => selectByLifecycle(tasks, "someday", args),
  done: selectDoneTasks,
  dropped: () => [],
};

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

function ViewToggle() {
  const router = useRouter();
  return (
    <div
      className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--border)] p-0.5"
      role="group"
      aria-label="View mode"
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-[12.5px] text-[var(--fg-muted)]"
        onClick={() => router.push("/today")}
      >
        <LayoutList size={13} />
        List
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-[12.5px] bg-[var(--surface-muted)] text-[var(--fg)]"
        aria-current="page"
      >
        <Columns3 size={13} />
        Board
      </Button>
    </div>
  );
}

export function TaskBoard() {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const hydrated = useStore((s) => s.hydrated);
  const updateTask = useStore((s) => s.updateTask);
  const reducedMotion = usePrefersReducedMotion();

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const draggedRef = React.useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const columns = React.useMemo(
    () =>
      STATUS_VIEWS.map((view) => ({
        ...view,
        tasks: COLUMN_SELECTORS[view.status](tasks),
      })),
    [tasks],
  );

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : undefined;

  const dropAnimation = React.useMemo<DropAnimation>(
    () => ({
      duration: reducedMotion ? 0 : 200,
      easing: PRODUCT_EASE,
      sideEffects: defaultDropAnimationSideEffects({
        styles: { active: { opacity: "0.4" } },
      }),
    }),
    [reducedMotion],
  );

  const onDragStart = (event: DragStartEvent) => {
    draggedRef.current = true;
    setActiveId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 0);

    if (!over) return;

    const taskId = String(active.id);
    const targetStatus = over.id as Lifecycle;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.lifecycle === targetStatus) return;

    updateTask(taskId, { lifecycle: targetStatus });
  };

  const onDragCancel = () => {
    setActiveId(null);
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  };

  return (
    <>
      <PageHeader
        title="Board"
        description="Drag a card between columns to change where it lives. Order within a column follows the same rules as each list view."
        actions={<ViewToggle />}
      />

      {!hydrated ? (
        <BoardSkeleton />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div
            className={cn(
              "flex gap-3 overflow-x-auto pb-4 -mx-1 px-1",
              "snap-x snap-mandatory scroll-px-1",
            )}
          >
            {columns.map((col) => (
              <BoardColumn
                key={col.status}
                status={col.status}
                label={col.label}
                tasks={col.tasks}
                labels={labels}
                onOpen={(id) => {
                  if (draggedRef.current) return;
                  openDetail(id);
                }}
                reducedMotion={reducedMotion}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={dropAnimation}>
            {activeTask ? (
              <BoardCard
                task={activeTask}
                labels={labels}
                onOpen={() => {}}
                overlay
                reducedMotion={reducedMotion}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </>
  );
}

function BoardSkeleton() {
  const columns = ["inbox", "focus", "waiting", "someday", "done"] as const;
  return (
    <div className="flex gap-3 overflow-hidden">
      {columns.map((col) => (
        <div key={col} className="w-[272px] shrink-0 space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-[88px] w-full rounded-[var(--radius-md)]" />
          <Skeleton className="h-[72px] w-full rounded-[var(--radius-md)]" />
        </div>
      ))}
    </div>
  );
}

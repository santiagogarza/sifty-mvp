"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
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
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Columns3, LayoutList } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { BoardCardOverlay } from "./board-card";
import { BoardColumn } from "./board-column";

/** Per-column task selector, keyed by the routed statuses in `STATUS_VIEWS`. */
const COLUMN_SELECTORS: Record<Lifecycle, (tasks: Task[]) => Task[]> = {
  inbox: selectInboxTasks,
  active: selectFocusTasks,
  waiting: (t) => selectByLifecycle(t, "waiting"),
  someday: (t) => selectByLifecycle(t, "someday"),
  done: selectDoneTasks,
  dropped: (t) => selectByLifecycle(t, "dropped"),
};

// Mirrors `--ease-product` from globals.css. dnd-kit's drop animation runs
// through the Web Animations API, so it needs the curve as a literal.
const EASE_PRODUCT = "cubic-bezier(0.32, 0.72, 0.18, 1)";

const dropAnimation: DropAnimation = {
  duration: 200,
  easing: EASE_PRODUCT,
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.4" } },
  }),
};

/**
 * Keyboard drag movement. The default core getter nudges 25px per press,
 * which would take many taps to cross a wide column. Instead, Left/Right jump
 * to the adjacent column (the move that actually changes lifecycle) and
 * Up/Down nudge within the current column to reach its drop area.
 */
const boardCoordinateGetter: KeyboardCoordinateGetter = (
  event,
  { context: { collisionRect, droppableRects, droppableContainers } },
) => {
  if (!collisionRect) return undefined;

  const columns = droppableContainers
    .toArray()
    .filter((c) => droppableRects.get(c.id))
    .sort((a, b) => droppableRects.get(a.id)!.left - droppableRects.get(b.id)!.left);
  if (columns.length === 0) return undefined;

  let index = 0;
  let nearest = Number.POSITIVE_INFINITY;
  columns.forEach((c, i) => {
    const distance = Math.abs(droppableRects.get(c.id)!.left - collisionRect.left);
    if (distance < nearest) {
      nearest = distance;
      index = i;
    }
  });

  switch (event.code) {
    case "ArrowRight":
      event.preventDefault();
      index = Math.min(columns.length - 1, index + 1);
      break;
    case "ArrowLeft":
      event.preventDefault();
      index = Math.max(0, index - 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      return { x: collisionRect.left, y: collisionRect.top - 48 };
    case "ArrowDown":
      event.preventDefault();
      return { x: collisionRect.left, y: collisionRect.top + 48 };
    default:
      return undefined;
  }

  const target = droppableRects.get(columns[index]!.id)!;
  return { x: target.left + 8, y: collisionRect.top };
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function TaskBoard() {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const updateTask = useStore((s) => s.updateTask);
  const hydrated = useStore((s) => s.hydrated);
  const reducedMotion = usePrefersReducedMotion();

  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    // ~5px activation so a still pointerdown stays a click (opens the card)
    // and only a deliberate drag lifts it.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
      coordinateGetter: boardCoordinateGetter,
    }),
  );

  const columns = React.useMemo(
    () =>
      STATUS_VIEWS.map((view) => ({
        status: view.status,
        label: view.label,
        tasks: COLUMN_SELECTORS[view.status](tasks),
      })),
    [tasks],
  );

  const activeTask = React.useMemo(
    () => (activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null),
    [activeId, tasks],
  );

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const targetStatus = over.id as Lifecycle;
    const task = tasks.find((t) => t.id === active.id);
    if (!task || task.lifecycle === targetStatus) return;
    // Cross-column only: this is exactly `updateTask`'s lifecycle path, which
    // already syncs and sets/clears `completedAt` for the Done column.
    updateTask(task.id, { lifecycle: targetStatus });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Board"
        description="Your whole pipeline at a glance. Drag a card to another column to change where it lives."
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
          onDragCancel={() => setActiveId(null)}
        >
          <div
            className={cn(
              "flex snap-x gap-3 overflow-x-auto pb-6",
              "h-[calc(100dvh-15rem)] min-h-[420px]",
              // Full-bleed the scroll row to the shell's padding so cards can
              // use the whole width without touching the page gutter.
              "-mx-4 px-4 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8",
            )}
          >
            {columns.map((col) => (
              <BoardColumn
                key={col.status}
                status={col.status}
                label={col.label}
                tasks={col.tasks}
                labels={labels}
                onOpen={openDetail}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={reducedMotion ? null : dropAnimation}>
            {activeTask ? <BoardCardOverlay task={activeTask} labels={labels} /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

/**
 * List / Board segmented control. Styled like the Settings theme picker:
 * a bordered track with the active segment on `--accent-soft`. "List" returns
 * to the default list surface (`/today`); "Board" is the current view.
 */
function ViewToggle() {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5">
      <Link
        href="/today"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1 text-[12.5px]",
          "text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
        )}
      >
        <LayoutList size={13} />
        List
      </Link>
      <span
        aria-current="page"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1 text-[12.5px]",
          "bg-[var(--accent-soft)] text-[var(--accent)]",
        )}
      >
        <Columns3 size={13} />
        Board
      </span>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden pb-6 -mx-4 px-4 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
      {[0, 1, 2, 3, 4].map((col) => (
        <div key={col} className="w-[268px] shrink-0">
          <div className="flex items-center gap-2 px-1.5 pb-2">
            <Skeleton className="size-3.5 rounded" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          <div className="flex flex-col gap-1.5 p-1.5">
            {[0, 1].map((card) => (
              <div
                key={card}
                className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-2.5"
              >
                <Skeleton className="h-3.5 w-[80%]" />
                <Skeleton className="mt-2 h-3 w-[50%]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

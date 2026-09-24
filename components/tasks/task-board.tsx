"use client";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import { STATUS_META, statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { type BoardColumn, selectBoardColumns } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import {
  type Active,
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DropAnimation,
  type KeyboardCodes,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChevronsRight } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";
import { STATUS_ICONS } from "./status-icon";

/**
 * Kanban board: one column per status; drag a card to another column to
 * move it there. Order inside a column is derived (`selectBoardColumns`),
 * so a drop anywhere in a column is enough — there is no manual ordering.
 *
 * Input:
 *  - Mouse drags start after 5px of travel, so a plain click still opens
 *    the task. Touch drags start after a short hold, so a swipe scrolls.
 *  - Keyboard: Space picks a card up, ←/→ jump a whole column, Space or
 *    Enter drops, Escape cancels. Enter on a resting card opens it.
 *  - Moves go through `setLifecycle`, the same optimistic, synced path as
 *    the Status picker in the detail sheet — which stays the non-drag way
 *    to move a task.
 */

interface CardData {
  title: string;
  status: Lifecycle;
}

function cardData(active: Active): CardData {
  return active.data.current as CardData;
}

const COLUMN_WIDTH = "flex-1 basis-0 min-w-[80vw] sm:min-w-[260px] md:min-w-[212px] max-w-[340px]";
const COLUMN_IDLE = "border border-transparent bg-[var(--bg-sunken)]/70";
const COLUMN_OVER = "border border-[var(--border-strong)] bg-[var(--surface-muted)]";

const KEYBOARD_CODES: KeyboardCodes = {
  start: ["Space"],
  cancel: ["Escape", "Tab"],
  end: ["Space", "Enter"],
};

const DROP_ANIMATION: DropAnimation = {
  duration: 180,
  easing: "cubic-bezier(0.32, 0.72, 0.18, 1)",
};

const screenReaderInstructions = {
  draggable:
    "Press Enter to open this task. To move it, press Space, choose a column with the left and right arrow keys, then press Space again to drop it, or Escape to cancel.",
};

// Pointer drags target the column under the pointer, falling back to the
// most-overlapped column so a release in the gap between two columns still
// lands. Keyboard drags have no pointer and snap to column centers.
const collisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

/** ←/→ move the lifted card to the center of the neighboring column. */
const columnCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  if (event.code.startsWith("Arrow")) event.preventDefault();
  const step = event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0;
  const { collisionRect, droppableRects, over } = context;
  if (!step || !collisionRect || !over) return;

  const columns = [...droppableRects.entries()].sort(([, a], [, b]) => a.left - b.left);
  const index = columns.findIndex(([id]) => id === over.id);
  const target = index < 0 ? undefined : columns[index + step];
  if (!target) return;
  const [, rect] = target;
  return { x: rect.left + (rect.width - collisionRect.width) / 2, y: currentCoordinates.y };
};

export function TaskBoard({ onOpen }: { onOpen: (id: string) => void }) {
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);

  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);
  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : undefined;

  const announcements = useAnnouncements();
  const reducedMotion = usePrefersReducedMotion();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: KEYBOARD_CODES,
      coordinateGetter: columnCoordinates,
    }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    const to = over.id as Lifecycle;
    const task = useStore.getState().tasks.find((t) => t.id === active.id);
    if (task && task.lifecycle !== to) setLifecycle(task.id, to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {/* Bleeds to the edges of the page gutter so scrolled columns aren't
          clipped mid-card; the inner padding keeps the first column aligned
          with the page header. */}
      <div
        className={cn(
          "-mx-4 flex h-full select-none gap-2.5 overflow-x-auto px-4 pb-4",
          "sm:-mx-6 sm:px-6 md:-mx-8 md:px-8",
          // Snapping fights auto-scroll while a card is being dragged.
          activeId ? "snap-none" : "snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 md:snap-none",
        )}
      >
        {columns.map((column) => (
          <BoardColumnView
            key={column.status}
            column={column}
            labelMap={labelMap}
            onOpen={onOpen}
            dragging={activeId !== null}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={reducedMotion ? null : DROP_ANIMATION}>
        {activeTask ? <CardFace task={activeTask} labelMap={labelMap} lifted /> : null}
      </DragOverlay>
    </DndContext>
  );
}

export function TaskBoardSkeleton() {
  return (
    <div className="flex h-full gap-2.5 overflow-hidden pb-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={cn(
            COLUMN_WIDTH,
            "flex flex-col gap-1.5 rounded-[var(--radius-lg)] p-1.5",
            COLUMN_IDLE,
          )}
        >
          <Skeleton className="mx-1.5 mt-1.5 mb-1.5 h-3.5 w-20" />
          <Skeleton className="h-16 rounded-[var(--radius-md)]" />
          <Skeleton className="h-16 rounded-[var(--radius-md)]" />
        </div>
      ))}
    </div>
  );
}

function countLabel(n: number): string {
  return n === 1 ? "1 task" : `${n} tasks`;
}

const BoardColumnView = React.memo(function BoardColumnView({
  column,
  labelMap,
  onOpen,
  dragging,
}: {
  column: BoardColumn;
  labelMap: Map<string, Label>;
  onOpen: (id: string) => void;
  dragging: boolean;
}) {
  const { status, tasks } = column;
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const { label, description } = STATUS_META[status];
  const Icon = STATUS_ICONS[status];
  const headingId = React.useId();

  // Dropped is "kept for reference" — tucked into a rail (still a drop
  // target) the same way the Done page tucks it behind a disclosure.
  const [collapsed, setCollapsed] = React.useState(status === "dropped");
  // The rail button and the header button swap on toggle; hand focus to
  // whichever one mounts so the keyboard user isn't dropped to <body>.
  const focusToggle = React.useRef(false);
  const toggleRef = React.useCallback((el: HTMLButtonElement | null) => {
    if (!el || !focusToggle.current) return;
    focusToggle.current = false;
    el.focus();
  }, []);
  const toggle = () => {
    focusToggle.current = true;
    setCollapsed((v) => !v);
  };

  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        data-status={status}
        aria-label={label}
        className={cn(
          "flex w-11 shrink-0 snap-start rounded-[var(--radius-lg)]",
          "transition-colors duration-150 ease-[var(--ease-product)]",
          isOver ? COLUMN_OVER : COLUMN_IDLE,
        )}
      >
        <button
          ref={toggleRef}
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-label={`Show ${label}, ${countLabel(tasks.length)}`}
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-[var(--radius-lg)] py-3",
            "text-[var(--fg-muted)] transition-colors duration-150 ease-[var(--ease-product)]",
            "hover:bg-[var(--surface-hover)]/60 hover:text-[var(--fg)]",
          )}
        >
          <Icon size={14} className="opacity-80" />
          <span className="text-num text-[11.5px] text-[var(--fg-subtle)]">{tasks.length}</span>
          <span className="text-[12.5px] [writing-mode:vertical-rl]">{label}</span>
        </button>
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      data-status={status}
      aria-labelledby={headingId}
      className={cn(
        COLUMN_WIDTH,
        "flex snap-start flex-col rounded-[var(--radius-lg)]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        isOver ? COLUMN_OVER : COLUMN_IDLE,
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <Icon size={14} className="text-[var(--fg-muted)] opacity-80" />
        <h2 id={headingId} className="text-[13px] font-medium tracking-[-0.005em] text-[var(--fg)]">
          {label}
        </h2>
        <span className="text-num text-[11.5px] text-[var(--fg-subtle)]">
          {tasks.length}
          <span className="sr-only"> {tasks.length === 1 ? "task" : "tasks"}</span>
        </span>
        {status === "dropped" ? (
          <button
            ref={toggleRef}
            type="button"
            onClick={toggle}
            aria-expanded
            aria-label={`Hide ${label}`}
            className="ml-auto -mr-1 flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
          >
            <ChevronsRight size={13} />
          </button>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5">
        {tasks.map((task) => (
          <BoardCard key={task.id} task={task} labelMap={labelMap} onOpen={onOpen} />
        ))}
        {tasks.length === 0 ? (
          <p
            className={cn(
              "rounded-[var(--radius-md)] border border-dashed px-3 py-5 text-center text-[12px] leading-[1.45]",
              "transition-colors duration-150 ease-[var(--ease-product)]",
              dragging
                ? "border-[var(--border-strong)] text-[var(--fg-muted)]"
                : "border-[var(--border)] text-[var(--fg-subtle)]",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
    </section>
  );
});

const BoardCard = React.memo(function BoardCard({
  task,
  labelMap,
  onOpen,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { title: task.title, status: task.lifecycle } satisfies CardData,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        // While lifted, Enter belongs to the drag (it drops the card).
        if (e.key === "Enter" && !isDragging) {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn(
        "rounded-[var(--radius-md)] [-webkit-touch-callout:none] [touch-action:manipulation]",
        isDragging && "opacity-40",
      )}
    >
      <CardFace task={task} labelMap={labelMap} />
    </div>
  );
});

function CardFace({
  task,
  labelMap,
  lifted = false,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  lifted?: boolean;
}) {
  const taskLabels = task.labelIds.flatMap((id) => labelMap.get(id) ?? []);
  const dueLabel = formatRelativeDay(task.due);
  const dueTone = isOverdue(task.due) ? "rose" : isToday(task.due) ? "ember" : "neutral";
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const isDone = task.lifecycle === "done";

  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border bg-[var(--surface)] px-2.5 py-2",
        "transition-[border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
        lifted
          ? "cursor-grabbing border-[var(--border-strong)] shadow-[0_12px_28px_-12px_oklch(0%_0_0/0.35)]"
          : "cursor-grab border-[var(--border)] hover:border-[var(--border-strong)]",
      )}
    >
      <div className="flex items-start gap-2">
        <PriorityGlyph bucket={task.priorityBucket} className="mt-[3px] shrink-0" />
        <span
          className={cn(
            "min-w-0 flex-1 text-[13px] leading-[1.4] tracking-[-0.005em] line-clamp-3",
            isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5 empty:hidden">
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
        {assignee ? (
          <Badge tone="neutral" variant="outline" className="max-w-[120px]">
            <span className="truncate">{assignee}</span>
          </Badge>
        ) : null}
        {taskLabels.slice(0, 2).map((label) => (
          <Badge key={label.id} tone={label.tone}>
            {label.name}
          </Badge>
        ))}
        {taskLabels.length > 2 ? (
          <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
        ) : null}
        <AiStatusInline status={task.aiStatus} />
      </div>
    </div>
  );
}

/**
 * The first collision of every drag is the card's own column. Announcing
 * it would replace "Picked up …" in the live region before it is read, so
 * over-announcements start once the card has left its column.
 */
function useAnnouncements(): Announcements {
  return React.useMemo(() => {
    let left = false;
    return {
      onDragStart({ active }) {
        left = false;
        const { title, status } = cardData(active);
        return `Picked up ${title}, in ${statusLabel(status)}.`;
      },
      onDragOver({ active, over }) {
        if (!over) return "Not over a column.";
        if (!left && over.id === cardData(active).status) return undefined;
        left = true;
        return `Over ${statusLabel(over.id as Lifecycle)}.`;
      },
      onDragEnd({ active, over }) {
        const { title, status } = cardData(active);
        const to = over?.id as Lifecycle | undefined;
        return to && to !== status
          ? `Moved ${title} to ${statusLabel(to)}.`
          : `${title} stays in ${statusLabel(status)}.`;
      },
      onDragCancel({ active }) {
        const { title, status } = cardData(active);
        return `Move cancelled. ${title} stays in ${statusLabel(status)}.`;
      },
    };
  }, []);
}

/** dnd-kit animates the drop in JS, out of reach of the CSS reduced-motion rule. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

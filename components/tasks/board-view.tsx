"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { selectBoardColumns } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import * as React from "react";
import { BoardColumn, EMPTY_DROP_AREA_PX } from "./board-column";

export const BOARD_TITLE = "Everything, by status";
export const BOARD_DESCRIPTION =
  "Drag a card to another column to file it. Same order, words, and icons as the sidebar.";

/**
 * Board layout over the same tasks and the same `lifecycle` field as the
 * lists. Columns come from `STATUS_VIEWS`; cards come from the same
 * selectors as each status view, so List and Board never disagree on where
 * a task sits or in what order.
 *
 * Takes `tasks` and `onOpen` as props (like `TaskList`) rather than reading
 * the frame itself, so it renders in tests without `AppFrame`.
 */
export function BoardView({
  tasks,
  onOpen,
  onAdd,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  onAdd?: (lifecycle: Lifecycle) => void;
}) {
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const didInitialFocus = React.useRef(false);

  // Status a task had before this session completed it, so unchecking a
  // Done card puts it back where it came from. Unknown → Focus, matching
  // `TaskRow`'s `uncompleteTo` default.
  const priorRef = React.useRef(new Map<string, Lifecycle>());

  const setCardRef = React.useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  const hasTasks = columns.some((c) => c.tasks.length > 0);

  React.useEffect(() => {
    if (!hasTasks || didInitialFocus.current) return;
    didInitialFocus.current = true;
    containerRef.current?.focus({ preventScroll: true });
  }, [hasTasks]);

  const moveTask = React.useCallback(
    (id: string, to: Lifecycle) => {
      const task = useStore.getState().tasks.find((t) => t.id === id);
      if (!task || task.lifecycle === to) return;
      if (to === "done") priorRef.current.set(id, task.lifecycle);
      setLifecycle(id, to);
    },
    [setLifecycle],
  );

  const onComplete = React.useCallback(
    (id: string) => {
      const task = useStore.getState().tasks.find((t) => t.id === id);
      if (!task) return;
      if (task.lifecycle === "done") {
        moveTask(id, priorRef.current.get(id) ?? "active");
      } else {
        moveTask(id, "done");
      }
    },
    [moveTask],
  );

  const boardTop = useBoardTop(containerRef);

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Board"
      tabIndex={0}
      className="focus:outline-none"
      style={{ "--board-top": `${boardTop}px` } as React.CSSProperties}
    >
      <div
        className={cn(
          "flex gap-3 overflow-x-auto overscroll-x-contain pb-2",
          "-mx-4 px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0",
        )}
      >
        {columns.map((column) => (
          <BoardColumn
            key={column.status}
            column={column}
            labels={labels}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpen={onOpen}
            onComplete={onComplete}
            onAdd={onAdd}
            cardRef={setCardRef}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Columns scroll inside the viewport instead of growing the page. Their
 * max-height is `100dvh` minus where the board starts, which depends on
 * the header's wrapped height — so measure it rather than guess.
 */
function useBoardTop(ref: React.RefObject<HTMLElement | null>): number {
  const [top, setTop] = React.useState(260);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref]);
  return top;
}

const SKELETON_ROWS = ["a", "b", "c"] as const;

export function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden -mx-4 px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0">
      {STATUS_VIEWS.map((view, i) => (
        <div
          key={view.status}
          className="flex w-[288px] shrink-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-sunken)]/70 p-2 md:w-auto md:flex-1 md:basis-0 md:min-w-[188px] md:shrink"
          style={{ minHeight: EMPTY_DROP_AREA_PX + 40 }}
        >
          <div className="flex items-center gap-2 px-1 pt-0.5 pb-1">
            <Skeleton className="size-3.5 rounded" />
            <Skeleton className="h-3 w-14" />
          </div>
          {SKELETON_ROWS.slice(0, (i % 3) + 1).map((row) => (
            <div
              key={row}
              className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
            >
              <Skeleton className="h-3 w-[80%] mb-1.5" />
              <Skeleton className="h-2.5 w-[55%] mb-2.5" />
              <Skeleton className="h-4 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

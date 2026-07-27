"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Label, Lifecycle } from "@/lib/domain/types";
import { commitBoardMove } from "@/lib/store/board-move";
import { type BoardColumnData, selectBoardColumns } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardCard } from "./board-card";
import { BoardColumn } from "./board-column";
import { BoardKeyboardHint } from "./board-keyboard-hint";
import { MobileBoard } from "./move-to-sheet";

const HINT_STORAGE_KEY = "sifty.board.kbdhint-retired";
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "j", "k"]);

/**
 * The Board: every open task laid out by status.
 *
 * Board mode owns the whole pipeline — entering it from any of the five
 * status views shows all five `STATUS_VIEWS` columns, not just the one the
 * route names. It's a *view*: the same store, the same statuses, no new
 * enum, no migration. `updateTask({ lifecycle })` is the entire "move".
 */
export function BoardView() {
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const hydrated = useStore((s) => s.hydrated);
  const { openDetail } = useFrame();

  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);

  const [announcement, setAnnouncement] = React.useState("");

  const moveTask = React.useCallback((taskId: string, toStatus: Lifecycle) => {
    const message = commitBoardMove(taskId, toStatus);
    if (message) setAnnouncement(message);
  }, []);

  return (
    <div className="mt-4">
      {!hydrated ? (
        <BoardSkeleton />
      ) : (
        <>
          <div className="hidden md:flex md:flex-col">
            <DesktopBoard
              columns={columns}
              labels={labels}
              onOpen={openDetail}
              moveTask={moveTask}
            />
          </div>
          <div className="md:hidden">
            <MobileBoard
              columns={columns}
              labels={labels}
              onOpen={openDetail}
              moveTask={moveTask}
            />
          </div>
        </>
      )}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

function DesktopBoard({
  columns,
  labels,
  onOpen,
  moveTask,
}: {
  columns: BoardColumnData[];
  labels: Label[];
  onOpen: (id: string) => void;
  moveTask: (taskId: string, toStatus: Lifecycle) => void;
}) {
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
  const [hintVisible, setHintVisible] = React.useState(false);

  const cardRefs = React.useRef(new Map<string, HTMLDivElement | null>());
  const pendingFocus = React.useRef<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const didInitialFocus = React.useRef(false);

  const registerCard = React.useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  React.useEffect(() => {
    try {
      setHintVisible(window.localStorage.getItem(HINT_STORAGE_KEY) !== "1");
    } catch {
      setHintVisible(true);
    }
  }, []);

  const retireHint = React.useCallback(() => {
    setHintVisible(false);
    try {
      window.localStorage.setItem(HINT_STORAGE_KEY, "1");
    } catch {
      // best-effort; the hint simply reappears next session
    }
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const fallbackTabbableId = columns.find((c) => c.tasks.length > 0)?.tasks[0]?.id ?? null;

  const locate = React.useCallback(
    (taskId: string): { col: number; idx: number } | null => {
      for (let col = 0; col < columns.length; col++) {
        const idx = columns[col]?.tasks.findIndex((t) => t.id === taskId) ?? -1;
        if (idx >= 0) return { col, idx };
      }
      return null;
    },
    [columns],
  );

  const select = React.useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    pendingFocus.current = taskId;
  }, []);

  // Move real DOM focus to the selected card after every commit — including
  // after a file move re-parents the card into a new column.
  React.useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    cardRefs.current.get(id)?.focus({ preventScroll: false });
  });

  // Focus the board (not a card) once on mount so j/k and arrows work without
  // hunting for a tab stop — mirrors the list's autofocus, but leaves nothing
  // pre-selected so the first arrow makes the first, deliberate selection.
  React.useEffect(() => {
    if (didInitialFocus.current) return;
    didInitialFocus.current = true;
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (!selectedTaskId) return;
      e.preventDefault();
      onOpen(selectedTaskId);
      return;
    }
    if (!NAV_KEYS.has(e.key)) return;
    e.preventDefault();

    const loc = selectedTaskId ? locate(selectedTaskId) : null;
    if (!loc || !selectedTaskId) {
      if (fallbackTabbableId) select(fallbackTabbableId);
      return;
    }
    const { col, idx } = loc;
    const currentCol = columns[col];
    if (!currentCol) return;

    // Shift + ←/→ files the card into the adjacent column.
    if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const target = columns[col + dir];
      if (!target) return;
      pendingFocus.current = selectedTaskId; // focus follows the card
      moveTask(selectedTaskId, target.status);
      retireHint();
      return;
    }

    if (e.key === "ArrowDown" || e.key === "j") {
      const next = currentCol.tasks[Math.min(idx + 1, currentCol.tasks.length - 1)];
      if (next) select(next.id);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      const prev = currentCol.tasks[Math.max(idx - 1, 0)];
      if (prev) select(prev.id);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const dir = e.key === "ArrowRight" ? 1 : -1;
      let nc = col + dir;
      while (columns[nc]?.tasks.length === 0) nc += dir;
      const targetCol = columns[nc];
      if (targetCol && targetCol.tasks.length > 0) {
        const target = targetCol.tasks[Math.min(idx, targetCol.tasks.length - 1)];
        if (target) select(target.id);
      }
    }
  };

  // Keep the selection in lockstep with real DOM focus: a card reached by Tab
  // or click (not just the arrow keys) becomes the selected option, so Enter
  // and j/k act on whatever the user is actually focused on.
  const onFocusCapture = (e: React.FocusEvent) => {
    const id = (e.target as HTMLElement).dataset?.taskId;
    if (id) setSelectedTaskId(id);
  };

  const onDragStart = (e: DragStartEvent) => {
    setActiveDragId(String(e.active.id));
    setSelectedTaskId(String(e.active.id));
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const id = String(e.active.id);
    // Return focus to the dragged card so keyboard control continues from it.
    pendingFocus.current = id;
    if (e.over) moveTask(id, e.over.id as Lifecycle);
  };

  const activeTask = activeDragId
    ? columns.flatMap((c) => c.tasks).find((t) => t.id === activeDragId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveDragId(null)}
    >
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        onFocusCapture={onFocusCapture}
        tabIndex={-1}
        aria-label="Board"
        className="flex h-[calc(100dvh-196px)] min-h-[380px] gap-3 focus:outline-none"
      >
        {columns.map((column) => (
          <BoardColumn
            key={column.status}
            column={column}
            labels={labels}
            selectedTaskId={selectedTaskId}
            fallbackTabbableId={fallbackTabbableId}
            activeDragId={activeDragId}
            activeDragFromStatus={activeTask?.lifecycle ?? null}
            onOpen={onOpen}
            registerCard={registerCard}
          />
        ))}
      </div>

      {hintVisible ? (
        <div className="mt-3 flex justify-center">
          <BoardKeyboardHint />
        </div>
      ) : null}

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-[240px]">
            <BoardCard task={activeTask} labels={labels} overlay onOpen={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3">
      {STATUS_VIEWS.map((view) => (
        <div key={view.status} className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-6 items-center gap-1.5 px-1">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-3.5 w-20 rounded" />
          </div>
          <div className="mt-2 flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)]/40 p-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
              >
                <Skeleton className="h-3.5 w-[85%] rounded" />
                <Skeleton className="h-3 w-[60%] rounded" />
                <Skeleton className="mt-1 h-4 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

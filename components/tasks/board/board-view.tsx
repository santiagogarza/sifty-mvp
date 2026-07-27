"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { type BoardColumnData, selectBoardColumns } from "@/lib/store/selectors";
import { getSyncHooks, useStore } from "@/lib/store/store";
import { useServerSync } from "@/lib/store/sync";
import { cn } from "@/lib/utils/cn";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardCard } from "./board-card";
import { BoardColumn } from "./board-column";
import { BoardKeyboardHint } from "./board-keyboard-hint";
import { MoveToSheet } from "./move-to-sheet";
import { UndoPill } from "./undo-pill";
import { useBoardUndo } from "./use-board-undo";

export function BoardViewSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden pb-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="min-w-[260px] w-[260px] shrink-0">
          <Skeleton className="h-5 w-24 mb-3" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-[72px] rounded-[var(--radius-md)]" />
            <Skeleton className="h-[72px] rounded-[var(--radius-md)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BoardView() {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const updateTask = useStore((s) => s.updateTask);
  const sync = useServerSync();

  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);
  const totalTasks = columns.reduce((n, c) => n + c.tasks.length, 0);

  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
  const [colIndex, setColIndex] = React.useState(0);
  const [rowIndex, setRowIndex] = React.useState(0);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dropTargetStatus, setDropTargetStatus] = React.useState<Lifecycle | null>(null);
  const [dropPreviewCount, setDropPreviewCount] = React.useState<number | undefined>();
  const [moveSheetTask, setMoveSheetTask] = React.useState<Task | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [dirtyTaskId, setDirtyTaskId] = React.useState<string | null>(null);

  const boardRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const isMobile = useIsMobile();

  const { undoMove, registerMove, handleUndo } = useBoardUndo((move) => {
    updateTask(move.taskId, { lifecycle: move.prevLifecycle });
    announce(`Undid move to ${statusLabel(move.prevLifecycle)}`);
    focusTaskByStatus(move.taskId, move.prevLifecycle);
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const announce = React.useCallback((msg: string) => {
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(msg));
  }, []);

  const moveTask = React.useCallback(
    (taskId: string, toStatus: Lifecycle, opts?: { skipUndo?: boolean }) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.lifecycle === toStatus) return;

      const prevLifecycle = task.lifecycle;
      const prevCompletedAt = task.completedAt;

      updateTask(taskId, { lifecycle: toStatus });

      if (!opts?.skipUndo) {
        registerMove({ taskId, prevLifecycle, prevCompletedAt });
      }

      announce(`Moved to ${statusLabel(toStatus)}`);

      const hooks = getSyncHooks();
      if (hooks?.isTaskDirty(taskId)) {
        setDirtyTaskId(taskId);
      } else {
        void hooks?.waitForTask(taskId).then(() => {
          if (hooks.isTaskDirty(taskId)) setDirtyTaskId(taskId);
          else setDirtyTaskId((id) => (id === taskId ? null : id));
        });
      }
    },
    [tasks, updateTask, registerMove, announce],
  );

  React.useEffect(() => {
    if (!dirtyTaskId) return;
    const hooks = getSyncHooks();
    if (!hooks) return;
    const timer = setInterval(() => {
      if (!hooks.isTaskDirty(dirtyTaskId)) {
        setDirtyTaskId(null);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [dirtyTaskId]);

  const focusTask = React.useCallback((cIdx: number, rIdx: number, cols: BoardColumnData[]) => {
    const col = cols[cIdx];
    if (!col || col.tasks.length === 0) {
      setColIndex(cIdx);
      setRowIndex(0);
      setActiveTaskId(null);
      return;
    }
    const clampedRow = Math.max(0, Math.min(rIdx, col.tasks.length - 1));
    const task = col.tasks[clampedRow];
    setColIndex(cIdx);
    setRowIndex(clampedRow);
    setActiveTaskId(task?.id ?? null);
    if (task) {
      requestAnimationFrame(() => {
        cardRefs.current.get(task.id)?.focus({ preventScroll: true });
      });
    }
  }, []);

  const focusTaskByStatus = React.useCallback(
    (taskId: string, status: Lifecycle) => {
      const cols = selectBoardColumns(useStore.getState().tasks);
      const colIdx = cols.findIndex((c) => c.status === status);
      if (colIdx < 0) return;
      const rowIdx = cols[colIdx]?.tasks.findIndex((t) => t.id === taskId) ?? 0;
      focusTask(colIdx, Math.max(0, rowIdx), cols);
    },
    [focusTask],
  );

  React.useEffect(() => {
    if (activeTaskId) return;
    for (let ci = 0; ci < columns.length; ci++) {
      const column = columns[ci];
      if (column && column.tasks.length > 0) {
        focusTask(ci, 0, columns);
        return;
      }
    }
  }, [columns, activeTaskId, focusTask]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (totalTasks === 0) return;

    const shift = e.shiftKey;
    const col = columns[colIndex];
    if (!col) return;

    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      focusTask(colIndex, rowIndex + 1, columns);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      focusTask(colIndex, rowIndex - 1, columns);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (shift && activeTaskId) {
        const nextCol = Math.min(columns.length - 1, colIndex + 1);
        const toStatus = columns[nextCol]?.status;
        if (toStatus) {
          moveTask(activeTaskId, toStatus);
          focusTask(nextCol, rowIndex, selectBoardColumns(useStore.getState().tasks));
        }
      } else {
        focusTask(colIndex + 1, rowIndex, columns);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (shift && activeTaskId) {
        const prevCol = Math.max(0, colIndex - 1);
        const toStatus = columns[prevCol]?.status;
        if (toStatus) {
          moveTask(activeTaskId, toStatus);
          focusTask(prevCol, rowIndex, selectBoardColumns(useStore.getState().tasks));
        }
      } else {
        focusTask(colIndex - 1, rowIndex, columns);
      }
    } else if (e.key === "Enter" && activeTaskId) {
      e.preventDefault();
      openDetail(activeTaskId);
    }
  };

  const onDragStart = (event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  };

  const onDragOver = (event: DragOverEvent) => {
    const over = event.over;
    if (!over) {
      setDropTargetStatus(null);
      setDropPreviewCount(undefined);
      return;
    }
    const overId = String(over.id);
    if (overId.startsWith("column-")) {
      const status = overId.replace("column-", "") as Lifecycle;
      setDropTargetStatus(status);
      const col = columns.find((c) => c.status === status);
      const dragging = draggingId ? tasks.find((t) => t.id === draggingId) : null;
      if (col && dragging && dragging.lifecycle !== status) {
        setDropPreviewCount(col.tasks.length + 1);
      } else {
        setDropPreviewCount(col?.tasks.length);
      }
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    setDropTargetStatus(null);
    setDropPreviewCount(undefined);

    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const overId = String(over.id);
    if (!overId.startsWith("column-")) return;

    const toStatus = overId.replace("column-", "") as Lifecycle;
    moveTask(taskId, toStatus);
    focusTaskByStatus(taskId, toStatus);
  };

  const draggingTask = draggingId ? tasks.find((t) => t.id === draggingId) : null;

  const pillBottom = sync.error ? "bottom-[140px] md:bottom-16" : "bottom-[92px] md:bottom-4";

  const showUndo = !!undoMove;
  const showSavedLocally = dirtyTaskId !== null;
  const savedLocallyBottom = showUndo ? "bottom-[140px] md:bottom-16" : pillBottom;

  if (totalTasks === 0) {
    return null;
  }

  return (
    <div ref={boardRef} className="flex flex-col min-h-0">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {isMobile ? (
        <MobileStatusPager
          columns={columns}
          activeIndex={colIndex}
          onSelect={(i) => {
            setColIndex(i);
            scrollRef.current?.children[i]?.scrollIntoView({
              behavior: "smooth",
              inline: "center",
              block: "nearest",
            });
          }}
        />
      ) : null}

      <DndContext
        sensors={isMobile ? undefined : sensors}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div
          ref={scrollRef}
          className={cn(
            "flex gap-3 sm:gap-4 pb-4 outline-none",
            isMobile
              ? "overflow-x-auto snap-x snap-mandatory scroll-px-4 -mx-4 px-4"
              : "overflow-x-auto",
          )}
        >
          {columns.map((column, i) => (
            <BoardColumn
              key={column.status}
              column={column}
              labels={labels}
              columnIndex={i}
              activeTaskId={activeTaskId}
              activeTaskTabIndex={(taskId) => (activeTaskId === taskId ? 0 : -1)}
              isDropTarget={dropTargetStatus === column.status}
              dropPreviewCount={dropTargetStatus === column.status ? dropPreviewCount : undefined}
              onOpen={openDetail}
              onLongPress={isMobile ? setMoveSheetTask : undefined}
              onBoardKeyDown={onKeyDown}
              dragDisabled={isMobile}
              cardRef={(taskId) => (el) => {
                if (el) cardRefs.current.set(taskId, el);
                else cardRefs.current.delete(taskId);
              }}
            />
          ))}
        </div>

        {!isMobile && draggingTask ? (
          <DragOverlay dropAnimation={null}>
            <BoardCard task={draggingTask} labels={labels} onOpen={() => {}} dragDisabled />
          </DragOverlay>
        ) : null}
      </DndContext>

      <BoardKeyboardHint />

      {showUndo ? <UndoPill onUndo={handleUndo} className={pillBottom} /> : null}
      {showSavedLocally ? (
        <UndoPill onUndo={() => {}} savedLocally className={savedLocallyBottom} />
      ) : null}

      {moveSheetTask ? (
        <MoveToSheet
          open={!!moveSheetTask}
          onOpenChange={(open) => {
            if (!open) setMoveSheetTask(null);
          }}
          currentStatus={moveSheetTask.lifecycle}
          onMove={(status) => moveTask(moveSheetTask.id, status)}
        />
      ) : null}
    </div>
  );
}

function MobileStatusPager({
  columns,
  activeIndex,
  onSelect,
}: {
  columns: BoardColumnData[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1 md:hidden">
      {columns.map((col, i) => (
        <button
          key={col.status}
          type="button"
          onClick={() => onSelect(i)}
          className={cn(
            "shrink-0 rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
            i === activeIndex
              ? "bg-[var(--accent)] text-[var(--accent-fg)]"
              : "bg-[var(--surface-muted)] text-[var(--fg-muted)]",
          )}
        >
          {col.label}
          {col.tasks.length > 0 ? ` (${col.tasks.length})` : ""}
        </button>
      ))}
    </div>
  );
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

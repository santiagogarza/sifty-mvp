"use client";

import { STATUS_VIEWS, statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { selectBoardColumns } from "@/lib/store/selectors";
import { getSyncHooks, useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardColumn } from "./board-column";
import { BoardKeyboardHint } from "./board-keyboard-hint";
import { MoveToSheet } from "./move-to-sheet";
import { type BoardMove, UndoPill } from "./undo-pill";

const UNDO_MS = 6000;

export function BoardView({
  tasks,
  onOpen,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
}) {
  const allTasks = useStore((s) => s.tasks);
  const labels = useStore((s) => s.labels);
  const updateTask = useStore((s) => s.updateTask);
  const columns = React.useMemo(() => selectBoardColumns(allTasks), [allTasks]);
  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = React.useState<string | null>(null);
  const [overStatus, setOverStatus] = React.useState<Lifecycle | null>(null);
  const [move, setMove] = React.useState<BoardMove | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [hintDismissed, setHintDismissed] = React.useState(false);
  const [sheetTask, setSheetTask] = React.useState<Task | null>(null);
  const boardRef = React.useRef<HTMLDivElement | null>(null);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const activeTaskIdRef = React.useRef<string | null>(null);
  const columnsRef = React.useRef(columns);
  const lifecycleIntentRef = React.useRef(new Map<string, Lifecycle>());
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveRef = React.useRef<BoardMove | null>(null);
  columnsRef.current = columns;
  const activeLifecycle = activeTaskId
    ? (allTasks.find((task) => task.id === activeTaskId)?.lifecycle ?? null)
    : null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
  );

  const liveTasks = columns.flatMap((column) => column.tasks);

  const setActiveTask = React.useCallback((taskId: string | null) => {
    activeTaskIdRef.current = taskId;
    setActiveTaskId(taskId);
  }, []);

  React.useEffect(() => {
    if (activeTaskId && liveTasks.some((task) => task.id === activeTaskId)) return;
    setActiveTask(liveTasks[0]?.id ?? null);
  }, [activeTaskId, liveTasks, setActiveTask]);

  React.useLayoutEffect(() => {
    if (!activeTaskId || !activeLifecycle) return;
    cardRefs.current.get(activeTaskId)?.focus({ preventScroll: true });
  }, [activeTaskId, activeLifecycle]);

  React.useEffect(() => {
    moveRef.current = move;
  }, [move]);

  React.useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  const registerCard = React.useCallback((taskId: string, node: HTMLDivElement | null) => {
    if (node) cardRefs.current.set(taskId, node);
    else cardRefs.current.delete(taskId);
  }, []);

  const scheduleExpiry = React.useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setMove(null), UNDO_MS);
  }, []);

  const trackSync = React.useCallback((moveId: string, taskId: string) => {
    const hooks = getSyncHooks();
    if (!hooks) {
      setMove((current) => (current?.id === moveId ? { ...current, syncState: "saved" } : current));
      return;
    }
    void hooks.waitForTask(taskId).then(() => {
      setMove((current) => {
        if (current?.id !== moveId) return current;
        return { ...current, syncState: hooks.isTaskDirty(taskId) ? "local" : "saved" };
      });
    });
  }, []);

  const moveTask = React.useCallback(
    (task: Task, to: Lifecycle, source: "keyboard" | "pointer" | "sheet" = "pointer") => {
      if (task.lifecycle === to) return;
      const nextMove: BoardMove = {
        id: `${task.id}-${Date.now()}`,
        taskId: task.id,
        title: task.title,
        from: task.lifecycle,
        to,
        completedAt: task.completedAt,
        syncState: "saving",
      };
      updateTask(task.id, { lifecycle: to });
      lifecycleIntentRef.current.set(task.id, to);
      setActiveTask(task.id);
      setMove(nextMove);
      setAnnouncement(`${task.title} moved to ${statusLabel(to)}.`);
      if (source === "keyboard") setHintDismissed(true);
      scheduleExpiry();
      trackSync(nextMove.id, task.id);
    },
    [scheduleExpiry, setActiveTask, trackSync, updateTask],
  );

  const undo = React.useCallback(() => {
    const currentMove = moveRef.current;
    if (!currentMove) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    updateTask(currentMove.taskId, {
      lifecycle: currentMove.from,
      completedAt: currentMove.completedAt,
    });
    lifecycleIntentRef.current.set(currentMove.taskId, currentMove.from);
    getSyncHooks()
      ?.waitForTask(currentMove.taskId)
      .catch(() => {});
    setAnnouncement(`${currentMove.title} restored to ${statusLabel(currentMove.from)}.`);
    setActiveTask(currentMove.taskId);
    setMove(null);
  }, [setActiveTask, updateTask]);

  const onDragStart = React.useCallback(
    (event: DragStartEvent) => {
      setDragTaskId(String(event.active.id));
      setActiveTask(String(event.active.id));
    },
    [setActiveTask],
  );

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setDragTaskId(null);
      setOverStatus(null);
      const task = allTasks.find((candidate) => candidate.id === event.active.id);
      const to = event.over?.data.current?.lifecycle as Lifecycle | undefined;
      if (task && to) moveTask(task, to, "pointer");
    },
    [allTasks, moveTask],
  );

  const findPosition = React.useCallback((taskId: string | null) => {
    if (!taskId) return null;
    const currentColumns = columnsRef.current;
    for (let columnIndex = 0; columnIndex < currentColumns.length; columnIndex += 1) {
      const column = currentColumns[columnIndex];
      if (!column) continue;
      const taskIndex = column.tasks.findIndex((task) => task.id === taskId);
      if (taskIndex >= 0) return { columnIndex, taskIndex };
    }
    return null;
  }, []);

  const focusByDelta = React.useCallback(
    (taskId: string | null, columnDelta: number, taskDelta: number) => {
      const position = findPosition(taskId);
      if (!position) return;
      const currentColumns = columnsRef.current;
      const columnIndex = Math.min(
        Math.max(position.columnIndex + columnDelta, 0),
        currentColumns.length - 1,
      );
      const targetColumn = currentColumns[columnIndex];
      if (!targetColumn?.tasks.length) return;
      const taskIndex =
        columnDelta === 0
          ? Math.min(Math.max(position.taskIndex + taskDelta, 0), targetColumn.tasks.length - 1)
          : Math.min(position.taskIndex, targetColumn.tasks.length - 1);
      setActiveTask(targetColumn.tasks[taskIndex]?.id ?? null);
    },
    [findPosition, setActiveTask],
  );

  const fileByDelta = React.useCallback(
    (taskId: string | null, delta: number) => {
      if (!taskId) return;
      const task = useStore.getState().tasks.find((candidate) => candidate.id === taskId);
      const lifecycle = lifecycleIntentRef.current.get(taskId) ?? task?.lifecycle;
      const statusIndex = lifecycle
        ? STATUS_VIEWS.findIndex((view) => view.status === lifecycle)
        : -1;
      const target = STATUS_VIEWS[statusIndex + delta]?.status;
      if (task && target) moveTask(task, target, "keyboard");
    },
    [moveTask],
  );

  const handleBoardKeyDown = React.useCallback(
    (event: React.KeyboardEvent, sourceTaskId: string | null) => {
      if (!sourceTaskId) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();
        fileByDelta(sourceTaskId, 1);
      } else if (event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();
        fileByDelta(sourceTaskId, -1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        focusByDelta(sourceTaskId, 1, 0);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusByDelta(sourceTaskId, -1, 0);
      } else if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        focusByDelta(sourceTaskId, 0, 1);
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        focusByDelta(sourceTaskId, 0, -1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        onOpen(sourceTaskId);
      }
    },
    [fileByDelta, focusByDelta, onOpen, undo],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => handleBoardKeyDown(event, activeTaskIdRef.current),
    [handleBoardKeyDown],
  );

  React.useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const board = boardRef.current;
      if (!board || !target) return;
      const pageOwnsFocus = target === document.body || target === document.documentElement;
      if (!pageOwnsFocus && !board.contains(target)) return;
      if (target === board) return;
      if (
        target.closest(
          'a,button,input,textarea,select,[contenteditable="true"],[role="dialog"],[role="option"]',
        )
      ) {
        return;
      }
      handleBoardKeyDown(event as unknown as React.KeyboardEvent, activeTaskIdRef.current);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [handleBoardKeyDown]);

  const activeTask = dragTaskId ? allTasks.find((task) => task.id === dragTaskId) : null;

  return (
    <div ref={boardRef} className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between gap-3">
        <StatusPager columns={columns.map((column) => column.view)} />
        <BoardKeyboardHint hidden={hintDismissed} />
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragOver={(event) =>
          setOverStatus((event.over?.data.current?.lifecycle as Lifecycle | undefined) ?? null)
        }
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragTaskId(null);
          setOverStatus(null);
        }}
      >
        <div
          className={cn(
            "flex gap-3 overflow-x-auto pb-3 md:snap-none",
            "snap-x snap-mandatory scroll-px-4",
          )}
        >
          {columns.map((column) => (
            <BoardColumn
              key={column.view.status}
              status={column.view.status}
              label={column.view.label}
              tasks={column.tasks}
              labels={labels}
              activeTaskId={activeTaskId}
              preview={
                !!activeTask &&
                overStatus === column.view.status &&
                activeTask.lifecycle !== column.view.status
              }
              onOpen={onOpen}
              onLongPress={setSheetTask}
              onFocusTask={setActiveTask}
              onBoardKeyDown={(taskId, event) => handleBoardKeyDown(event, taskId)}
              registerCard={registerCard}
            />
          ))}
        </div>
      </DndContext>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <UndoPill
        move={move}
        onUndoIntent={() => {
          if (undoTimer.current) clearTimeout(undoTimer.current);
        }}
        onUndo={undo}
      />
      <MoveToSheet
        task={sheetTask}
        open={!!sheetTask}
        onOpenChange={(open) => {
          if (!open) setSheetTask(null);
        }}
        onMove={(task, lifecycle) => moveTask(task, lifecycle, "sheet")}
      />
    </div>
  );
}

function StatusPager({ columns }: { columns: typeof STATUS_VIEWS }) {
  return (
    <div className="flex gap-1 overflow-x-auto md:hidden" aria-label="Board statuses">
      {columns.map((column) => (
        <a
          key={column.status}
          href={`#board-${column.status}`}
          className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1 text-[12px] text-[var(--fg-muted)]"
        >
          {column.label}
        </a>
      ))}
    </div>
  );
}

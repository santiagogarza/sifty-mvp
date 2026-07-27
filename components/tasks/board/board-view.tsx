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
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
  );

  const liveTasks = tasks.length > 0 ? tasks : columns.flatMap((column) => column.tasks);

  React.useEffect(() => {
    if (activeTaskId && liveTasks.some((task) => task.id === activeTaskId)) return;
    setActiveTaskId(liveTasks[0]?.id ?? null);
  }, [activeTaskId, liveTasks]);

  React.useEffect(() => {
    if (!activeTaskId) return;
    cardRefs.current.get(activeTaskId)?.focus({ preventScroll: true });
  }, [activeTaskId]);

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
      setActiveTaskId(task.id);
      setMove(nextMove);
      setAnnouncement(`${task.title} moved to ${statusLabel(to)}.`);
      if (source === "keyboard") setHintDismissed(true);
      scheduleExpiry();
      trackSync(nextMove.id, task.id);
    },
    [scheduleExpiry, trackSync, updateTask],
  );

  const undo = React.useCallback(() => {
    if (!move) return;
    updateTask(move.taskId, { lifecycle: move.from, completedAt: move.completedAt });
    setAnnouncement(`${move.title} restored to ${statusLabel(move.from)}.`);
    setActiveTaskId(move.taskId);
    setMove(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, [move, updateTask]);

  const onDragStart = React.useCallback((event: DragStartEvent) => {
    setDragTaskId(String(event.active.id));
    setActiveTaskId(String(event.active.id));
  }, []);

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

  const findPosition = React.useCallback(
    (taskId: string | null) => {
      if (!taskId) return null;
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        const column = columns[columnIndex];
        if (!column) continue;
        const taskIndex = column.tasks.findIndex((task) => task.id === taskId);
        if (taskIndex >= 0) return { columnIndex, taskIndex };
      }
      return null;
    },
    [columns],
  );

  const focusByDelta = React.useCallback(
    (columnDelta: number, taskDelta: number) => {
      const position = findPosition(activeTaskId);
      if (!position) return;
      const columnIndex = Math.min(
        Math.max(position.columnIndex + columnDelta, 0),
        columns.length - 1,
      );
      const targetColumn = columns[columnIndex];
      if (!targetColumn?.tasks.length) return;
      const taskIndex =
        columnDelta === 0
          ? Math.min(Math.max(position.taskIndex + taskDelta, 0), targetColumn.tasks.length - 1)
          : Math.min(position.taskIndex, targetColumn.tasks.length - 1);
      setActiveTaskId(targetColumn.tasks[taskIndex]?.id ?? null);
    },
    [activeTaskId, columns, findPosition],
  );

  const fileByDelta = React.useCallback(
    (delta: number) => {
      const position = findPosition(activeTaskId);
      if (!position) return;
      const sourceColumn = columns[position.columnIndex];
      const task = sourceColumn?.tasks[position.taskIndex];
      const target = columns[position.columnIndex + delta]?.view.status;
      if (task && target) moveTask(task, target, "keyboard");
    },
    [activeTaskId, columns, findPosition, moveTask],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (!activeTaskId) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();
        fileByDelta(1);
      } else if (event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();
        fileByDelta(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        focusByDelta(1, 0);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusByDelta(-1, 0);
      } else if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        focusByDelta(0, 1);
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        focusByDelta(0, -1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        onOpen(activeTaskId);
      }
    },
    [activeTaskId, fileByDelta, focusByDelta, onOpen, undo],
  );

  const activeTask = dragTaskId ? allTasks.find((task) => task.id === dragTaskId) : null;

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
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
              onFocusTask={setActiveTaskId}
              registerCard={registerCard}
            />
          ))}
        </div>
      </DndContext>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <UndoPill move={move} onUndo={undo} />
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

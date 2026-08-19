"use client";

import { Button } from "@/components/ui/button";
import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { partitionByLifecycle, staysVisibleOnBoard } from "@/lib/store/board";
import { useStore } from "@/lib/store/store";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";
import { BoardColumn } from "./board-column";
import { TaskCard } from "./task-card";

export function TaskBoard({
  tasks,
  onOpen,
  isTodayBoard,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  isTodayBoard?: boolean;
}) {
  const updateTask = useStore((s) => s.updateTask);
  const labels = useStore((s) => s.labels);

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [showDropped, setShowDropped] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
  );

  const columnsToRender = React.useMemo(() => {
    if (isTodayBoard) {
      return ["inbox", "active", "waiting"] as Lifecycle[];
    }
    return STATUSES_IN_ORDER;
  }, [isTodayBoard]);

  const partitions = React.useMemo(
    () => partitionByLifecycle(tasks, {}, columnsToRender, isTodayBoard),
    [tasks, columnsToRender, isTodayBoard],
  );

  const activeTask = React.useMemo(() => tasks.find((t) => t.id === activeId), [tasks, activeId]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setSelectedId(event.active.id as string);
  };

  const applyLifecycle = React.useCallback(
    (task: Task, lifecycle: Lifecycle) => {
      if (task.lifecycle === lifecycle) return;
      if (!staysVisibleOnBoard(task, lifecycle, Boolean(isTodayBoard))) return;
      updateTask(task.id, { lifecycle });
    },
    [isTodayBoard, updateTask],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;

    if (over?.id) {
      const targetLifecycle = over.id as Lifecycle;
      const task = active.data.current?.task as Task;
      if (task) applyLifecycle(task, targetLifecycle);
    }
  };

  // Keyboard navigation
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't interfere with inputs
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.hasAttribute("contenteditable")
      ) {
        return;
      }

      if (!selectedId) {
        if (e.key === "ArrowDown" || e.key === "j" || e.key === "ArrowRight" || e.key === "l") {
          e.preventDefault();
          const firstCol = columnsToRender.find((col) => partitions[col]?.length > 0);
          if (firstCol) {
            const firstTask = partitions[firstCol]?.[0];
            if (firstTask) setSelectedId(firstTask.id);
          }
        }
        return;
      }

      const currentTask = tasks.find((t) => t.id === selectedId);
      if (!currentTask) return;

      const currentColumn = currentTask.lifecycle;
      const columnIndex = columnsToRender.indexOf(currentColumn);
      if (columnIndex === -1) return;

      const columnTasks = partitions[currentColumn];
      if (!columnTasks) return;
      const taskIndex = columnTasks.findIndex((t) => t.id === selectedId);

      if (e.key === "Enter") {
        e.preventDefault();
        onOpen(selectedId);
        return;
      }

      if (e.altKey || e.metaKey) {
        if (e.key === "ArrowLeft" && columnIndex > 0) {
          e.preventDefault();
          const target = columnsToRender[columnIndex - 1];
          if (target) applyLifecycle(currentTask, target);
        } else if (e.key === "ArrowRight" && columnIndex < columnsToRender.length - 1) {
          e.preventDefault();
          const target = columnsToRender[columnIndex + 1];
          if (target) applyLifecycle(currentTask, target);
        }
        return;
      }

      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        if (taskIndex > 0) {
          const t = columnTasks[taskIndex - 1];
          if (t) setSelectedId(t.id);
        }
      } else if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        if (taskIndex < columnTasks.length - 1) {
          const t = columnTasks[taskIndex + 1];
          if (t) setSelectedId(t.id);
        }
      } else if (e.key === "ArrowLeft" || e.key === "h") {
        e.preventDefault();
        if (columnIndex > 0) {
          const prevColKey = columnsToRender[columnIndex - 1];
          if (prevColKey) {
            const prevCol = partitions[prevColKey];
            if (prevCol && prevCol.length > 0) {
              const t = prevCol[Math.min(taskIndex, prevCol.length - 1)];
              if (t) setSelectedId(t.id);
            }
          }
        }
      } else if (e.key === "ArrowRight" || e.key === "l") {
        e.preventDefault();
        if (columnIndex < columnsToRender.length - 1) {
          const nextColKey = columnsToRender[columnIndex + 1];
          if (nextColKey) {
            const nextCol = partitions[nextColKey];
            if (nextCol && nextCol.length > 0) {
              const t = nextCol[Math.min(taskIndex, nextCol.length - 1)];
              if (t) setSelectedId(t.id);
            }
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, tasks, columnsToRender, partitions, onOpen, applyLifecycle]);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex-1 overflow-x-auto overflow-y-hidden touch-pan-x">
        <div className="flex h-full gap-4 px-4 pb-4 w-max">
          {columnsToRender.map((col) => {
            if (col === "dropped" && !showDropped) {
              return null;
            }

            const colTasks = partitions[col];
            return (
              <BoardColumn key={col} id={col} count={colTasks.length}>
                {colTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    labels={labels}
                    onOpen={onOpen}
                    onSelect={setSelectedId}
                    active={t.id === selectedId}
                  />
                ))}
                {col === "done" && !isTodayBoard && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-2 text-[var(--fg-muted)] hover:text-[var(--fg)] justify-start px-2"
                    onClick={() => setShowDropped(!showDropped)}
                  >
                    {showDropped ? (
                      <ChevronDown size={14} className="mr-2" />
                    ) : (
                      <ChevronRight size={14} className="mr-2" />
                    )}
                    {showDropped ? "Hide dropped" : "Show dropped"}
                  </Button>
                )}
              </BoardColumn>
            );
          })}
        </div>
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCard task={activeTask} labels={labels} onOpen={onOpen} isOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

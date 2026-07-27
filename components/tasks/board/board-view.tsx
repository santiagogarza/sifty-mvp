"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_META, STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { selectBoardColumns } from "@/lib/store/selectors";
import { getSyncHooks, useStore } from "@/lib/store/store";
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
import { UndoPill } from "./undo-pill";

const UNDO_MS = 6000;

interface MoveRecord {
  taskId: string;
  from: Lifecycle;
  to: Lifecycle;
  completedAt: string | null;
}

export function BoardView({ onOpen }: { onOpen: (id: string) => void }) {
  const tasks = useStore((state) => state.tasks);
  const labels = useStore((state) => state.labels);
  const updateTask = useStore((state) => state.updateTask);
  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [draggingFrom, setDraggingFrom] = React.useState<Lifecycle | null>(null);
  const [moveRecord, setMoveRecord] = React.useState<MoveRecord | null>(null);
  const [feedback, setFeedback] = React.useState("");
  const [announcement, setAnnouncement] = React.useState("");
  const [sheetTask, setSheetTask] = React.useState<Task | null>(null);
  const [mobileStatus, setMobileStatus] = React.useState<Lifecycle>("inbox");
  const [hintVisible, setHintVisible] = React.useState(true);
  const mobile = useMobile();
  const boardRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  React.useEffect(() => {
    setHintVisible(window.localStorage.getItem("sifty.board.keyboard-hint") !== "dismissed");
  }, []);

  React.useEffect(() => {
    if (!activeId && columns.some((column) => column.tasks.length > 0)) {
      setActiveId(columns.find((column) => column.tasks.length > 0)?.tasks[0]?.id ?? null);
    }
  }, [activeId, columns]);

  React.useEffect(() => {
    if (!activeId) return;
    requestAnimationFrame(() => cardRefs.current.get(activeId)?.focus({ preventScroll: true }));
  }, [activeId]);

  React.useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const moveTask = React.useCallback(
    (task: Task, to: Lifecycle, source: "drag" | "keyboard" | "mobile") => {
      if (task.lifecycle === to) return;
      const record: MoveRecord = {
        taskId: task.id,
        from: task.lifecycle,
        to,
        completedAt: task.completedAt,
      };
      updateTask(task.id, { lifecycle: to });
      setActiveId(task.id);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => cardRefs.current.get(task.id)?.focus({ preventScroll: true }));
      });
      setMoveRecord(record);
      setFeedback(`Moved to ${STATUS_META[to].label}`);
      setAnnouncement(`${task.title} moved to ${STATUS_META[to].label}`);
      if (source === "keyboard") {
        setHintVisible(false);
        window.localStorage.setItem("sifty.board.keyboard-hint", "dismissed");
      }
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setMoveRecord(null), UNDO_MS);

      const hooks = getSyncHooks();
      if (hooks) {
        void hooks.waitForTask(task.id).then(() => {
          if (hooks.isTaskDirty(task.id)) {
            setFeedback("Saved locally — Sifty will sync it");
          }
        });
      }
    },
    [updateTask],
  );

  const undo = React.useCallback(() => {
    if (!moveRecord) return;
    const task = useStore.getState().tasks.find((item) => item.id === moveRecord.taskId);
    if (!task) return;
    updateTask(task.id, {
      lifecycle: moveRecord.from,
      completedAt: moveRecord.completedAt,
    });
    setActiveId(task.id);
    setAnnouncement(`${task.title} returned to ${STATUS_META[moveRecord.from].label}`);
    setMoveRecord(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, [moveRecord, updateTask]);

  const findPosition = React.useCallback(
    (id: string | null) => {
      if (!id) return null;
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
        const column = columns[columnIndex];
        if (!column) continue;
        const rowIndex = column.tasks.findIndex((task) => task.id === id);
        if (rowIndex >= 0) return { columnIndex, rowIndex };
      }
      return null;
    },
    [columns],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (
      event.target instanceof HTMLElement &&
      ["BUTTON", "INPUT", "TEXTAREA"].includes(event.target.tagName)
    ) {
      return;
    }
    const position = findPosition(activeId);
    if (!position) return;
    const { columnIndex, rowIndex } = position;
    const column = columns[columnIndex];
    const task = column?.tasks[rowIndex];
    if (!column || !task) return;

    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(task.id);
      return;
    }
    if (
      event.key === "ArrowDown" ||
      event.key === "j" ||
      event.key === "ArrowUp" ||
      event.key === "k"
    ) {
      event.preventDefault();
      const delta = event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
      const nextIndex = Math.max(0, Math.min(column.tasks.length - 1, rowIndex + delta));
      const nextTask = column.tasks[nextIndex];
      if (nextTask) setActiveId(nextTask.id);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const targetIndex = columnIndex + delta;
    if (targetIndex < 0 || targetIndex >= columns.length) return;
    const targetColumn = columns[targetIndex];
    if (!targetColumn) return;
    if (event.shiftKey) {
      moveTask(task, targetColumn.status, "keyboard");
      return;
    }
    let candidateIndex = targetIndex;
    while (
      candidateIndex >= 0 &&
      candidateIndex < columns.length &&
      columns[candidateIndex]?.tasks.length === 0
    ) {
      candidateIndex += delta;
    }
    const target = columns[candidateIndex]?.tasks;
    const targetTask = target?.[Math.min(rowIndex, target.length - 1)];
    if (targetTask) setActiveId(targetTask.id);
  };

  const onDragStart = (event: DragStartEvent) => {
    const task = tasks.find((item) => item.id === event.active.id);
    setDraggingFrom(task?.lifecycle ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDraggingFrom(null);
    const task = tasks.find((item) => item.id === event.active.id);
    const to = event.over?.id as Lifecycle | undefined;
    if (task && to && STATUS_VIEWS.some((view) => view.status === to)) moveTask(task, to, "drag");
  };

  return (
    <>
      <div
        className="mb-2 flex gap-1 overflow-x-auto pb-1 md:hidden"
        aria-label="Board status pager"
      >
        {STATUS_VIEWS.map(({ status, label }) => (
          <button
            key={status}
            type="button"
            onClick={() => {
              setMobileStatus(status);
              boardRef.current
                ?.querySelector<HTMLElement>(`[data-status="${status}"]`)
                ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
            }}
            className={
              mobileStatus === status
                ? "shrink-0 rounded-full bg-[var(--fg)] px-3 py-1 text-[11px] text-[var(--bg)]"
                : "shrink-0 rounded-full bg-[var(--surface-muted)] px-3 py-1 text-[11px] text-[var(--fg-muted)]"
            }
          >
            {label}
          </button>
        ))}
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragCancel={() => setDraggingFrom(null)}
        onDragEnd={onDragEnd}
      >
        <div
          ref={boardRef}
          role="application"
          onKeyDown={onKeyDown}
          onScroll={(event) => {
            if (!mobile) return;
            const viewport = event.currentTarget.getBoundingClientRect();
            const center = viewport.left + viewport.width / 2;
            let nearest: { status: Lifecycle; distance: number } | null = null;
            for (const element of event.currentTarget.querySelectorAll<HTMLElement>(
              "[data-status]",
            )) {
              const rect = element.getBoundingClientRect();
              const distance = Math.abs(rect.left + rect.width / 2 - center);
              const status = element.dataset.status as Lifecycle;
              if (!nearest || distance < nearest.distance) nearest = { status, distance };
            }
            if (nearest) setMobileStatus(nearest.status);
          }}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 focus:outline-none md:gap-2"
          aria-label="Task board"
        >
          {columns.map((column) => (
            <BoardColumn
              key={column.status}
              {...column}
              labels={labels}
              activeId={activeId}
              draggingFrom={draggingFrom}
              mobile={mobile}
              onOpen={onOpen}
              onFocus={setActiveId}
              onLongPress={setSheetTask}
              registerRef={(id, element) => {
                if (element) cardRefs.current.set(id, element);
                else cardRefs.current.delete(id);
              }}
            />
          ))}
        </div>
      </DndContext>
      {hintVisible ? <BoardKeyboardHint /> : null}
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
      {moveRecord ? <UndoPill message={feedback} onUndo={undo} /> : null}
      <MoveToSheet
        task={sheetTask}
        onClose={() => setSheetTask(null)}
        onMove={(task, status) => {
          moveTask(task, status, "mobile");
          setSheetTask(null);
        }}
      />
    </>
  );
}

export function BoardSkeleton() {
  return (
    <div className="flex gap-2 overflow-hidden" aria-label="Loading board">
      {STATUS_VIEWS.map(({ status }) => (
        <div
          key={status}
          className="h-[420px] min-w-[178px] flex-1 rounded-[var(--radius-lg)] bg-[var(--surface-muted)] p-2"
        >
          <div className="mb-3 flex items-center gap-2 px-1">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="mb-2 h-[78px] rounded-[var(--radius-md)]" />
          ))}
        </div>
      ))}
    </div>
  );
}

function useMobile(): boolean {
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

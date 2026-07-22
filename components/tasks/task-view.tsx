"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { Columns3, List } from "lucide-react";
import * as React from "react";
import { TaskEmptyState } from "./empty-state";
import { TaskBoard } from "./task-board";
import { TaskList } from "./task-list";

type ViewMode = "list" | "board";

const VIEW_MODE_STORAGE_KEY = "sifty-task-view-mode";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 */
export function TaskView({
  eyebrow,
  title,
  description,
  selector,
  emptyTitle,
  emptyDescription,
  rightSlot,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const [viewMode, setViewMode] = React.useState<ViewMode>("list");
  const [viewModeLoaded, setViewModeLoaded] = React.useState(false);

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);
  const boardTasks = React.useMemo(
    () => tasks.filter((task) => task.lifecycle !== "dropped"),
    [tasks],
  );

  React.useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored === "list" || stored === "board") setViewMode(stored);
    setViewModeLoaded(true);
  }, []);

  const updateViewMode = React.useCallback((mode: ViewMode) => {
    setViewMode(mode);
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  }, []);

  const actions = (
    <>
      {rightSlot}
      <TaskViewToggle value={viewMode} onChange={updateViewMode} disabled={!viewModeLoaded} />
    </>
  );

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {!hydrated ? (
        <TaskListSkeleton />
      ) : viewMode === "board" ? (
        <TaskBoard tasks={boardTasks} onOpen={openDetail} />
      ) : (
        <TaskList
          tasks={visible}
          onOpen={openDetail}
          emptyState={<TaskEmptyState title={emptyTitle} description={emptyDescription} />}
        />
      )}
    </>
  );
}

function TaskViewToggle({
  value,
  onChange,
  disabled,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  disabled: boolean;
}) {
  return (
    <div
      className="inline-flex rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
      role="group"
      aria-label="Task view"
    >
      <ViewModeButton
        label="List"
        active={value === "list"}
        disabled={disabled}
        onClick={() => onChange("list")}
      >
        <List size={13} />
      </ViewModeButton>
      <ViewModeButton
        label="Board"
        active={value === "board"}
        disabled={disabled}
        onClick={() => onChange("board")}
      >
        <Columns3 size={13} />
      </ViewModeButton>
    </div>
  );
}

function ViewModeButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={`${label} view`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-[12px]",
        "text-[var(--fg-muted)] transition-colors duration-150 ease-[var(--ease-product)]",
        "hover:text-[var(--fg)] disabled:opacity-50",
        active && "bg-[var(--surface)] text-[var(--fg)] shadow-[0_1px_1px_oklch(0%_0_0/0.04)]",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function TaskListSkeleton() {
  return (
    <div className="flex flex-col">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="size-3.5 rounded" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-[60%] mb-1.5" />
            <Skeleton className="h-3 w-[40%]" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

"use client";

import type { Task } from "@/lib/types";

const priorityColor: Record<string, string> = {
  high: "text-[var(--color-urgent)]",
  medium: "text-[var(--color-muted)]",
  low: "text-[var(--color-muted)]",
};

export function TaskCard({
  task,
  onComplete,
  onDelete,
}: {
  task: Task;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const done = task.status === "done";
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-accent)]/50">
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-label={done ? "Completed" : "Mark complete"}
          onClick={() => onComplete(task.id)}
          className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border ${
            done
              ? "border-[var(--color-success)] bg-[var(--color-success)]"
              : "border-[var(--color-muted)] hover:border-[var(--color-accent)]"
          }`}
        />
        <div className="min-w-0 flex-1">
          <p
            className={`font-medium leading-snug ${
              done ? "text-[var(--color-muted)] line-through" : "text-[var(--color-fg)]"
            }`}
          >
            {task.title}
          </p>

          {task.aiStatus === "processing" ? (
            <p className="mt-1 text-sm text-[var(--color-accent)]">AI organizing…</p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {task.labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[var(--color-muted)]"
                >
                  {label}
                </span>
              ))}
              {task.urgency && (
                <span className={priorityColor[task.urgency]}>urgency: {task.urgency}</span>
              )}
              {task.effort && (
                <span className="text-[var(--color-muted)]">effort: {task.effort}</span>
              )}
              {task.confidence !== null && (
                <span className="text-[var(--color-muted)]">
                  confidence: {Math.round(task.confidence * 100)}%
                </span>
              )}
            </div>
          )}

          {task.nextAction && task.aiStatus === "done" && (
            <p className="mt-2 text-sm text-[var(--color-muted)]">→ {task.nextAction}</p>
          )}
        </div>

        <button
          type="button"
          aria-label="Delete task"
          onClick={() => onDelete(task.id)}
          className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-urgent)]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

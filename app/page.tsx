"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TaskCard } from "@/components/task-card";
import type { Task } from "@/lib/types";

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/tasks");
    const data = (await res.json()) as { tasks: Task[] };
    setTasks(data.tasks);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const capture = useCallback(async () => {
    const sourceText = draft.trim();
    if (sourceText.length === 0) return;
    setSubmitting(true);
    setDraft("");

    // Instant capture: create the task immediately.
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceText }),
    });
    const { task } = (await res.json()) as { task: Task };
    await refresh();
    setSubmitting(false);
    inputRef.current?.focus();

    // Non-blocking enrichment: triage in the background, then refresh.
    void fetch(`/api/tasks/${task.id}/triage`, { method: "POST" }).then(() => refresh());
  }, [draft, refresh]);

  const complete = useCallback(
    async (id: string) => {
      const target = tasks.find((t) => t.id === id);
      const nextStatus = target?.status === "done" ? "inbox" : "done";
      await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      await refresh();
    },
    [tasks, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void capture();
    }
  };

  const active = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sifty</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Capture anything. AI organizes it for you.
        </p>
      </header>

      <section className="mb-10 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Thing I need to do… (⌘/Ctrl + Enter to capture)"
          rows={2}
          className="w-full resize-none bg-transparent text-base text-[var(--color-fg)] outline-none placeholder:text-[var(--color-muted)]"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => void capture()}
            disabled={submitting || draft.trim().length === 0}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-fg)] transition-opacity disabled:opacity-40"
          >
            {submitting ? "Capturing…" : "Quick Add"}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
          Tasks
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            Nothing captured yet. Add your first task above.
          </p>
        ) : (
          active.map((task) => (
            <TaskCard key={task.id} task={task} onComplete={complete} onDelete={remove} />
          ))
        )}
      </section>

      {done.length > 0 && (
        <section className="mt-8 space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
            Done
          </h2>
          {done.map((task) => (
            <TaskCard key={task.id} task={task} onComplete={complete} onDelete={remove} />
          ))}
        </section>
      )}
    </main>
  );
}

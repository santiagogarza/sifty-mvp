import type { Lifecycle, Task } from "@/lib/domain/types";
import type { SyncHooks } from "@/lib/store/store";
import { registerSyncHooks, useStore } from "@/lib/store/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Status transitions go through `setLifecycle` → `updateTask`. Moving to
 * `done` stamps `completedAt` once; any other status clears it. The board
 * drag calls this same path, so a bad stamp shows up as a reshuffled Done
 * column after the card lands.
 */

const T0 = "2026-07-22T12:00:00.000Z";
const T1 = "2026-07-22T15:00:00.000Z";
const T2 = "2026-07-23T09:00:00.000Z";

function hooks(partial: Partial<SyncHooks> = {}): SyncHooks {
  return {
    taskUpserted() {},
    taskDeleted() {},
    labelEnsured() {},
    memoryUpserted() {},
    memoryDeleted() {},
    async waitForTask() {},
    isTaskDirty: () => false,
    ...partial,
  };
}

function taskById(id: string): Task {
  const task = useStore.getState().tasks.find((t) => t.id === id);
  if (!task) throw new Error(`missing task ${id}`);
  return task;
}

describe("setLifecycle", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    // Persist has no localStorage under node and warns on every write.
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useStore.setState({ tasks: [], hydrated: true });
    registerSyncHooks(null);
  });

  afterEach(() => {
    registerSyncHooks(null);
    useStore.setState({ tasks: [] });
    warn.mockRestore();
    vi.useRealTimers();
  });

  it("moves an inbox task to focus without stamping a completion time", () => {
    const created = useStore.getState().createTask({ sourceText: "Draft the launch note" });
    vi.setSystemTime(new Date(T1));

    useStore.getState().setLifecycle(created.id, "active");

    const task = taskById(created.id);
    expect(task.lifecycle).toBe("active");
    expect(task.completedAt).toBeNull();
    expect(task.updatedAt).toBe(T1);
  });

  it("stamps completedAt when the task moves to done", () => {
    const created = useStore.getState().createTask({ sourceText: "Send the investor update" });
    vi.setSystemTime(new Date(T1));

    useStore.getState().setLifecycle(created.id, "done");

    const task = taskById(created.id);
    expect(task.lifecycle).toBe("done");
    expect(task.completedAt).toBe(T1);
    expect(task.updatedAt).toBe(T1);
  });

  it("clears completedAt when a finished task leaves done", () => {
    const destinations: Lifecycle[] = ["inbox", "active", "waiting", "someday", "dropped"];
    for (const lifecycle of destinations) {
      const created = useStore.getState().createTask({ sourceText: `Leave done for ${lifecycle}` });
      useStore.getState().setLifecycle(created.id, "done");
      vi.setSystemTime(new Date(T1));

      useStore.getState().setLifecycle(created.id, lifecycle);

      const task = taskById(created.id);
      expect(task.lifecycle).toBe(lifecycle);
      expect(task.completedAt).toBeNull();
    }
  });

  it("keeps the original completion stamp when done is applied again", () => {
    const created = useStore.getState().createTask({ sourceText: "File the receipt" });
    useStore.getState().setLifecycle(created.id, "done");
    expect(taskById(created.id).completedAt).toBe(T0);

    vi.setSystemTime(new Date(T1));
    useStore.getState().setLifecycle(created.id, "done");

    const task = taskById(created.id);
    expect(task.lifecycle).toBe("done");
    expect(task.completedAt).toBe(T0);
    expect(task.updatedAt).toBe(T1);
  });

  it("stamps a new completion time when a reopened task is finished again", () => {
    const created = useStore.getState().createTask({ sourceText: "Rewrite the outline" });
    useStore.getState().setLifecycle(created.id, "done");
    vi.setSystemTime(new Date(T1));
    useStore.getState().setLifecycle(created.id, "active");
    expect(taskById(created.id).completedAt).toBeNull();

    vi.setSystemTime(new Date(T2));
    useStore.getState().setLifecycle(created.id, "done");

    const task = taskById(created.id);
    expect(task.lifecycle).toBe("done");
    expect(task.completedAt).toBe(T2);
  });

  it("leaves a finished task's stamp in place when a non-status field changes", () => {
    const created = useStore.getState().createTask({ sourceText: "Book the venue" });
    useStore.getState().setLifecycle(created.id, "done");
    vi.setSystemTime(new Date(T1));

    useStore.getState().updateTask(created.id, { title: "Book the smaller venue" });

    const task = taskById(created.id);
    expect(task.title).toBe("Book the smaller venue");
    expect(task.lifecycle).toBe("done");
    expect(task.completedAt).toBe(T0);
  });

  it("does nothing when the task id does not exist", () => {
    const seen: string[] = [];
    registerSyncHooks(
      hooks({
        taskUpserted(task) {
          seen.push(task.id);
        },
      }),
    );

    useStore.getState().setLifecycle("task_missing", "done");

    expect(useStore.getState().tasks).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("notifies sync with the task after the status change", () => {
    const seen: Array<{ id: string; lifecycle: Lifecycle; created: boolean }> = [];
    registerSyncHooks(
      hooks({
        taskUpserted(task, opts) {
          seen.push({ id: task.id, lifecycle: task.lifecycle, created: opts.created });
        },
      }),
    );
    const created = useStore.getState().createTask({ sourceText: "Ask for the intro" });
    vi.setSystemTime(new Date(T1));

    useStore.getState().setLifecycle(created.id, "waiting");

    expect(seen.map((s) => s.created)).toEqual([true, false]);
    expect(seen[1]).toEqual({ id: created.id, lifecycle: "waiting", created: false });
  });
});

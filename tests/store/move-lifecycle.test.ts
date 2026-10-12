// @vitest-environment jsdom
import type { Task } from "@/lib/domain/types";
import { type SyncHooks, registerSyncHooks, useStore } from "@/lib/store/store";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * SIF-22 bulk move contract: `moveTasksToLifecycle` routes every task
 * through the existing `updateTask` path, so each change hits the sync
 * hooks exactly like a single-task edit and nothing bypasses the push.
 */

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  const now = "2026-07-22T12:00:00.000Z";
  return {
    id: `task_test_${seq}`,
    sourceText: "test",
    sourceContext: null,
    title: `Task ${seq}`,
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "schedule",
    effort: "small",
    due: null,
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...patch,
  };
}

function seedTasks(tasks: Task[]): void {
  useStore.setState({ tasks });
}

function lifecycleOf(id: string): string | undefined {
  return useStore.getState().tasks.find((t) => t.id === id)?.lifecycle;
}

afterEach(() => {
  registerSyncHooks(null);
  useStore.setState({ tasks: [] });
});

describe("moveTasksToLifecycle", () => {
  it("moves every given task to the lifecycle and leaves the rest alone", () => {
    const [a, b, c] = [makeTask({}), makeTask({}), makeTask({ lifecycle: "active" })];
    seedTasks([a, b, c]);

    useStore.getState().moveTasksToLifecycle([a.id, b.id], "someday");

    expect(lifecycleOf(a.id)).toBe("someday");
    expect(lifecycleOf(b.id)).toBe("someday");
    expect(lifecycleOf(c.id)).toBe("active");
  });

  it("pushes each task through the sync hooks (existing update path)", () => {
    const taskUpserted = vi.fn();
    registerSyncHooks({
      taskUpserted,
      taskDeleted: vi.fn(),
      labelEnsured: vi.fn(),
      memoryUpserted: vi.fn(),
      memoryDeleted: vi.fn(),
      waitForTask: () => Promise.resolve(),
      isTaskDirty: () => false,
    } satisfies SyncHooks);

    const [a, b] = [makeTask({}), makeTask({})];
    seedTasks([a, b]);

    useStore.getState().moveTasksToLifecycle([a.id, b.id], "someday");

    expect(taskUpserted).toHaveBeenCalledTimes(2);
    const pushed = taskUpserted.mock.calls.map(([task, opts]) => [task.id, task.lifecycle, opts]);
    expect(pushed).toEqual([
      [a.id, "someday", { created: false }],
      [b.id, "someday", { created: false }],
    ]);
  });

  it("ignores ids that are not in the store", () => {
    const a = makeTask({});
    seedTasks([a]);

    useStore.getState().moveTasksToLifecycle([a.id, "task_ghost"], "someday");

    expect(lifecycleOf(a.id)).toBe("someday");
    expect(useStore.getState().tasks).toHaveLength(1);
  });

  it("clears completedAt when a done task is shelved to someday", () => {
    const a = makeTask({ lifecycle: "done", completedAt: "2026-07-20T09:00:00.000Z" });
    seedTasks([a]);

    useStore.getState().moveTasksToLifecycle([a.id], "someday");

    const moved = useStore.getState().tasks[0];
    expect(moved?.lifecycle).toBe("someday");
    expect(moved?.completedAt).toBeNull();
  });
});

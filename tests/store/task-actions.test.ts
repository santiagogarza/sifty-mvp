import { TASK_LIMITS } from "@/lib/domain/limits";
import type { Recurrence, Task } from "@/lib/domain/types";
import { type SyncHooks, registerSyncHooks, useStore } from "@/lib/store/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SIF-15 duplicateTask and SIF-22 moveTasksToLifecycle: both go through the
 * same paths as capture/update so the sync layer sees them.
 */

function seed(patch: Partial<Task> & { id: string }): Task {
  const task: Task = {
    sourceText: "weekly review",
    sourceContext: "every friday",
    title: "Weekly review",
    description: "Look back, plan forward.",
    nextAction: "Open last week's notes",
    lifecycle: "active",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 2,
    urgency: 0.7,
    importance: 0.8,
    priorityBucket: "do_now",
    effort: "medium",
    due: "2026-10-16",
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.9,
    clarifyingQuestion: "Which week?",
    rationale: "Recurring ritual.",
    agentBrief: "## Brief",
    siftId: null,
    siftStage: null,
    plan: null,
    recurrence: null,
    seriesId: null,
    labelIds: ["label_a", "label_b"],
    subtasks: [
      { id: "st_1", title: "Review calendar", done: true, order: 0 },
      { id: "st_2", title: "Clear inbox", done: false, order: 1 },
      { id: "st_3", title: "Set three goals", done: true, order: 2 },
    ],
    editedFields: ["title"],
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z",
    completedAt: null,
    ...patch,
  };
  useStore.setState((s) => ({ tasks: [...s.tasks, task] }));
  return task;
}

let hooks: { [K in keyof SyncHooks]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [] });
  hooks = {
    taskUpserted: vi.fn(),
    taskDeleted: vi.fn(),
    labelEnsured: vi.fn(),
    memoryUpserted: vi.fn(),
    memoryDeleted: vi.fn(),
    waitForTask: vi.fn(),
    isTaskDirty: vi.fn(),
  };
  registerSyncHooks(hooks as unknown as SyncHooks);
});

afterEach(() => {
  registerSyncHooks(null);
});

describe("duplicateTask", () => {
  it("copies content, resets subtasks with fresh ids, and skips due/AI history", () => {
    const original = seed({ id: "task_src" });
    const copy = useStore.getState().duplicateTask("task_src");

    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(original.id);
    expect(copy!.title).toBe("Weekly review (copy)");
    expect(copy!.description).toBe(original.description);
    expect(copy!.nextAction).toBe(original.nextAction);
    expect(copy!.labelIds).toEqual(original.labelIds);
    expect(copy!.priorityBucket).toBe("do_now");
    expect(copy!.urgency).toBe(0.7);
    expect(copy!.importance).toBe(0.8);
    expect(copy!.effort).toBe("medium");
    expect(copy!.lifecycle).toBe("active");

    expect(copy!.subtasks).toHaveLength(3);
    expect(copy!.subtasks.every((st) => st.done === false)).toBe(true);
    const originalIds = new Set(original.subtasks.map((st) => st.id));
    expect(copy!.subtasks.some((st) => originalIds.has(st.id))).toBe(false);
    expect(copy!.subtasks.map((st) => st.title)).toEqual(original.subtasks.map((st) => st.title));

    expect(copy!.due).toBeNull();
    expect(copy!.completedAt).toBeNull();
    expect(copy!.agentBrief).toBeNull();
    expect(copy!.rationale).toBeNull();
    expect(copy!.clarifyingQuestion).toBeNull();
    expect(copy!.confidence).toBe(0);
    expect(copy!.aiAttempts).toBe(0);
    expect(copy!.aiStatus).toBe("ready");
  });

  it("keeps the (copy) suffix on a title already at the limit", () => {
    const longTitle = "x".repeat(TASK_LIMITS.title);
    seed({ id: "task_long", title: longTitle });
    const copy = useStore.getState().duplicateTask("task_long")!;
    expect(copy.title.length).toBeLessThanOrEqual(TASK_LIMITS.title);
    expect(copy.title.endsWith(" (copy)")).toBe(true);
  });

  it("copies an unsifted or failed original as idle, never pending", () => {
    seed({ id: "task_pending", aiStatus: "pending" });
    seed({ id: "task_failed", aiStatus: "failed", aiError: "boom" });
    expect(useStore.getState().duplicateTask("task_pending")!.aiStatus).toBe("idle");
    const failedCopy = useStore.getState().duplicateTask("task_failed")!;
    expect(failedCopy.aiStatus).toBe("idle");
    expect(failedCopy.aiError).toBeNull();
  });

  it("keeps the user's edit protections except for the cleared due date", () => {
    seed({ id: "task_src", editedFields: ["title", "due", "effort"] });
    const copy = useStore.getState().duplicateTask("task_src")!;
    expect(copy.editedFields).toEqual(["title", "effort"]);
  });

  it("leaves the original untouched", () => {
    const original = seed({ id: "task_src" });
    useStore.getState().duplicateTask("task_src");
    const after = useStore.getState().tasks.find((t) => t.id === "task_src");
    expect(after).toEqual(original);
    expect(useStore.getState().tasks).toHaveLength(2);
  });

  it("pushes the copy as a create so sync picks it up", () => {
    seed({ id: "task_src" });
    const copy = useStore.getState().duplicateTask("task_src");
    expect(hooks.taskUpserted).toHaveBeenCalledTimes(1);
    expect(hooks.taskUpserted).toHaveBeenCalledWith(copy, { created: true });
  });

  it("a copy is a one-off: the repeat rule and series stay behind", () => {
    seed({
      id: "task_rep",
      recurrence: { freq: "weekly", mode: "fixed", weekdays: [5] },
      seriesId: "task_rep",
    });
    const copy = useStore.getState().duplicateTask("task_rep")!;
    expect(copy.recurrence).toBeNull();
    expect(copy.seriesId).toBeNull();
  });

  it("a done or dropped original copies into the Inbox", () => {
    seed({ id: "task_done", lifecycle: "done", completedAt: "2026-10-11T00:00:00.000Z" });
    seed({ id: "task_dropped", lifecycle: "dropped" });
    expect(useStore.getState().duplicateTask("task_done")!.lifecycle).toBe("inbox");
    expect(useStore.getState().duplicateTask("task_dropped")!.lifecycle).toBe("inbox");
  });

  it("returns null for an unknown task and pushes nothing", () => {
    expect(useStore.getState().duplicateTask("task_missing")).toBeNull();
    expect(hooks.taskUpserted).not.toHaveBeenCalled();
  });
});

describe("moveTasksToLifecycle", () => {
  it("patches every listed task and leaves the others alone", () => {
    seed({ id: "task_1", lifecycle: "inbox" });
    seed({ id: "task_2", lifecycle: "inbox" });
    seed({ id: "task_3", lifecycle: "inbox" });

    useStore.getState().moveTasksToLifecycle(["task_1", "task_3", "task_missing"], "someday");

    const byId = new Map(useStore.getState().tasks.map((t) => [t.id, t]));
    expect(byId.get("task_1")!.lifecycle).toBe("someday");
    expect(byId.get("task_2")!.lifecycle).toBe("inbox");
    expect(byId.get("task_3")!.lifecycle).toBe("someday");
    expect(hooks.taskUpserted).toHaveBeenCalledTimes(2);
    // Narrow patches: only the status key is pushed for each task.
    expect(hooks.taskUpserted.mock.calls.map((c) => c[1])).toEqual([
      { created: false, changedKeys: ["lifecycle"] },
      { created: false, changedKeys: ["lifecycle"] },
    ]);
  });
});

describe("recurrence in the store", () => {
  const rule: Recurrence = { freq: "weekly", mode: "fixed", weekdays: [5] };

  it("setRecurrence makes the task the origin of its series and pushes both keys", () => {
    seed({ id: "task_rep", recurrence: null, seriesId: null });
    useStore.getState().setRecurrence("task_rep", { ...rule });
    const task = useStore.getState().tasks.find((t) => t.id === "task_rep")!;
    expect(task.recurrence).toEqual(rule);
    expect(task.seriesId).toBe("task_rep");
    expect(hooks.taskUpserted).toHaveBeenLastCalledWith(task, {
      created: false,
      changedKeys: ["recurrence", "seriesId"],
    });

    // Clearing keeps the series id as history.
    useStore.getState().setRecurrence("task_rep", null);
    const cleared = useStore.getState().tasks.find((t) => t.id === "task_rep")!;
    expect(cleared.recurrence).toBeNull();
    expect(cleared.seriesId).toBe("task_rep");
  });

  it("edits apply to the series by default; instance scope parks the series values", () => {
    seed({ id: "task_rep", recurrence: { ...rule }, seriesId: "task_rep" });
    const store = useStore.getState();

    store.updateTask("task_rep", { title: "Series rename" }, { editedFields: ["title"] });
    let task = useStore.getState().tasks.find((t) => t.id === "task_rep")!;
    expect(task.recurrence).toEqual(rule);

    store.setEditScope("task_rep", "instance");
    store.updateTask("task_rep", { title: "Just this week" }, { editedFields: ["title"] });
    store.addSubtask("task_rep", "Only this time");
    task = useStore.getState().tasks.find((t) => t.id === "task_rep")!;
    expect(task.title).toBe("Just this week");
    expect(task.recurrence?.seriesValues).toEqual({
      title: "Series rename",
      subtasks: expect.arrayContaining([expect.objectContaining({ title: "Review calendar" })]),
    });
    expect(task.recurrence?.seriesValues?.subtasks).toHaveLength(3);
    // The recurrence change rides along in the narrow patch.
    expect(hooks.taskUpserted.mock.calls.at(-1)![1].changedKeys).toEqual(
      expect.arrayContaining(["subtasks", "recurrence"]),
    );

    // Back to series scope: the next title edit becomes the series title.
    store.setEditScope("task_rep", "series");
    store.updateTask("task_rep", { title: "New series title" }, { editedFields: ["title"] });
    task = useStore.getState().tasks.find((t) => t.id === "task_rep")!;
    expect(task.recurrence?.seriesValues).toEqual({
      subtasks: expect.any(Array),
    });
  });

  it("setEditScope toggles per task", () => {
    useStore.getState().setEditScope("task_x", "instance");
    useStore.getState().setEditScope("task_y", "instance");
    expect(useStore.getState().instanceScope).toEqual({ task_x: true, task_y: true });
    useStore.getState().setEditScope("task_x", "series");
    expect(useStore.getState().instanceScope).toEqual({ task_y: true });
  });

  it("adoptTaskFromServer inserts a new task without pushing and replaces a known one", () => {
    const spawned = seed({ id: "task_spawned", title: "From the server" });
    useStore.setState({ tasks: [] });
    useStore.getState().adoptTaskFromServer(spawned);
    expect(useStore.getState().tasks.map((t) => t.id)).toEqual(["task_spawned"]);
    useStore.getState().adoptTaskFromServer({ ...spawned, title: "Replaced" });
    expect(useStore.getState().tasks).toHaveLength(1);
    expect(useStore.getState().tasks[0]!.title).toBe("Replaced");
    expect(hooks.taskUpserted).not.toHaveBeenCalled();
  });
});

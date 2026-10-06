import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import {
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { beforeEach, describe, expect, it } from "vitest";

const NOW = "2026-07-22T12:00:00.000Z";

function makeTask(patch: Partial<Task>): Task {
  return {
    id: "task_board",
    sourceText: "test",
    sourceContext: null,
    title: "Task",
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
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...patch,
  };
}

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
});

describe("board columns", () => {
  it("uses the five status views and leaves out Dropped and Today", () => {
    expect(STATUS_VIEWS.map((view) => view.status)).toEqual([
      "inbox",
      "active",
      "waiting",
      "someday",
      "done",
    ]);
    expect(STATUS_VIEWS.map((view) => view.label)).toEqual([
      "Inbox",
      "Focus",
      "Waiting on",
      "Someday",
      "Done",
    ]);
  });

  it("keeps list sort order inside each column", () => {
    const tasks = [
      makeTask({ id: "old", lifecycle: "inbox", createdAt: "2026-01-01T00:00:00.000Z" }),
      makeTask({ id: "new", lifecycle: "inbox", createdAt: "2026-03-01T00:00:00.000Z" }),
      makeTask({ id: "later", lifecycle: "active", priorityBucket: "schedule" }),
      makeTask({ id: "now", lifecycle: "active", priorityBucket: "do_now" }),
      makeTask({
        id: "done-old",
        lifecycle: "done",
        completedAt: "2026-01-01T00:00:00.000Z",
      }),
      makeTask({
        id: "done-new",
        lifecycle: "done",
        completedAt: "2026-06-01T00:00:00.000Z",
      }),
      makeTask({ id: "gone", lifecycle: "dropped" }),
    ];

    expect(selectInboxTasks(tasks).map((t) => t.id)).toEqual(["new", "old"]);
    expect(selectFocusTasks(tasks).map((t) => t.id)).toEqual(["now", "later"]);
    expect(selectDoneTasks(tasks).map((t) => t.id)).toEqual(["done-new", "done-old"]);
    expect(selectByLifecycle(tasks, "dropped").map((t) => t.id)).toEqual(["gone"]);
  });

  it("partitions about 200 tasks without inventing a column", () => {
    const statuses = ["inbox", "active", "waiting", "someday", "done", "dropped"] as const;
    const tasks = Array.from({ length: 200 }, (_, i) =>
      makeTask({ id: `task_${i}`, lifecycle: statuses[i % statuses.length] }),
    );
    const placed = [
      ...selectInboxTasks(tasks),
      ...selectFocusTasks(tasks),
      ...selectByLifecycle(tasks, "waiting"),
      ...selectByLifecycle(tasks, "someday"),
      ...selectDoneTasks(tasks),
    ];
    expect(placed).toHaveLength(tasks.filter((t) => t.lifecycle !== "dropped").length);
    expect(placed.some((t) => t.lifecycle === "dropped")).toBe(false);
  });
});

describe("createTask lifecycle", () => {
  it("defaults to inbox", () => {
    const task = useStore.getState().createTask({ sourceText: "Buy milk" });
    expect(task.lifecycle).toBe("inbox");
    expect(task.completedAt).toBeNull();
  });

  it("keeps an explicit lifecycle through triage", () => {
    const task = useStore.getState().createTask({ sourceText: "Ship it", lifecycle: "active" });
    expect(task.lifecycle).toBe("active");

    useStore.getState().applyTriage(task.id, {
      title: "Ship the release",
      description: null,
      nextAction: "Cut the branch",
      urgency: 0.2,
      importance: 0.9,
      effort: "small",
      due: null,
      delegationCandidate: "self",
      labelIds: [],
      subtasks: [],
      rationale: null,
      confidence: 0.7,
      clarifyingQuestion: null,
    });

    const stored = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(stored?.lifecycle).toBe("active");
    expect(stored?.title).toBe("Ship the release");
  });

  it("stamps completedAt when created directly into Done", () => {
    const task = useStore
      .getState()
      .createTask({ sourceText: "Already finished", lifecycle: "done" });
    expect(task.lifecycle).toBe("done");
    expect(task.completedAt).toBeTruthy();
  });
});

describe("updateTask completedAt", () => {
  it("sets completedAt on the way into Done and clears it on the way out", () => {
    const task = useStore.getState().createTask({ sourceText: "File me" });
    useStore.getState().updateTask(task.id, { lifecycle: "done" });
    const done = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(done?.lifecycle).toBe("done");
    expect(done?.completedAt).toBeTruthy();

    useStore.getState().updateTask(task.id, { lifecycle: "inbox" });
    const back = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(back?.lifecycle).toBe("inbox");
    expect(back?.completedAt).toBeNull();
  });
});

import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import { selectBoardColumns } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { beforeEach, describe, expect, it } from "vitest";

const NOW = "2026-07-22T12:00:00.000Z";

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `task_board_${seq}`,
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
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...patch,
  };
}

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
});

describe("selectBoardColumns", () => {
  it("matches STATUS_VIEWS and omits dropped and today", () => {
    const columns = selectBoardColumns([
      makeTask({ lifecycle: "dropped", title: "let go" }),
      makeTask({ lifecycle: "inbox", title: "new" }),
    ]);
    expect(columns.map((column) => column.status)).toEqual(STATUS_VIEWS.map((view) => view.status));
    expect(columns.map((column) => column.status)).not.toContain("dropped");
    expect(columns.map((column) => column.status)).not.toContain("today");
    expect(columns.flatMap((column) => column.tasks).map((task) => task.title)).toEqual(["new"]);
  });

  it("keeps each list's sort", () => {
    const columns = selectBoardColumns([
      makeTask({
        lifecycle: "inbox",
        title: "older inbox",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      makeTask({
        lifecycle: "inbox",
        title: "newer inbox",
        createdAt: "2026-06-01T00:00:00.000Z",
      }),
      makeTask({ lifecycle: "active", title: "low", priorityBucket: "drop" }),
      makeTask({ lifecycle: "active", title: "now", priorityBucket: "do_now" }),
      makeTask({
        lifecycle: "done",
        title: "old done",
        completedAt: "2026-01-01T00:00:00.000Z",
      }),
      makeTask({
        lifecycle: "done",
        title: "new done",
        completedAt: "2026-06-01T00:00:00.000Z",
      }),
    ]);
    const byStatus = (status: string) =>
      columns.find((column) => column.status === status)?.tasks.map((task) => task.title);

    expect(byStatus("inbox")).toEqual(["newer inbox", "older inbox"]);
    expect(byStatus("active")).toEqual(["now", "low"]);
    expect(byStatus("done")).toEqual(["new done", "old done"]);
  });
});

describe("createTask lifecycle", () => {
  it("defaults to inbox and keeps a column lifecycle through triage", () => {
    const inbox = useStore.getState().createTask({ sourceText: "plain capture" });
    expect(inbox.lifecycle).toBe("inbox");
    expect(inbox.completedAt).toBeNull();

    const focus = useStore.getState().createTask({
      sourceText: "already filed",
      lifecycle: "active",
    });
    expect(focus.lifecycle).toBe("active");

    useStore.getState().applyTriage(focus.id, {
      title: "Already filed",
      description: null,
      nextAction: "Start",
      urgency: 0.2,
      importance: 0.8,
      effort: "small",
      due: null,
      delegationCandidate: "self",
      labelIds: [],
      subtasks: [],
      rationale: null,
      confidence: 0.9,
      clarifyingQuestion: null,
    });

    const after = useStore.getState().tasks.find((task) => task.id === focus.id);
    expect(after?.lifecycle).toBe("active");
    expect(after?.title).toBe("Already filed");
  });

  it("sets completedAt when entering done and clears it when leaving", () => {
    const task = useStore.getState().createTask({ sourceText: "finish me" });
    useStore.getState().updateTask(task.id, { lifecycle: "done" });
    const done = useStore.getState().tasks.find((item) => item.id === task.id);
    expect(done?.lifecycle).toBe("done");
    expect(done?.completedAt).toBeTruthy();

    useStore.getState().updateTask(task.id, { lifecycle: "waiting" });
    const restored = useStore.getState().tasks.find((item) => item.id === task.id);
    expect(restored?.lifecycle).toBe("waiting");
    expect(restored?.completedAt).toBeNull();
  });
});

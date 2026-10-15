import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import {
  selectBoardColumns,
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { beforeEach, describe, expect, it } from "vitest";

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  const at = new Date(Date.UTC(2026, 6, 1, 0, seq)).toISOString();
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
    createdAt: at,
    updatedAt: at,
    completedAt: null,
    ...patch,
  };
}

const TRIAGE = {
  title: "Triaged",
  description: null,
  nextAction: "Do it",
  urgency: 0.8,
  importance: 0.8,
  effort: "small" as const,
  due: null,
  delegationCandidate: "self" as const,
  labelIds: [],
  subtasks: [],
  rationale: null,
  confidence: 0.9,
  clarifyingQuestion: null,
};

const live = (id: string) => useStore.getState().tasks.find((t) => t.id === id)!;

describe("selectBoardColumns", () => {
  const fixture = [
    makeTask({ lifecycle: "inbox" }),
    makeTask({ lifecycle: "inbox" }),
    makeTask({ lifecycle: "active", priorityBucket: "drop" }),
    makeTask({ lifecycle: "active", priorityBucket: "do_now" }),
    makeTask({ lifecycle: "waiting" }),
    makeTask({ lifecycle: "waiting" }),
    makeTask({ lifecycle: "someday" }),
    makeTask({ lifecycle: "done", completedAt: "2026-07-02T00:00:00.000Z" }),
    makeTask({ lifecycle: "done", completedAt: "2026-07-03T00:00:00.000Z" }),
    makeTask({ lifecycle: "dropped" }),
  ];

  it("has exactly the STATUS_VIEWS columns, in order, with no Dropped column", () => {
    const statuses = selectBoardColumns(fixture).map((c) => c.status);
    expect(statuses).toEqual(STATUS_VIEWS.map((v) => v.status));
    expect(statuses).toEqual(["inbox", "active", "waiting", "someday", "done"]);
    expect(statuses).not.toContain("dropped");
  });

  it("orders each column exactly like its list view", () => {
    const columns = Object.fromEntries(
      selectBoardColumns(fixture).map((c) => [c.status, c.tasks.map((t) => t.id)]),
    );
    const ids = (tasks: Task[]) => tasks.map((t) => t.id);
    expect(columns.inbox).toEqual(ids(selectInboxTasks(fixture)));
    expect(columns.active).toEqual(ids(selectFocusTasks(fixture)));
    expect(columns.waiting).toEqual(ids(selectByLifecycle(fixture, "waiting")));
    expect(columns.someday).toEqual(ids(selectByLifecycle(fixture, "someday")));
    expect(columns.done).toEqual(ids(selectDoneTasks(fixture)));
  });

  it("never shows a dropped task", () => {
    const all = selectBoardColumns(fixture).flatMap((c) => c.tasks);
    expect(all.some((t) => t.lifecycle === "dropped")).toBe(false);
    expect(all).toHaveLength(fixture.length - 1);
  });
});

describe("store writes the board relies on", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [], labels: [] });
  });

  it("createTask defaults to inbox", () => {
    const task = useStore.getState().createTask({ sourceText: "plain capture" });
    expect(task.lifecycle).toBe("inbox");
  });

  it("createTask files into the requested lifecycle, and triage keeps it there", () => {
    const task = useStore.getState().createTask({ sourceText: "into focus", lifecycle: "active" });
    expect(live(task.id).lifecycle).toBe("active");
    useStore.getState().applyTriage(task.id, TRIAGE);
    expect(live(task.id).lifecycle).toBe("active");
    expect(live(task.id).title).toBe("Triaged");
  });

  it("entering Done sets completedAt and leaving Done clears it", () => {
    const task = useStore.getState().createTask({ sourceText: "finish me", lifecycle: "waiting" });
    expect(live(task.id).completedAt).toBeNull();

    useStore.getState().setLifecycle(task.id, "done");
    expect(live(task.id).completedAt).not.toBeNull();

    useStore.getState().setLifecycle(task.id, "someday");
    expect(live(task.id).completedAt).toBeNull();
  });

  it("does not mark lifecycle as a user-edited field", () => {
    const task = useStore.getState().createTask({ sourceText: "file me" });
    useStore.getState().setLifecycle(task.id, "active");
    expect(live(task.id).editedFields).not.toContain("lifecycle");
  });
});

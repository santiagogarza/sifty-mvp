import type { Task } from "@/lib/domain/types";
import { groupTasksByLifecycle, selectBoardTasks } from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

function task(overrides: Partial<Task> & Pick<Task, "id" | "lifecycle">): Task {
  return {
    sourceText: "test",
    sourceContext: null,
    title: "Test task",
    description: null,
    nextAction: null,
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.5,
    importance: 0.5,
    priorityBucket: "unset",
    effort: "small",
    due: null,
    delegationCandidate: "self",
    confidence: 1,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("selectBoardTasks", () => {
  it("excludes dropped tasks", () => {
    const tasks = [
      task({ id: "1", lifecycle: "inbox" }),
      task({ id: "2", lifecycle: "dropped" }),
      task({ id: "3", lifecycle: "active" }),
    ];
    const result = selectBoardTasks(tasks);
    expect(result).toHaveLength(2);
    expect(result.every((t) => t.lifecycle !== "dropped")).toBe(true);
  });
});

describe("groupTasksByLifecycle", () => {
  it("groups tasks by lifecycle", () => {
    const tasks = [
      task({ id: "1", lifecycle: "inbox" }),
      task({ id: "2", lifecycle: "active" }),
      task({ id: "3", lifecycle: "inbox" }),
    ];
    const groups = groupTasksByLifecycle(tasks);
    expect(groups.get("inbox")?.map((t) => t.id)).toEqual(["1", "3"]);
    expect(groups.get("active")?.map((t) => t.id)).toEqual(["2"]);
  });
});

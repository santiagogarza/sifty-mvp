import type { Lifecycle, Task } from "@/lib/domain/types";
import { BOARD_LIFECYCLES, selectBoardTasks } from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

function task(id: string, lifecycle: Lifecycle, updatedAt: string): Task {
  return {
    id,
    sourceText: id,
    sourceContext: null,
    title: id,
    description: null,
    nextAction: null,
    lifecycle,
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 0,
    urgency: 0.5,
    importance: 0.5,
    priorityBucket: "unset",
    effort: "small",
    due: null,
    delegationCandidate: "unsure",
    confidence: 1,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: updatedAt,
    updatedAt,
    completedAt: lifecycle === "done" ? updatedAt : null,
  };
}

describe("selectBoardTasks", () => {
  it("groups visible statuses and leaves dropped tasks off the board", () => {
    const grouped = selectBoardTasks([
      task("older inbox", "inbox", "2026-01-01T00:00:00.000Z"),
      task("newer inbox", "inbox", "2026-02-01T00:00:00.000Z"),
      task("active", "active", "2026-01-01T00:00:00.000Z"),
      task("dropped", "dropped", "2026-01-01T00:00:00.000Z"),
    ]);

    expect(Object.keys(grouped)).toEqual(BOARD_LIFECYCLES);
    expect(grouped.inbox.map((candidate) => candidate.id)).toEqual(["newer inbox", "older inbox"]);
    expect(grouped.active.map((candidate) => candidate.id)).toEqual(["active"]);
    expect(Object.values(grouped).flat()).not.toContainEqual(
      expect.objectContaining({ id: "dropped" }),
    );
  });
});

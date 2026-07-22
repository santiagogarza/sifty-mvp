import type { Lifecycle, Task } from "@/lib/domain/types";
import { BOARD_LIFECYCLES, selectBoardColumns } from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

function makeTask(overrides: Partial<Task> & { id: string; lifecycle: Lifecycle }): Task {
  return {
    sourceText: overrides.id,
    sourceContext: null,
    title: overrides.id,
    description: null,
    nextAction: null,
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "unset",
    effort: "small",
    due: null,
    delegationCandidate: "self",
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("selectBoardColumns", () => {
  it("returns every column in pipeline order, even when empty", () => {
    const columns = selectBoardColumns([]);
    expect(columns.map((c) => c.lifecycle)).toEqual([...BOARD_LIFECYCLES]);
    expect(columns.every((c) => c.tasks.length === 0)).toBe(true);
  });

  it("groups tasks by lifecycle and excludes dropped", () => {
    const tasks = [
      makeTask({ id: "a", lifecycle: "inbox" }),
      makeTask({ id: "b", lifecycle: "active" }),
      makeTask({ id: "c", lifecycle: "waiting" }),
      makeTask({ id: "d", lifecycle: "someday" }),
      makeTask({ id: "e", lifecycle: "done" }),
      makeTask({ id: "f", lifecycle: "dropped" }),
    ];
    const byLifecycle = new Map(
      selectBoardColumns(tasks).map((c) => [c.lifecycle, c.tasks.map((t) => t.id)]),
    );
    expect(byLifecycle.get("inbox")).toEqual(["a"]);
    expect(byLifecycle.get("active")).toEqual(["b"]);
    expect(byLifecycle.get("waiting")).toEqual(["c"]);
    expect(byLifecycle.get("someday")).toEqual(["d"]);
    expect(byLifecycle.get("done")).toEqual(["e"]);
    const allIds = selectBoardColumns(tasks).flatMap((c) => c.tasks.map((t) => t.id));
    expect(allIds).not.toContain("f");
  });

  it("sorts inbox by capture time, newest first", () => {
    const tasks = [
      makeTask({ id: "old", lifecycle: "inbox", createdAt: "2026-07-01T10:00:00.000Z" }),
      makeTask({ id: "new", lifecycle: "inbox", createdAt: "2026-07-02T10:00:00.000Z" }),
    ];
    const inbox = selectBoardColumns(tasks).find((c) => c.lifecycle === "inbox");
    expect(inbox?.tasks.map((t) => t.id)).toEqual(["new", "old"]);
  });

  it("sorts the active column by focus score (do_now before drop)", () => {
    const tasks = [
      makeTask({ id: "later", lifecycle: "active", priorityBucket: "drop" }),
      makeTask({
        id: "now",
        lifecycle: "active",
        priorityBucket: "do_now",
        urgency: 0.9,
        importance: 0.9,
      }),
    ];
    const active = selectBoardColumns(tasks).find((c) => c.lifecycle === "active");
    expect(active?.tasks.map((t) => t.id)).toEqual(["now", "later"]);
  });

  it("sorts done by completion time, newest first, falling back to updatedAt", () => {
    const tasks = [
      makeTask({
        id: "first",
        lifecycle: "done",
        completedAt: "2026-07-01T09:00:00.000Z",
        updatedAt: "2026-07-05T09:00:00.000Z",
      }),
      makeTask({
        id: "second",
        lifecycle: "done",
        completedAt: "2026-07-03T09:00:00.000Z",
      }),
      makeTask({
        id: "no-stamp",
        lifecycle: "done",
        completedAt: null,
        updatedAt: "2026-07-02T09:00:00.000Z",
      }),
    ];
    const done = selectBoardColumns(tasks).find((c) => c.lifecycle === "done");
    expect(done?.tasks.map((t) => t.id)).toEqual(["second", "no-stamp", "first"]);
  });

  it("applies common filters (label, search) before grouping", () => {
    const tasks = [
      makeTask({ id: "match", lifecycle: "inbox", title: "Renew passport", labelIds: ["l1"] }),
      makeTask({ id: "other", lifecycle: "inbox", title: "Water plants" }),
    ];
    const byLabel = selectBoardColumns(tasks, { labelId: "l1" });
    expect(byLabel[0]?.tasks.map((t) => t.id)).toEqual(["match"]);
    const bySearch = selectBoardColumns(tasks, { search: "passport" });
    expect(bySearch[0]?.tasks.map((t) => t.id)).toEqual(["match"]);
  });
});

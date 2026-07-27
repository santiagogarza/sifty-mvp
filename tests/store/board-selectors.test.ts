import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import { selectBoardColumns } from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-07-22T12:00:00Z");

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
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    completedAt: null,
    ...patch,
  };
}

describe("selectBoardColumns", () => {
  it("returns exactly the five STATUS_VIEWS statuses in pipeline order", () => {
    const cols = selectBoardColumns([]);
    expect(cols.map((c) => c.status)).toEqual(STATUS_VIEWS.map((v) => v.status));
    expect(cols).toHaveLength(5);
  });

  it("always returns five columns even when empty", () => {
    const cols = selectBoardColumns([]);
    for (const col of cols) {
      expect(col.tasks).toEqual([]);
    }
  });

  it("never includes dropped tasks", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox", title: "In" }),
      makeTask({ lifecycle: "dropped", title: "Gone" }),
      makeTask({ lifecycle: "active", title: "Focus" }),
    ];
    const cols = selectBoardColumns(tasks);
    const allIds = cols.flatMap((c) => c.tasks.map((t) => t.id));
    expect(allIds).toHaveLength(2);
    expect(cols.flatMap((c) => c.tasks.map((t) => t.title))).not.toContain("Gone");
  });

  it("sorts each column like the equivalent list view", () => {
    const older = makeTask({
      lifecycle: "inbox",
      title: "Older",
      createdAt: "2026-07-20T12:00:00Z",
    });
    const newer = makeTask({
      lifecycle: "inbox",
      title: "Newer",
      createdAt: "2026-07-22T12:00:00Z",
    });
    const doneOld = makeTask({
      lifecycle: "done",
      title: "Done old",
      completedAt: "2026-07-20T12:00:00Z",
    });
    const doneNew = makeTask({
      lifecycle: "done",
      title: "Done new",
      completedAt: "2026-07-22T12:00:00Z",
    });

    const cols = selectBoardColumns([older, newer, doneOld, doneNew]);
    const inbox = cols.find((c) => c.status === "inbox")!;
    expect(inbox.tasks.map((t) => t.title)).toEqual(["Newer", "Older"]);

    const done = cols.find((c) => c.status === "done")!;
    expect(done.tasks.map((t) => t.title)).toEqual(["Done new", "Done old"]);
  });

  it("narrows every column by search and labelId", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox", title: "Alpha draft", labelIds: ["lbl_a"] }),
      makeTask({ lifecycle: "active", title: "Beta plan", labelIds: ["lbl_b"] }),
      makeTask({ lifecycle: "waiting", title: "Alpha wait", labelIds: ["lbl_a"] }),
      makeTask({ lifecycle: "someday", title: "Gamma idea", labelIds: ["lbl_a"] }),
    ];

    const bySearch = selectBoardColumns(tasks, { search: "alpha" });
    expect(
      bySearch
        .flatMap((c) => c.tasks)
        .map((t) => t.title)
        .sort(),
    ).toEqual(["Alpha draft", "Alpha wait"]);

    const byLabel = selectBoardColumns(tasks, { labelId: "lbl_a" });
    expect(byLabel.flatMap((c) => c.tasks)).toHaveLength(3);
    expect(byLabel.find((c) => c.status === "active")!.tasks).toHaveLength(0);
  });
});

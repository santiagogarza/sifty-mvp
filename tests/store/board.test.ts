import type { Task } from "@/lib/domain/types";
import { partitionByLifecycle, staysVisibleOnBoard } from "@/lib/store/board";
import { describe, expect, it } from "vitest";

function makeTask(id: string, lifecycle: Task["lifecycle"], overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id,
    sourceText: "test",
    sourceContext: null,
    title: `Task ${id}`,
    description: null,
    nextAction: null,
    lifecycle,
    aiStatus: "pending",
    aiError: null,
    aiAttempts: 0,
    urgency: 0.5,
    importance: 0.5,
    priorityBucket: "unset",
    effort: "small",
    due: null,
    delegationCandidate: "unsure",
    assigneeName: null,
    confidence: 0,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  };
}

describe("partitionByLifecycle", () => {
  it("places every task in exactly the column matching its stored lifecycle", () => {
    const tasks = [
      makeTask("1", "inbox"),
      makeTask("2", "active"),
      makeTask("3", "waiting"),
      makeTask("4", "someday"),
      makeTask("5", "done"),
      makeTask("6", "dropped"),
    ];

    const columns: Task["lifecycle"][] = [
      "inbox",
      "active",
      "waiting",
      "someday",
      "done",
      "dropped",
    ];
    const result = partitionByLifecycle(tasks, {}, columns);

    expect(result.inbox).toHaveLength(1);
    expect(result.inbox[0]?.id).toBe("1");
    expect(result.active).toHaveLength(1);
    expect(result.active[0]?.id).toBe("2");
    expect(result.waiting).toHaveLength(1);
    expect(result.waiting[0]?.id).toBe("3");
    expect(result.someday).toHaveLength(1);
    expect(result.someday[0]?.id).toBe("4");
    expect(result.done).toHaveLength(1);
    expect(result.done[0]?.id).toBe("5");
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.id).toBe("6");
  });

  it("applies label and search filters identically to board and list", () => {
    const tasks = [
      makeTask("1", "inbox", { labelIds: ["l1"], title: "apple" }),
      makeTask("2", "active", { labelIds: ["l2"], title: "banana" }),
      makeTask("3", "waiting", { labelIds: ["l1"], title: "apple pie" }),
    ];

    const columns: Task["lifecycle"][] = ["inbox", "active", "waiting"];

    const labelResult = partitionByLifecycle(tasks, { labelId: "l1" }, columns);
    expect(labelResult.inbox).toHaveLength(1);
    expect(labelResult.active).toHaveLength(0);
    expect(labelResult.waiting).toHaveLength(1);

    const searchResult = partitionByLifecycle(tasks, { search: "apple" }, columns);
    expect(searchResult.inbox).toHaveLength(1);
    expect(searchResult.active).toHaveLength(0);
    expect(searchResult.waiting).toHaveLength(1);
  });

  it("Today's board partition contains only tasks where isTodayTask is true", () => {
    const now = new Date();
    const overdue = new Date(now.getTime() - 86400000).toISOString();

    const tasks = [
      makeTask("1", "inbox", { priorityBucket: "do_now" }), // today
      makeTask("2", "active", { priorityBucket: "do_now" }), // today
      makeTask("3", "waiting", { due: overdue }), // today
      makeTask("4", "inbox", { priorityBucket: "unset" }), // not today
      makeTask("5", "someday", { priorityBucket: "do_now" }), // never today
      makeTask("6", "done", { priorityBucket: "do_now" }), // never today
      makeTask("7", "dropped", { priorityBucket: "do_now" }), // never today
    ];

    const columns: Task["lifecycle"][] = [
      "inbox",
      "active",
      "waiting",
      "someday",
      "done",
      "dropped",
    ];
    const result = partitionByLifecycle(tasks, {}, columns, true);

    expect(result.inbox).toHaveLength(1);
    expect(result.inbox[0]?.id).toBe("1");
    expect(result.active).toHaveLength(1);
    expect(result.active[0]?.id).toBe("2");
    expect(result.waiting).toHaveLength(1);
    expect(result.waiting[0]?.id).toBe("3");

    expect(result.someday).toHaveLength(0);
    expect(result.done).toHaveLength(0);
    expect(result.dropped).toHaveLength(0);
  });

  it("staysVisibleOnBoard blocks Today moves that would hide the card", () => {
    const doNow = makeTask("1", "active", { priorityBucket: "do_now" });
    const dueToday = makeTask("2", "active", {
      due: new Date().toISOString().slice(0, 10),
    });

    expect(staysVisibleOnBoard(doNow, "waiting", true)).toBe(false);
    expect(staysVisibleOnBoard(doNow, "done", true)).toBe(false);
    expect(staysVisibleOnBoard(doNow, "inbox", true)).toBe(true);
    expect(staysVisibleOnBoard(dueToday, "waiting", true)).toBe(true);
    expect(staysVisibleOnBoard(doNow, "waiting", false)).toBe(true);
  });
});

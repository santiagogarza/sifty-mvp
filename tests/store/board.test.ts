import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { partitionByLifecycle } from "@/lib/store/board";
import { isTodayTask, selectByLifecycle } from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-08-18T12:00:00Z");

let sequence = 0;
function makeTask(patch: Partial<Task> = {}): Task {
  sequence += 1;
  return {
    id: `board_task_${sequence}`,
    sourceText: "source",
    sourceContext: null,
    title: `Task ${sequence}`,
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

describe("partitionByLifecycle", () => {
  it("places every task in exactly its stored lifecycle column", () => {
    const tasks = STATUSES_IN_ORDER.map((lifecycle) => makeTask({ lifecycle }));
    const partition = partitionByLifecycle(tasks, {}, STATUSES_IN_ORDER);

    for (const lifecycle of STATUSES_IN_ORDER) {
      expect(partition[lifecycle]).toHaveLength(1);
      expect(partition[lifecycle][0]?.lifecycle).toBe(lifecycle);
    }
    expect(Object.values(partition).flat()).toHaveLength(tasks.length);
  });

  it("applies label and search filters with the list selector contract", () => {
    const matching = makeTask({
      lifecycle: "waiting",
      title: "Call Ada",
      sourceText: "Vendor follow-up",
      labelIds: ["label_work"],
    });
    const tasks = [
      matching,
      makeTask({ lifecycle: "waiting", title: "Call Bob", labelIds: ["label_work"] }),
      makeTask({ lifecycle: "waiting", title: "Call Ada", labelIds: ["label_home"] }),
    ];
    const args = { labelId: "label_work", search: "ada" };
    const partition = partitionByLifecycle(tasks, args, STATUSES_IN_ORDER);

    expect(partition.waiting).toEqual(selectByLifecycle(tasks, "waiting", args));
    expect(partition.waiting).toEqual([matching]);
  });

  it("keeps only Today tasks in the three Today columns", () => {
    const todayColumns: readonly Lifecycle[] = ["inbox", "active", "waiting"];
    const tasks = [
      makeTask({ lifecycle: "inbox", priorityBucket: "do_now" }),
      makeTask({ lifecycle: "active", due: "2026-08-18" }),
      makeTask({ lifecycle: "waiting", due: "2026-08-17" }),
      makeTask({ lifecycle: "waiting" }),
      makeTask({ lifecycle: "someday", priorityBucket: "do_now" }),
      makeTask({ lifecycle: "done", due: "2026-08-17" }),
      makeTask({ lifecycle: "dropped", due: "2026-08-17" }),
    ];
    const partition = partitionByLifecycle(tasks, { todayOnly: true, now: NOW }, todayColumns);
    const included = Object.values(partition).flat();

    expect(included).toHaveLength(3);
    expect(included.every((task) => isTodayTask(task, NOW))).toBe(true);
    expect(partition.someday).toEqual([]);
    expect(partition.done).toEqual([]);
    expect(partition.dropped).toEqual([]);
  });
});

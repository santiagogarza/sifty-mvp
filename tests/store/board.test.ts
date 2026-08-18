import type { Lifecycle, Task } from "@/lib/domain/types";
import { LIFECYCLE } from "@/lib/domain/types";
import { TODAY_BOARD_COLUMNS, adjacentLifecycle, partitionByLifecycle } from "@/lib/store/board";
import {
  isTodayTask,
  selectByLifecycle,
  selectDoneTasks,
  selectDroppedTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-07-22T12:00:00Z");

function iso(daysFromNow: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

let seq = 0;
function makeTask(patch: Partial<Task> = {}): Task {
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

describe("partitionByLifecycle", () => {
  it("places every task in exactly the column matching its stored lifecycle", () => {
    const tasks = LIFECYCLE.map((lifecycle) => makeTask({ lifecycle, title: lifecycle }));
    const part = partitionByLifecycle(tasks);
    for (const lifecycle of LIFECYCLE) {
      expect(part[lifecycle].map((t) => t.lifecycle)).toEqual([lifecycle]);
      expect(part[lifecycle]).toHaveLength(1);
    }
    const seen = new Set(LIFECYCLE.flatMap((lc) => part[lc].map((t) => t.id)));
    expect(seen.size).toBe(tasks.length);
  });

  it("applies label and search filters identically to the list selectors", () => {
    const labeled = makeTask({
      lifecycle: "inbox",
      title: "Alpha note",
      labelIds: ["lbl_a"],
    });
    const otherInbox = makeTask({ lifecycle: "inbox", title: "Beta", labelIds: ["lbl_b"] });
    const focusHit = makeTask({
      lifecycle: "active",
      title: "Alpha focus",
      description: "needle",
    });
    const waiting = makeTask({ lifecycle: "waiting", title: "Wait", labelIds: ["lbl_a"] });
    const tasks = [labeled, otherInbox, focusHit, waiting];

    const byLabel = partitionByLifecycle(tasks, { labelId: "lbl_a" });
    expect(byLabel.inbox.map((t) => t.id)).toEqual(
      selectInboxTasks(tasks, { labelId: "lbl_a" }).map((t) => t.id),
    );
    expect(byLabel.waiting.map((t) => t.id)).toEqual(
      selectByLifecycle(tasks, "waiting", { labelId: "lbl_a" }).map((t) => t.id),
    );
    expect(byLabel.active).toEqual([]);

    const bySearch = partitionByLifecycle(tasks, { search: "needle" });
    expect(bySearch.active.map((t) => t.id)).toEqual(
      selectFocusTasks(tasks, { search: "needle" }).map((t) => t.id),
    );
    expect(bySearch.inbox).toEqual([]);
  });

  it("Today's board partition contains only isTodayTask work and never someday/done/dropped", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox", due: iso(-1) }),
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active", priorityBucket: "do_now" }),
      makeTask({ lifecycle: "waiting", due: iso(0) }),
      makeTask({ lifecycle: "waiting" }),
      makeTask({ lifecycle: "someday", due: iso(-3) }),
      makeTask({ lifecycle: "done", completedAt: NOW.toISOString() }),
      makeTask({ lifecycle: "dropped" }),
    ];
    const today = tasks.filter((t) => isTodayTask(t, NOW));
    const part = partitionByLifecycle(today, {}, TODAY_BOARD_COLUMNS);
    const flat = TODAY_BOARD_COLUMNS.flatMap((lc) => part[lc]);
    expect(flat.length).toBeGreaterThan(0);
    for (const task of flat) {
      expect(isTodayTask(task, NOW)).toBe(true);
      expect(["someday", "done", "dropped"]).not.toContain(task.lifecycle);
    }
    expect(part.someday).toEqual([]);
    expect(part.done).toEqual([]);
    expect(part.dropped).toEqual([]);
    expect(selectDoneTasks(today)).toEqual([]);
    expect(selectDroppedTasks(today)).toEqual([]);
  });
});

describe("adjacentLifecycle", () => {
  it("steps one column and is a no-op off the end", () => {
    const cols: Lifecycle[] = ["inbox", "active", "waiting"];
    expect(adjacentLifecycle("inbox", 1, cols)).toBe("active");
    expect(adjacentLifecycle("waiting", 1, cols)).toBeNull();
    expect(adjacentLifecycle("inbox", -1, cols)).toBeNull();
  });
});

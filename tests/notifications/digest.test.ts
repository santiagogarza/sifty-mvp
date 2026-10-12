import type { Task } from "@/lib/domain/types";
import {
  composeAwaySection,
  composeDueReminder,
  composeMorningPlan,
  composeWeeklyReview,
  dueState,
  formatDateKey,
  isTodayTask,
  pushPayloadFor,
} from "@/lib/notifications/digest";
import { describe, expect, it } from "vitest";

const APP = "https://sifty.example";

let counter = 0;
function task(over: Partial<Task> = {}): Task {
  counter += 1;
  const id = over.id ?? `task_${counter}`;
  return {
    id,
    sourceText: over.title ?? id,
    sourceContext: null,
    title: id,
    description: null,
    nextAction: null,
    lifecycle: "active",
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
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    completedAt: null,
    ...over,
  };
}

// Monday 2026-10-12, 05:00Z: 07:00 in Ljubljana, but still Sunday 19:00 in Honolulu.
const NOW = new Date("2026-10-12T05:00:00Z");
const base = { now: NOW, timeZone: "Europe/Ljubljana", name: "Ana", appUrl: APP };

describe("dueState / isTodayTask", () => {
  it("compares day keys as strings so the server zone never leaks in", () => {
    expect(dueState("2026-10-11", "2026-10-12")).toBe("overdue");
    expect(dueState("2026-10-12", "2026-10-12")).toBe("today");
    expect(dueState("2026-10-13", "2026-10-12")).toBe("upcoming");
    expect(dueState(null, "2026-10-12")).toBeNull();
  });

  it("mirrors the Today view: inbox/focus by due or do_now, waiting only by due", () => {
    const key = "2026-10-12";
    expect(isTodayTask(task({ lifecycle: "inbox", due: "2026-10-12" }), key)).toBe(true);
    expect(isTodayTask(task({ lifecycle: "active", priorityBucket: "do_now" }), key)).toBe(true);
    expect(isTodayTask(task({ lifecycle: "active" }), key)).toBe(false);
    expect(isTodayTask(task({ lifecycle: "waiting", due: "2026-10-10" }), key)).toBe(true);
    expect(isTodayTask(task({ lifecycle: "waiting", priorityBucket: "do_now" }), key)).toBe(false);
    expect(isTodayTask(task({ lifecycle: "someday", due: "2026-10-12" }), key)).toBe(false);
    expect(isTodayTask(task({ lifecycle: "done", due: "2026-10-12" }), key)).toBe(false);
  });
});

describe("composeMorningPlan", () => {
  it("buckets open tasks into overdue, due today, Today, and Focus without repeats", () => {
    const tasks = [
      task({ id: "late", lifecycle: "inbox", due: "2026-10-09" }),
      task({ id: "later", lifecycle: "active", due: "2026-10-01" }),
      task({ id: "today", lifecycle: "active", due: "2026-10-12", nextAction: "Send draft" }),
      task({ id: "urgent", lifecycle: "inbox", priorityBucket: "do_now" }),
      task({ id: "focus", lifecycle: "active" }),
      task({ id: "soon", lifecycle: "active", due: "2026-10-20" }),
      task({ id: "someday", lifecycle: "someday", due: "2026-10-12" }),
      task({ id: "done", lifecycle: "done", due: "2026-10-12", completedAt: NOW.toISOString() }),
      task({ id: "inbox-plain", lifecycle: "inbox" }),
    ];
    const plan = composeMorningPlan({ ...base, tasks });
    expect(plan).not.toBeNull();
    expect(plan!.dateKey).toBe("2026-10-12");
    expect(plan!.dateLabel).toBe("Monday, October 12");
    // Oldest overdue first.
    expect(plan!.overdue.map((t) => t.id)).toEqual(["later", "late"]);
    expect(plan!.dueToday.map((t) => t.id)).toEqual(["today"]);
    expect(plan!.today.map((t) => t.id)).toEqual(["urgent"]);
    // Focus excludes anything already listed; `soon` has an upcoming date but is in Focus.
    expect(plan!.focus.map((t) => t.id).sort()).toEqual(["focus", "soon"]);
    expect(plan!.inboxCount).toBe(3);
    expect(plan!.away).toBeNull();
    expect(plan!.dueToday[0]).toMatchObject({
      dueState: "today",
      nextAction: "Send draft",
      url: `${APP}/today?task=today`,
    });
  });

  it("is null on a quiet morning", () => {
    expect(composeMorningPlan({ ...base, tasks: [] })).toBeNull();
    expect(
      composeMorningPlan({
        ...base,
        tasks: [task({ lifecycle: "inbox" }), task({ lifecycle: "someday", due: "2026-10-12" })],
      }),
    ).toBeNull();
  });

  it("uses the user's local date, not the server's", () => {
    const tasks = [task({ lifecycle: "active", due: "2026-10-12" })];
    // Same instant: Monday in Ljubljana (due today), still Sunday in Honolulu (upcoming).
    expect(composeMorningPlan({ ...base, tasks })!.dueToday).toHaveLength(1);
    const honolulu = composeMorningPlan({ ...base, timeZone: "Pacific/Honolulu", tasks });
    expect(honolulu!.dateKey).toBe("2026-10-11");
    expect(honolulu!.dueToday).toHaveLength(0);
    expect(honolulu!.focus).toHaveLength(1);
  });

  it("the away section is a Phase 3 placeholder", () => {
    expect(composeAwaySection({ ...base, tasks: [] })).toBeNull();
  });
});

describe("composeDueReminder", () => {
  it("only reports what is still due today or overdue", () => {
    const tasks = [
      task({ id: "late", lifecycle: "waiting", due: "2026-10-10" }),
      task({ id: "today", lifecycle: "inbox", due: "2026-10-12" }),
      task({ id: "urgent", lifecycle: "active", priorityBucket: "do_now" }),
      task({
        id: "finished",
        lifecycle: "done",
        due: "2026-10-12",
        completedAt: NOW.toISOString(),
      }),
    ];
    const reminder = composeDueReminder({ ...base, tasks });
    expect(reminder!.overdue.map((t) => t.id)).toEqual(["late"]);
    expect(reminder!.dueToday.map((t) => t.id)).toEqual(["today"]);
    expect(composeDueReminder({ ...base, tasks: [tasks[2]!, tasks[3]!] })).toBeNull();
  });
});

describe("composeWeeklyReview", () => {
  it("summarises the last 7 local days and the next 7", () => {
    const tasks = [
      task({ id: "done-recent", lifecycle: "done", completedAt: "2026-10-10T15:00:00Z" }),
      task({ id: "done-edge", lifecycle: "done", completedAt: "2026-10-05T06:00:00Z" }),
      task({ id: "done-old", lifecycle: "done", completedAt: "2026-10-04T15:00:00Z" }),
      task({ id: "slipped", lifecycle: "active", due: "2026-10-08" }),
      task({ id: "this-week", lifecycle: "inbox", due: "2026-10-15" }),
      task({ id: "next-week", lifecycle: "active", due: "2026-10-20" }),
      task({ id: "today", lifecycle: "waiting", due: "2026-10-12" }),
    ];
    const review = composeWeeklyReview({ ...base, tasks });
    expect(review!.weekKey).toBe("2026-W42");
    expect(review!.rangeLabel).toBe("Oct 5 – Oct 11");
    expect(review!.completed.map((t) => t.id)).toEqual(["done-recent", "done-edge"]);
    expect(review!.completedCount).toBe(2);
    expect(review!.overdue.map((t) => t.id)).toEqual(["slipped"]);
    expect(review!.upcoming.map((t) => t.id)).toEqual(["today", "this-week"]);
    expect(review).toMatchObject({ inboxCount: 1, focusCount: 2, waitingCount: 1 });
    expect(composeWeeklyReview({ ...base, tasks: [] })).toBeNull();
  });
});

describe("pushPayloadFor", () => {
  it("compresses each digest into a one-line notification with a stable tag", () => {
    const plan = composeMorningPlan({
      ...base,
      tasks: [
        task({ id: "late", title: "Pay the invoice", lifecycle: "inbox", due: "2026-10-09" }),
        task({ id: "today", lifecycle: "active", due: "2026-10-12" }),
      ],
    })!;
    expect(pushPayloadFor(plan)).toEqual({
      title: "Your plan for today",
      body: "1 overdue, 1 due today. First up: Pay the invoice",
      url: `${APP}/today`,
      tag: "morning-plan-2026-10-12",
    });

    const quiet = composeMorningPlan({
      ...base,
      tasks: [task({ lifecycle: "active" }), task({ lifecycle: "active" })],
    })!;
    expect(pushPayloadFor(quiet).body).toMatch(/^2 tasks on your plate\. First up: /);

    const reminder = composeDueReminder({
      ...base,
      tasks: [task({ title: "Call Ben", lifecycle: "active", due: "2026-10-12" })],
    })!;
    expect(pushPayloadFor(reminder)).toMatchObject({
      title: "Still due today",
      body: "1 still due today. Call Ben",
      tag: "due-reminder-2026-10-12",
    });

    const review = composeWeeklyReview({
      ...base,
      tasks: [task({ lifecycle: "done", completedAt: "2026-10-10T15:00:00Z" })],
    })!;
    expect(pushPayloadFor(review)).toMatchObject({
      title: "Your week in review",
      body: "1 task done",
      tag: "weekly-review-2026-W42",
    });
  });
});

describe("formatDateKey", () => {
  it("renders a day key without shifting it through a zone", () => {
    expect(formatDateKey("2026-01-01", { month: "short", day: "numeric" })).toBe("Jan 1");
    expect(formatDateKey("2026-12-31", { weekday: "long" })).toBe("Thursday");
  });
});

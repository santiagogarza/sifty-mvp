import {
  buildNextInstance,
  defaultRecurrence,
  describeRecurrence,
  hasInstanceEdits,
  nextDueDate,
  recurrenceAfterEdit,
  recurrenceTitle,
} from "@/lib/domain/recurrence";
import type { Recurrence, Task } from "@/lib/domain/types";
import { describe, expect, it } from "vitest";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_parent",
    sourceText: "weekly review",
    sourceContext: null,
    title: "Weekly review",
    description: "Look back, plan forward.",
    nextAction: "Open last week's notes",
    lifecycle: "active",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.7,
    importance: 0.8,
    priorityBucket: "do_now",
    effort: "medium",
    due: "2026-10-16",
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.9,
    clarifyingQuestion: "Which week?",
    rationale: "Recurring ritual.",
    agentBrief: "## Brief",
    siftId: "sift_1",
    siftStage: null,
    plan: {
      executor: "self",
      approach: null,
      connectors: [],
      readyForAi: false,
      blockers: null,
      promptVersion: "plan.v1",
    },
    recurrence: { freq: "weekly", mode: "fixed", weekdays: [5] },
    seriesId: null,
    labelIds: ["label_a"],
    subtasks: [
      { id: "st_1", title: "Review calendar", done: true, order: 0 },
      { id: "st_2", title: "Clear inbox", done: false, order: 1 },
    ],
    editedFields: ["title"],
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z",
    completedAt: "2026-10-16T10:00:00.000Z",
    ...overrides,
  };
}

describe("nextDueDate: fixed schedule", () => {
  it("daily is the day after the later of due and completion", () => {
    const rule: Recurrence = { freq: "daily", mode: "fixed" };
    expect(nextDueDate(rule, { due: "2026-10-12", completedOn: "2026-10-12" })).toBe("2026-10-13");
    // Completed early: anchored on the due, no doubling up.
    expect(nextDueDate(rule, { due: "2026-10-12", completedOn: "2026-10-10" })).toBe("2026-10-13");
    // Completed late: never spawns in the past, no backlog.
    expect(nextDueDate(rule, { due: "2026-10-12", completedOn: "2026-10-20" })).toBe("2026-10-21");
    expect(nextDueDate(rule, { due: null, completedOn: "2026-10-12" })).toBe("2026-10-13");
  });

  it("weekdays skip Saturday and Sunday", () => {
    const rule: Recurrence = { freq: "weekdays", mode: "fixed" };
    expect(nextDueDate(rule, { due: "2026-10-15", completedOn: "2026-10-15" })).toBe("2026-10-16"); // Thu → Fri
    expect(nextDueDate(rule, { due: "2026-10-16", completedOn: "2026-10-16" })).toBe("2026-10-19"); // Fri → Mon
    expect(nextDueDate(rule, { due: null, completedOn: "2026-10-17" })).toBe("2026-10-19"); // Sat → Mon
  });

  it("weekly lands on the next chosen weekday strictly after the anchor", () => {
    const monThu: Recurrence = { freq: "weekly", mode: "fixed", weekdays: [1, 4] };
    expect(nextDueDate(monThu, { due: "2026-10-12", completedOn: "2026-10-12" })).toBe(
      "2026-10-15",
    ); // Mon → Thu
    expect(nextDueDate(monThu, { due: "2026-10-15", completedOn: "2026-10-15" })).toBe(
      "2026-10-19",
    ); // Thu → Mon
    // Skipped a week: the Monday instance completed the following Tuesday goes to Thursday.
    expect(nextDueDate(monThu, { due: "2026-10-12", completedOn: "2026-10-20" })).toBe(
      "2026-10-22",
    );
    const friOnly: Recurrence = { freq: "weekly", mode: "fixed", weekdays: [5] };
    expect(nextDueDate(friOnly, { due: "2026-10-16", completedOn: "2026-10-14" })).toBe(
      "2026-10-23",
    );
    // No days chosen degrades to +7.
    expect(
      nextDueDate(
        { freq: "weekly", mode: "fixed" },
        { due: "2026-10-16", completedOn: "2026-10-16" },
      ),
    ).toBe("2026-10-23");
  });

  it("monthly uses the chosen day, clamped to short months", () => {
    const on31: Recurrence = { freq: "monthly", mode: "fixed", dayOfMonth: 31 };
    expect(nextDueDate(on31, { due: "2026-01-31", completedOn: "2026-01-31" })).toBe("2026-02-28");
    expect(nextDueDate(on31, { due: "2026-02-28", completedOn: "2026-02-28" })).toBe("2026-03-31");
    expect(nextDueDate(on31, { due: "2028-01-31", completedOn: "2028-01-31" })).toBe("2028-02-29");
    const on15: Recurrence = { freq: "monthly", mode: "fixed", dayOfMonth: 15 };
    // Completed before this month's 15th: this month.
    expect(nextDueDate(on15, { due: null, completedOn: "2026-10-03" })).toBe("2026-10-15");
    // On the 15th itself: next month.
    expect(nextDueDate(on15, { due: "2026-10-15", completedOn: "2026-10-15" })).toBe("2026-11-15");
    // Year boundary.
    expect(nextDueDate(on15, { due: "2026-12-15", completedOn: "2026-12-20" })).toBe("2027-01-15");
  });
});

describe("nextDueDate: after completion", () => {
  it("counts from the completion day, ignoring the old due", () => {
    expect(
      nextDueDate(
        { freq: "daily", mode: "after_completion" },
        { due: "2026-10-01", completedOn: "2026-10-12" },
      ),
    ).toBe("2026-10-13");
    expect(
      nextDueDate(
        { freq: "weekly", mode: "after_completion", weekdays: [1] },
        { due: "2026-10-12", completedOn: "2026-10-14" },
      ),
    ).toBe("2026-10-21");
    expect(
      nextDueDate(
        { freq: "weekdays", mode: "after_completion" },
        { due: null, completedOn: "2026-10-16" },
      ),
    ).toBe("2026-10-19");
    expect(
      nextDueDate(
        { freq: "monthly", mode: "after_completion", dayOfMonth: 1 },
        { due: null, completedOn: "2026-01-31" },
      ),
    ).toBe("2026-02-28");
  });
});

describe("rule helpers", () => {
  it("defaults anchor on the due day", () => {
    expect(defaultRecurrence("weekly", "2026-10-16")).toEqual({
      freq: "weekly",
      mode: "fixed",
      weekdays: [5],
    });
    expect(defaultRecurrence("monthly", "2026-10-16")).toEqual({
      freq: "monthly",
      mode: "fixed",
      dayOfMonth: 16,
    });
    expect(defaultRecurrence("daily", "2026-10-16")).toEqual({ freq: "daily", mode: "fixed" });
  });

  it("describes rules in plain words", () => {
    expect(describeRecurrence({ freq: "daily", mode: "fixed" })).toBe("Daily");
    expect(describeRecurrence({ freq: "weekdays", mode: "after_completion" })).toBe(
      "Weekdays · after completion",
    );
    expect(describeRecurrence({ freq: "weekly", mode: "fixed", weekdays: [4, 1] })).toBe(
      "Weekly on Mon, Thu",
    );
    expect(describeRecurrence({ freq: "monthly", mode: "fixed", dayOfMonth: 22 })).toBe(
      "Monthly on the 22nd",
    );
    expect(describeRecurrence({ freq: "monthly", mode: "fixed", dayOfMonth: 11 })).toBe(
      "Monthly on the 11th",
    );
    expect(recurrenceTitle({ freq: "weekly", mode: "fixed", weekdays: [5] })).toBe(
      "Repeats weekly on Fri",
    );
  });
});

describe("buildNextInstance", () => {
  it("copies the parent's content and sift output, resets subtasks, protects the due", () => {
    const parent = task();
    const { create, patch, editedFields } = buildNextInstance(parent, {
      id: "task_next",
      completedOn: "2026-10-16",
      lifecycle: "active",
    });
    expect(create).toEqual({ id: "task_next", sourceText: "weekly review", sourceContext: null });
    expect(patch).toMatchObject({
      title: "Weekly review",
      description: "Look back, plan forward.",
      nextAction: "Open last week's notes",
      lifecycle: "active",
      aiStatus: "ready",
      urgency: 0.7,
      importance: 0.8,
      priorityBucket: "do_now",
      effort: "medium",
      due: "2026-10-23",
      labelIds: ["label_a"],
      rationale: "Recurring ritual.",
      confidence: 0.9,
      clarifyingQuestion: null,
      plan: { executor: "self" },
      recurrence: { freq: "weekly", mode: "fixed", weekdays: [5] },
      seriesId: "task_parent",
    });
    expect(patch.subtasks).toHaveLength(2);
    expect(patch.subtasks!.every((st) => !st.done)).toBe(true);
    expect(patch.subtasks!.map((st) => st.id)).not.toContain("st_1");
    expect(patch.subtasks!.map((st) => st.title)).toEqual(["Review calendar", "Clear inbox"]);
    expect(editedFields).toEqual(["title", "due"]);
  });

  it("keeps the series id once the series exists and copies an unsifted parent as idle", () => {
    const parent = task({ seriesId: "task_origin", aiStatus: "failed", aiError: "boom" });
    const { patch } = buildNextInstance(parent, {
      id: "task_next",
      completedOn: "2026-10-16",
      lifecycle: "inbox",
    });
    expect(patch.seriesId).toBe("task_origin");
    expect(patch.aiStatus).toBe("idle");
    expect(patch.aiError).toBeNull();
    expect(patch.lifecycle).toBe("inbox");
  });

  it("restores the series values over instance-only edits and drops them from the rule", () => {
    const parent = task({
      title: "Weekly review (skip metrics)",
      urgency: 0.2,
      priorityBucket: "schedule",
      subtasks: [{ id: "st_x", title: "Only this week", done: false, order: 0 }],
      recurrence: {
        freq: "weekly",
        mode: "fixed",
        weekdays: [5],
        seriesValues: {
          title: "Weekly review",
          urgency: 0.7,
          subtasks: [{ id: "st_1", title: "Review calendar", done: true, order: 0 }],
        },
      },
    });
    const { patch } = buildNextInstance(parent, {
      id: "task_next",
      completedOn: "2026-10-16",
      lifecycle: "active",
    });
    expect(patch.title).toBe("Weekly review");
    expect(patch.urgency).toBe(0.7);
    // Bucket re-derived from the restored scalars, not copied from the instance.
    expect(patch.priorityBucket).toBe("do_now");
    expect(patch.subtasks!.map((st) => st.title)).toEqual(["Review calendar"]);
    expect(patch.recurrence).toEqual({ freq: "weekly", mode: "fixed", weekdays: [5] });
  });

  it("refuses a parent without a rule", () => {
    expect(() =>
      buildNextInstance(task({ recurrence: null }), {
        id: "x",
        completedOn: "2026-10-16",
        lifecycle: "active",
      }),
    ).toThrow();
  });
});

describe("recurrenceAfterEdit", () => {
  const base = task();

  it("parks the pre-edit value on the first instance-only edit, once", () => {
    const first = recurrenceAfterEdit(base, ["title"], "instance");
    expect(first?.seriesValues).toEqual({ title: "Weekly review" });
    const again = recurrenceAfterEdit(
      { ...base, title: "Changed", recurrence: first! },
      ["title"],
      "instance",
    );
    expect(again).toBeUndefined();
  });

  it("a series-scoped edit un-parks the field", () => {
    const parked = recurrenceAfterEdit(base, ["title", "urgency"], "instance")!;
    const released = recurrenceAfterEdit({ ...base, recurrence: parked }, ["title"], "series");
    expect(released?.seriesValues).toEqual({ urgency: 0.7 });
    const empty = recurrenceAfterEdit({ ...base, recurrence: released! }, ["urgency"], "series")!;
    expect("seriesValues" in empty).toBe(false);
    expect(hasInstanceEdits(empty)).toBe(false);
    expect(hasInstanceEdits(parked)).toBe(true);
  });

  it("ignores non-series fields and one-off tasks", () => {
    expect(recurrenceAfterEdit(base, ["lifecycle", "due"], "instance")).toBeUndefined();
    expect(recurrenceAfterEdit(base, ["title"], "series")).toBeUndefined();
    expect(recurrenceAfterEdit(task({ recurrence: null }), ["title"], "instance")).toBeUndefined();
  });
});

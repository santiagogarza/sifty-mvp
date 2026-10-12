import { localDay, nextInstanceId, spawnNextInstance } from "@/lib/recurrence/spawn";
import { describe, expect, it } from "vitest";
import { getTestRepos } from "../setup";

/**
 * Completing a recurring task spawns its next instance: a ready copy with
 * the schedule's due, created once no matter how many times completion is
 * reported, and without any AI run.
 */

async function seedRecurring() {
  const repos = getTestRepos();
  const user = await repos.users.create({
    email: "repeat@example.com",
    displayName: "R",
    isCreator: false,
  });
  const label = await repos.labels.ensure(user.id, {
    id: "label_rit",
    name: "Ritual",
    tone: "sage",
  });
  const created = await repos.tasks.create(user.id, {
    sourceText: "weekly review every friday",
    sourceContext: null,
  });
  const parent = (await repos.tasks.update(
    user.id,
    created.id,
    {
      title: "Weekly review",
      nextAction: "Open last week's notes",
      lifecycle: "done",
      aiStatus: "ready",
      urgency: 0.7,
      importance: 0.8,
      effort: "medium",
      due: "2026-10-16",
      rationale: "Recurring ritual.",
      confidence: 0.9,
      labelIds: [label.id],
      subtasks: [{ id: "st_1", title: "Review calendar", done: true, order: 0 }],
      recurrence: { freq: "weekly", mode: "fixed", weekdays: [5] },
      seriesId: created.id,
      plan: {
        executor: "self",
        approach: null,
        connectors: [],
        readyForAi: false,
        blockers: null,
        promptVersion: "plan.v1",
      },
    },
    { editedFields: ["title"] },
  ))!;
  return { repos, user, parent, label };
}

describe("spawnNextInstance", () => {
  it("creates the next instance already sifted, with the schedule's due and no AI run", async () => {
    const { repos, user, parent, label } = await seedRecurring();
    const result = await spawnNextInstance(repos, user.id, {
      parent,
      previousLifecycle: "active",
      timeZone: "America/New_York",
      now: new Date("2026-10-16T15:00:00Z"),
    });
    expect(result?.created).toBe(true);
    const next = result!.task;
    expect(next.id).toBe(nextInstanceId(parent.id));
    expect(next.id).not.toBe(parent.id);
    expect(next).toMatchObject({
      title: "Weekly review",
      nextAction: "Open last week's notes",
      lifecycle: "active",
      aiStatus: "ready",
      aiAttempts: 0,
      siftId: null,
      urgency: 0.7,
      importance: 0.8,
      priorityBucket: "do_now",
      effort: "medium",
      due: "2026-10-23",
      rationale: "Recurring ritual.",
      confidence: 0.9,
      labelIds: [label.id],
      recurrence: { freq: "weekly", mode: "fixed", weekdays: [5] },
      seriesId: parent.id,
      completedAt: null,
      sourceText: "weekly review every friday",
    });
    expect(next.subtasks).toEqual([
      expect.objectContaining({ title: "Review calendar", done: false, order: 0 }),
    ]);
    expect(next.subtasks[0]!.id).not.toBe("st_1");
    expect(next.editedFields).toEqual(["title", "due"]);
    expect(next.plan?.executor).toBe("self");

    // The parent is untouched and no sift was spent.
    expect((await repos.tasks.get(user.id, parent.id))?.lifecycle).toBe("done");
    expect(await repos.aiRuns.list(user.id)).toEqual([]);
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(0);
  });

  it("is idempotent: a second completion returns the same instance, untouched", async () => {
    const { repos, user, parent } = await seedRecurring();
    const first = await spawnNextInstance(repos, user.id, { parent, previousLifecycle: "active" });
    // The next instance moved on in the meantime.
    await repos.tasks.update(user.id, first!.task.id, { title: "Edited by hand" });
    const second = await spawnNextInstance(repos, user.id, { parent, previousLifecycle: "active" });
    expect(second?.created).toBe(false);
    expect(second?.task.id).toBe(first!.task.id);
    expect(second?.task.title).toBe("Edited by hand");
    const all = await repos.tasks.list(user.id);
    expect(all.filter((t) => t.seriesId === parent.id)).toHaveLength(2);
  });

  it("concurrent completions converge on one row", async () => {
    const { repos, user, parent } = await seedRecurring();
    const results = await Promise.all([
      spawnNextInstance(repos, user.id, { parent, previousLifecycle: "active" }),
      spawnNextInstance(repos, user.id, { parent, previousLifecycle: "active" }),
    ]);
    expect(new Set(results.map((r) => r!.task.id)).size).toBe(1);
    expect((await repos.tasks.list(user.id)).filter((t) => t.seriesId === parent.id)).toHaveLength(
      2,
    );
  });

  it("lands in the parent's previous status, or Focus when that status is terminal", async () => {
    const { repos, user, parent } = await seedRecurring();
    const fromInbox = await spawnNextInstance(repos, user.id, {
      parent,
      previousLifecycle: "inbox",
    });
    expect(fromInbox?.task.lifecycle).toBe("inbox");
    const dropped = await repos.tasks.update(user.id, parent.id, { title: "Other" });
    // A different parent id so a fresh successor is derived.
    const other = await repos.tasks.create(user.id, { sourceText: "x", sourceContext: null });
    const otherParent = (await repos.tasks.update(user.id, other.id, {
      recurrence: { freq: "daily", mode: "fixed" },
      lifecycle: "done",
    }))!;
    expect(dropped).toBeTruthy();
    const fromDone = await spawnNextInstance(repos, user.id, {
      parent: otherParent,
      previousLifecycle: "done",
    });
    expect(fromDone?.task.lifecycle).toBe("active");
  });

  it("does nothing for a one-off task", async () => {
    const { repos, user, parent } = await seedRecurring();
    expect(
      await spawnNextInstance(repos, user.id, {
        parent: { ...parent, recurrence: null },
        previousLifecycle: "active",
      }),
    ).toBeNull();
  });

  it("uses the client's calendar day for 'after completion'", async () => {
    const { repos, user, parent } = await seedRecurring();
    const after = (await repos.tasks.update(user.id, parent.id, {
      recurrence: { freq: "daily", mode: "after_completion" },
    }))!;
    // 03:00 UTC on the 17th is still the evening of the 16th in Los Angeles.
    const now = new Date("2026-10-17T03:00:00Z");
    const la = await spawnNextInstance(repos, user.id, {
      parent: after,
      previousLifecycle: "active",
      timeZone: "America/Los_Angeles",
      now,
    });
    expect(la?.task.due).toBe("2026-10-17");
  });
});

describe("localDay", () => {
  it("resolves the calendar day in the given zone, UTC by default", () => {
    const now = new Date("2026-10-17T03:00:00Z");
    expect(localDay(now, null)).toBe("2026-10-17");
    expect(localDay(now, "America/Los_Angeles")).toBe("2026-10-16");
    expect(localDay(now, "Pacific/Auckland")).toBe("2026-10-17");
    expect(localDay(now, "Not/AZone")).toBe("2026-10-17");
  });
});

describe("nextInstanceId", () => {
  it("is deterministic, distinct per parent, and a valid client id", () => {
    expect(nextInstanceId("task_a")).toBe(nextInstanceId("task_a"));
    expect(nextInstanceId("task_a")).not.toBe(nextInstanceId("task_b"));
    expect(nextInstanceId("task_a")).toMatch(/^[a-z]+_[a-z0-9]+$/);
    expect(nextInstanceId("task_a").length).toBeLessThanOrEqual(64);
  });
});

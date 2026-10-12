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
      completedOn: "2026-10-16",
    });
    expect(result?.created).toBe(true);
    const next = result!.task;
    expect(next.id).toBe(nextInstanceId(parent.id, parent.completedAt));
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

  it("is idempotent: a replayed completion returns the same instance, untouched", async () => {
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

  it("un-complete then complete again spawns nothing while the successor is still open", async () => {
    const { repos, user, parent } = await seedRecurring();
    const first = await spawnNextInstance(repos, user.id, { parent, previousLifecycle: "active" });

    await repos.tasks.update(user.id, parent.id, { lifecycle: "active" });
    await new Promise((r) => setTimeout(r, 5)); // a distinct completedAt
    const again = (await repos.tasks.update(user.id, parent.id, { lifecycle: "done" }))!;
    expect(again.completedAt).not.toBe(parent.completedAt);

    const second = await spawnNextInstance(repos, user.id, {
      parent: again,
      previousLifecycle: "active",
    });
    expect(second?.created).toBe(false);
    expect(second?.task.id).toBe(first!.task.id);
    expect((await repos.tasks.list(user.id)).filter((t) => t.seriesId === parent.id)).toHaveLength(
      2,
    );
  });

  it("a deleted successor does not block the series: re-completing spawns a fresh one", async () => {
    const { repos, user, parent } = await seedRecurring();
    const first = await spawnNextInstance(repos, user.id, { parent, previousLifecycle: "active" });
    await repos.tasks.delete(user.id, first!.task.id);

    await repos.tasks.update(user.id, parent.id, { lifecycle: "active" });
    await new Promise((r) => setTimeout(r, 5));
    const again = (await repos.tasks.update(user.id, parent.id, { lifecycle: "done" }))!;
    const second = await spawnNextInstance(repos, user.id, {
      parent: again,
      previousLifecycle: "active",
    });
    expect(second?.created).toBe(true);
    expect(second?.task.id).not.toBe(first!.task.id);
    expect(second?.task.seriesId).toBe(parent.id);
  });

  it("repairs a stub whose copy patch never landed", async () => {
    const { repos, user, parent } = await seedRecurring();
    const nextId = nextInstanceId(parent.id, parent.completedAt);
    // What a crash between create() and update() leaves behind.
    await repos.tasks.create(user.id, {
      id: nextId,
      sourceText: parent.sourceText,
      sourceContext: null,
    });
    const result = await spawnNextInstance(repos, user.id, { parent, previousLifecycle: "active" });
    expect(result?.created).toBe(true);
    expect(result?.task.id).toBe(nextId);
    expect(result?.task.seriesId).toBe(parent.id);
    expect(result?.task.title).toBe("Weekly review");
    expect(result?.task.due).toBe("2026-10-23");
  });

  it("lands in the parent's previous status, or Focus when that status is terminal", async () => {
    const { repos, user, parent } = await seedRecurring();
    const fromInbox = await spawnNextInstance(repos, user.id, {
      parent,
      previousLifecycle: "inbox",
    });
    expect(fromInbox?.task.lifecycle).toBe("inbox");
    // A different parent so a fresh successor is derived.
    const other = await repos.tasks.create(user.id, { sourceText: "x", sourceContext: null });
    const otherParent = (await repos.tasks.update(user.id, other.id, {
      recurrence: { freq: "daily", mode: "fixed" },
      lifecycle: "done",
    }))!;
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

  it("uses the client's completion day, else the client's zone, for 'after completion'", async () => {
    const { repos, user, parent } = await seedRecurring();
    const after = (await repos.tasks.update(user.id, parent.id, {
      recurrence: { freq: "daily", mode: "after_completion" },
    }))!;
    // A push that lands days later still counts from the day the user completed it.
    const late = await spawnNextInstance(repos, user.id, {
      parent: after,
      previousLifecycle: "active",
      completedOn: "2026-10-16",
      now: new Date("2026-10-20T12:00:00Z"),
    });
    expect(late?.task.due).toBe("2026-10-17");

    // Without a day: 03:00 UTC on the 17th is still the evening of the 16th in Los Angeles.
    const other = await repos.tasks.create(user.id, { sourceText: "y", sourceContext: null });
    const otherParent = (await repos.tasks.update(user.id, other.id, {
      recurrence: { freq: "daily", mode: "after_completion" },
      lifecycle: "done",
    }))!;
    const la = await spawnNextInstance(repos, user.id, {
      parent: otherParent,
      previousLifecycle: "active",
      timeZone: "America/Los_Angeles",
      now: new Date("2026-10-17T03:00:00Z"),
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
  it("is deterministic per completion, distinct per parent and per completion, and a valid client id", () => {
    const at = "2026-10-16T10:00:00.000Z";
    expect(nextInstanceId("task_a", at)).toBe(nextInstanceId("task_a", at));
    expect(nextInstanceId("task_a", at)).not.toBe(nextInstanceId("task_b", at));
    expect(nextInstanceId("task_a", at)).not.toBe(
      nextInstanceId("task_a", "2026-10-17T10:00:00.000Z"),
    );
    expect(nextInstanceId("task_a", null)).toMatch(/^[a-z]+_[a-z0-9]+$/);
    expect(nextInstanceId("task_a", at).length).toBeLessThanOrEqual(64);
  });
});

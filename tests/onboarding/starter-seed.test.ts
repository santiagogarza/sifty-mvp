import { seedStarterWorkspaceIfEmpty } from "@/lib/onboarding/seed";
import { EXAMPLE_LABEL_NAME, starterTasks } from "@/lib/onboarding/starter-tasks";
import { isTodayTask } from "@/lib/store/selectors";
import { isOverdue, isToday } from "@/lib/utils/dates";
import { describe, expect, it } from "vitest";
import { getTestRepos } from "../setup";

/**
 * First-run onboarding: a brand-new account gets three sifted example
 * tasks (no demo flag), exactly once, and deleting them sticks.
 */

async function newUser(email: string) {
  const user = await getTestRepos().users.create({
    email,
    displayName: email,
    isCreator: false,
  });
  return user.id;
}

describe("seedStarterWorkspaceIfEmpty", () => {
  it("seeds the default labels, an Example label, and three sifted tasks", async () => {
    const repos = getTestRepos();
    const userId = await newUser("fresh@example.com");

    expect(await seedStarterWorkspaceIfEmpty(repos, userId)).toBe(true);

    const [tasks, labels, memories] = await Promise.all([
      repos.tasks.list(userId),
      repos.labels.list(userId),
      repos.memories.list(userId),
    ]);
    expect(tasks).toHaveLength(3);
    expect(memories).toHaveLength(0);
    const example = labels.find((l) => l.name === EXAMPLE_LABEL_NAME);
    expect(example).toBeTruthy();
    expect(labels.length).toBeGreaterThanOrEqual(7);

    for (const task of tasks) {
      expect(task.labelIds).toContain(example!.id);
      expect(task.aiStatus).toBe("ready");
      expect(task.rationale).toBeTruthy();
      expect(task.confidence).toBeGreaterThan(0);
      expect(task.priorityBucket).not.toBe("unset");
    }
    // One lands in Today (by priority, not by date — the server's calendar
    // day may not be the user's), one has subtasks, one asks a question.
    const dated = tasks.find((t) => t.lifecycle === "active" && t.due)!;
    expect(dated).toBeTruthy();
    expect(dated.priorityBucket).toBe("do_now");
    expect(isTodayTask(dated)).toBe(true);
    expect(isOverdue(dated.due)).toBe(false);
    expect(isToday(dated.due)).toBe(false);
    expect(tasks.some((t) => t.subtasks.length === 3)).toBe(true);
    expect(tasks.some((t) => t.clarifyingQuestion && t.confidence < 0.6)).toBe(true);
    expect(tasks.filter((t) => t.lifecycle === "inbox")).toHaveLength(2);
  });

  it("never touches an account that already has a task or memory", async () => {
    const repos = getTestRepos();
    const userId = await newUser("returning@example.com");
    await seedStarterWorkspaceIfEmpty(repos, userId);

    const seeded = await repos.tasks.list(userId);
    for (const t of seeded.slice(1)) await repos.tasks.delete(userId, t.id);

    expect(await seedStarterWorkspaceIfEmpty(repos, userId)).toBe(false);
    expect(await repos.tasks.list(userId)).toHaveLength(1);

    // Everything deleted, but a memory remains: still first-run-only.
    await repos.tasks.delete(userId, seeded[0]!.id);
    await repos.memories.create(userId, { text: "I prefer mornings." });
    expect(await seedStarterWorkspaceIfEmpty(repos, userId)).toBe(false);
    expect(await repos.tasks.list(userId)).toHaveLength(0);
  });

  it("starter content is self-consistent", () => {
    const tasks = starterTasks();
    expect(tasks).toHaveLength(3);
    for (const t of tasks) {
      expect(t.labelNames).toContain(EXAMPLE_LABEL_NAME);
      expect(t.patch.confidence).toBeGreaterThan(0);
      expect(t.patch.confidence).toBeLessThanOrEqual(1);
      for (const st of t.patch.subtasks) expect(st.done).toBe(false);
    }
  });
});

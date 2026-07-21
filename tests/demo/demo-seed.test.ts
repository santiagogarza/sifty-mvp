import { signUp } from "@/lib/auth/service";
import { seedDemoWorkspaceIfEmpty } from "@/lib/demo/seed-demo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestRepos } from "../setup";

beforeEach(() => {
  vi.stubEnv("SIFTY_DEMO_SEED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SIFTY_DEMO_SEED", () => {
  it("sign-up populates a fully-triaged demo workspace", async () => {
    const repos = getTestRepos();
    const result = await signUp({ email: "demo@example.com", password: "password123" });
    expect("cookie" in result).toBe(true);
    const userId = ("user" in result ? result.user : null)!.id;

    const [tasks, memories, labels] = await Promise.all([
      repos.tasks.list(userId),
      repos.memories.list(userId),
      repos.labels.list(userId),
    ]);

    expect(tasks.length).toBeGreaterThanOrEqual(10);
    expect(memories.length).toBeGreaterThanOrEqual(3);
    expect(labels.length).toBeGreaterThanOrEqual(6);

    // Fully populated: triaged, labeled, prioritized — across the views.
    const lifecycles = new Set(tasks.map((t) => t.lifecycle));
    for (const expected of ["inbox", "active", "waiting", "someday", "done"]) {
      expect(lifecycles).toContain(expected);
    }
    for (const task of tasks) {
      expect(task.aiStatus).toBe("ready");
      expect(task.rationale).toBeTruthy();
      expect(task.confidence).toBeGreaterThan(0);
      expect(task.labelIds.length).toBeGreaterThan(0);
      expect(task.priorityBucket).not.toBe("unset");
    }
    expect(tasks.some((t) => t.subtasks.length > 0)).toBe(true);
    expect(tasks.some((t) => t.agentBrief)).toBe(true);
    expect(tasks.some((t) => t.clarifyingQuestion)).toBe(true);
    expect(tasks.some((t) => t.due)).toBe(true);
    expect(memories.some((m) => m.pinned)).toBe(true);
    const done = tasks.filter((t) => t.lifecycle === "done");
    expect(done.every((t) => t.completedAt)).toBe(true);
  });

  it("never reseeds a workspace that already has data", async () => {
    const repos = getTestRepos();
    const result = await signUp({ email: "demo2@example.com", password: "password123" });
    const userId = ("user" in result ? result.user : null)!.id;

    const before = await repos.tasks.list(userId);
    // Simulate the user clearing everything except one task.
    for (const task of before.slice(1)) {
      await repos.tasks.delete(userId, task.id);
    }
    const seeded = await seedDemoWorkspaceIfEmpty(repos, userId);
    expect(seeded).toBe(false);
    expect(await repos.tasks.list(userId)).toHaveLength(1);
  });

  it("without the flag, sign-up seeds only the default labels", async () => {
    vi.stubEnv("SIFTY_DEMO_SEED", "");
    const repos = getTestRepos();
    const result = await signUp({ email: "plain@example.com", password: "password123" });
    const userId = ("user" in result ? result.user : null)!.id;

    expect(await repos.tasks.list(userId)).toHaveLength(0);
    expect(await repos.memories.list(userId)).toHaveLength(0);
    expect((await repos.labels.list(userId)).length).toBeGreaterThanOrEqual(6);
  });
});

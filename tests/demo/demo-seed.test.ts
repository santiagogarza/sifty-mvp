import { getAuth } from "@/lib/auth/auth";
import { seedDemoWorkspaceIfEmpty } from "@/lib/demo/seed-demo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestRepos } from "../setup";

beforeEach(() => {
  vi.stubEnv("SIFTY_DEMO_SEED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function signUp(email: string): Promise<string> {
  const res = await getAuth().api.signUpEmail({
    body: { email, password: "password123", name: email.split("@")[0]! },
  });
  return res.user.id;
}

describe("SIFTY_DEMO_SEED", () => {
  it("sign-up populates a fully-triaged demo workspace", async () => {
    const repos = getTestRepos();
    const userId = await signUp("demo@example.com");

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
    const userId = await signUp("demo2@example.com");

    const before = await repos.tasks.list(userId);
    // Simulate the user clearing everything except one task.
    for (const task of before.slice(1)) {
      await repos.tasks.delete(userId, task.id);
    }
    const seeded = await seedDemoWorkspaceIfEmpty(repos, userId);
    expect(seeded).toBe(false);
    expect(await repos.tasks.list(userId)).toHaveLength(1);
  });

  it("the flag is ignored on Vercel production: only the starter examples are seeded", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const repos = getTestRepos();
    const userId = await signUp("prod@example.com");

    const tasks = await repos.tasks.list(userId);
    expect(tasks).toHaveLength(3);
    expect(tasks.some((t) => t.title === "Dentist")).toBe(true);
    expect(await repos.memories.list(userId)).toHaveLength(0);
  });

  it("without the flag, sign-up seeds the labels and the three starter examples", async () => {
    vi.stubEnv("SIFTY_DEMO_SEED", "");
    const repos = getTestRepos();
    const userId = await signUp("plain@example.com");

    const tasks = await repos.tasks.list(userId);
    expect(tasks).toHaveLength(3);
    expect(await repos.memories.list(userId)).toHaveLength(0);
    const labels = await repos.labels.list(userId);
    expect(labels.length).toBeGreaterThanOrEqual(7);
    const example = labels.find((l) => l.name === "Example")!;
    expect(tasks.every((t) => t.labelIds.includes(example.id))).toBe(true);
  });
});

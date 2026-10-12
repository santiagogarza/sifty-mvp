import type { Repos } from "@/lib/db/repos";
import { IdConflictError } from "@/lib/db/repos/types";
import { describe, expect, it } from "vitest";

/**
 * Repository contract, shared by the in-memory and Postgres suites.
 *
 * `tenancy.test.ts` runs it against the memory repos on every CI run;
 * `pg-repos.test.ts` runs the same cases against a real Postgres when
 * `TEST_DATABASE_URL` is set (the `db` job on `production` PRs). Both
 * implementations must pass identically, which is what lets routes and
 * tests treat `getRepos()` as interchangeable.
 *
 * `getRepos` is called inside each test so the suite can hand out a fresh
 * (or freshly truncated) store per case.
 */
export function describeRepoContract(getRepos: () => Repos): void {
  describe("tenancy", () => {
    it("never returns or mutates another user's rows", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "a@example.com");
      const b = await createUser(repos, "b@example.com");

      const aTask = await repos.tasks.create(a.id, {
        sourceText: "A's secret task",
        sourceContext: null,
      });

      // B sees nothing
      expect(await repos.tasks.list(b.id)).toEqual([]);
      expect(await repos.tasks.get(b.id, aTask.id)).toBeNull();
      expect(await repos.tasks.update(b.id, aTask.id, { title: "hijacked" })).toBeNull();
      expect(await repos.tasks.delete(b.id, aTask.id)).toBe(false);

      // A still has their original
      const stillThere = await repos.tasks.get(a.id, aTask.id);
      expect(stillThere?.title).toBe(aTask.title);

      // Memories are isolated too
      await repos.memories.create(a.id, { text: "I avoid deep work after 4pm" });
      expect(await repos.memories.list(b.id)).toEqual([]);

      // Labels are isolated, and B can't link A's label to B's task
      const aLabel = await repos.labels.ensure(a.id, {
        id: "label_a1",
        name: "Work",
        tone: "sand",
      });
      expect(await repos.labels.list(b.id)).toEqual([]);
      const bTask = await repos.tasks.create(b.id, { sourceText: "B task", sourceContext: null });
      const bPatched = await repos.tasks.update(b.id, bTask.id, { labelIds: [aLabel.id] });
      expect(bPatched?.labelIds).toEqual([]);

      // aiRuns counts don't leak
      await repos.aiRuns.insert(aiRun(a.id, aTask.id));
      expect(await repos.aiRuns.countSucceededToday(a.id)).toBe(1);
      expect(await repos.aiRuns.countSucceededToday(b.id)).toBe(0);
    });

    it("labels.ensure never claims or clobbers another tenant's id", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "la@example.com");
      const b = await createUser(repos, "lb@example.com");

      const aLabel = await repos.labels.ensure(a.id, {
        id: "label_x1",
        name: "Work",
        tone: "sand",
      });
      // B pushes a label suggesting A's id: gets a fresh id, A's row intact.
      const bLabel = await repos.labels.ensure(b.id, {
        id: "label_x1",
        name: "Focus",
        tone: "mist",
      });
      expect(bLabel.id).not.toBe(aLabel.id);
      expect(await repos.labels.list(a.id)).toEqual([aLabel]);
      expect(await repos.labels.list(b.id)).toEqual([bLabel]);
    });

    it("memories.create is idempotent for the owner and 409-conflicts across tenants", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "ma@example.com");
      const b = await createUser(repos, "mb@example.com");

      const created = await repos.memories.create(a.id, { id: "mem_x1", text: "A's note" });
      const replayed = await repos.memories.create(a.id, { id: "mem_x1", text: "changed" });
      expect(replayed.id).toBe(created.id);
      expect(replayed.text).toBe("A's note"); // replay returns, never overwrites

      await expect(repos.memories.create(b.id, { id: "mem_x1", text: "B steals" })).rejects.toThrow(
        IdConflictError,
      );
      expect((await repos.memories.list(a.id))[0]!.text).toBe("A's note");
    });
  });

  describe("round trips", () => {
    it("users: create, lookup by id/email, stripe customer mapping", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "round@example.com");
      expect(await repos.users.getById(u.id)).toEqual(u);
      const byEmail = await repos.users.getByEmail("round@example.com");
      expect(byEmail?.id).toBe(u.id);

      await repos.users.setStripeCustomerId(u.id, "cus_123");
      expect((await repos.users.findByStripeCustomerId("cus_123"))?.id).toBe(u.id);
      expect(await repos.users.findByStripeCustomerId("cus_nope")).toBeNull();
    });

    it("entitlements: trial starts once, upsert is idempotent", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "ent@example.com");
      expect(await repos.entitlements.get(u.id)).toBeNull();

      const first = await repos.entitlements.startTrialIfMissing(u.id, 30);
      const second = await repos.entitlements.startTrialIfMissing(u.id, 30);
      expect(second.trialStartedAt).toBe(first.trialStartedAt);

      const active = await repos.entitlements.upsert(u.id, {
        ...first,
        tier: "pro",
        subscriptionActive: true,
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        stripeStatus: "active",
        currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(active.subscriptionActive).toBe(true);
      expect((await repos.entitlements.get(u.id))?.stripeSubscriptionId).toBe("sub_1");
    });

    it("tasks: create with client id, patch, subtasks, delete", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "tasks@example.com");

      const task = await repos.tasks.create(u.id, {
        id: "task_client1",
        sourceText: "Write the launch post",
        sourceContext: null,
      });
      expect(task.id).toBe("task_client1");
      expect(task.lifecycle).not.toBe("done");

      const done = await repos.tasks.update(u.id, task.id, { lifecycle: "done" });
      expect(done?.lifecycle).toBe("done");

      const withSub = await repos.tasks.addSubtask(u.id, task.id, {
        id: "sub_1",
        title: "Outline",
        done: false,
        order: 0,
      });
      expect(withSub?.subtasks.map((s) => s.id)).toEqual(["sub_1"]);
      const toggled = await repos.tasks.toggleSubtask(u.id, task.id, "sub_1");
      expect(toggled?.subtasks[0]?.done).toBe(true);
      const removed = await repos.tasks.removeSubtask(u.id, task.id, "sub_1");
      expect(removed?.subtasks).toEqual([]);

      expect(await repos.tasks.delete(u.id, task.id)).toBe(true);
      expect(await repos.tasks.get(u.id, task.id)).toBeNull();
      expect(await repos.tasks.list(u.id)).toEqual([]);
    });

    it("memories: update and delete", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "mem@example.com");
      const m = await repos.memories.create(u.id, { text: "Prefers mornings", kind: "preference" });
      const pinned = await repos.memories.update(u.id, m.id, { pinned: true });
      expect(pinned?.pinned).toBe(true);
      expect(await repos.memories.delete(u.id, m.id)).toBe(true);
      expect(await repos.memories.list(u.id)).toEqual([]);
    });

    it("aiRuns: window counts and list ordering", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "runs@example.com");
      await repos.aiRuns.insert(aiRun(u.id, null));
      await repos.aiRuns.insert({ ...aiRun(u.id, null), status: "failed", error: "boom" });

      expect(await repos.aiRuns.countSucceededToday(u.id)).toBe(1);
      expect(await repos.aiRuns.countSince(u.id, new Date(Date.now() - 60_000))).toBe(2);
      expect(await repos.aiRuns.countSince(u.id, new Date(Date.now() + 60_000))).toBe(0);
      const listed = await repos.aiRuns.list(u.id, 10);
      expect(listed).toHaveLength(2);
      expect(listed.map((r) => r.status).sort()).toEqual(["failed", "succeeded"]);
    });

    it("stripeEvents: first sight wins, delete re-arms", async () => {
      const repos = getRepos();
      expect(await repos.stripeEvents.recordIfNew("evt_1", "invoice.paid")).toBe(true);
      expect(await repos.stripeEvents.recordIfNew("evt_1", "invoice.paid")).toBe(false);
      await repos.stripeEvents.delete("evt_1");
      expect(await repos.stripeEvents.recordIfNew("evt_1", "invoice.paid")).toBe(true);
    });
  });
}

async function createUser(repos: Repos, email: string) {
  return repos.users.create({
    email,
    displayName: email.split("@")[0] ?? email,
    isCreator: false,
  });
}

function aiRun(userId: string, taskId: string | null) {
  return {
    userId,
    taskId,
    promptVersion: "triage.v1",
    model: "anthropic/claude-haiku-4-5",
    transport: "gateway",
    status: "succeeded" as const,
    durationMs: 100,
    inputTokens: 10,
    outputTokens: 20,
    costCents: 1,
    offline: false,
    error: null,
  };
}

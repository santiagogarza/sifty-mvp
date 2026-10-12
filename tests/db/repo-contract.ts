import type { Repos } from "@/lib/db/repos";
import {
  IdConflictError,
  NOTIFICATION_CLAIM_LEASE_MS,
  SIFT_ACCOUNTING_STAGE,
} from "@/lib/db/repos/types";
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
    it("users: create, lookup by id/email, stripe customer mapping, creator flag", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "round@example.com");
      expect(await repos.users.getById(u.id)).toEqual(u);
      const byEmail = await repos.users.getByEmail("round@example.com");
      expect(byEmail?.id).toBe(u.id);

      await repos.users.setStripeCustomerId(u.id, "cus_123");
      expect((await repos.users.findByStripeCustomerId("cus_123"))?.id).toBe(u.id);
      expect(await repos.users.findByStripeCustomerId("cus_nope")).toBeNull();

      expect(u.isCreator).toBe(false);
      await repos.users.setCreator(u.id, true);
      expect((await repos.users.getById(u.id))?.isCreator).toBe(true);
      await repos.users.setCreator(u.id, false);
      expect((await repos.users.getById(u.id))?.isCreator).toBe(false);
      // Unknown ids are a no-op, not an error.
      await repos.users.setCreator("user_nobody", true);
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

      // A customer id written through update() is findable the same way as
      // one written through upsert() or users.setStripeCustomerId().
      const other = await createUser(repos, "ent-update@example.com");
      await repos.entitlements.update(other.id, (current) => ({
        ...(current ?? first),
        stripeCustomerId: "cus_via_update",
      }));
      expect((await repos.users.findByStripeCustomerId("cus_via_update"))?.id).toBe(other.id);
      expect((await repos.entitlements.get(other.id))?.stripeCustomerId).toBe("cus_via_update");
    });

    it("entitlements: dunning columns round-trip and expired grace periods are listed oldest first", async () => {
      const repos = getRepos();
      const now = new Date("2026-10-12T12:00:00.000Z");
      const older = await createUser(repos, "grace-older@example.com");
      const newer = await createUser(repos, "grace-newer@example.com");
      const open = await createUser(repos, "grace-open@example.com");
      const base = {
        ...(await repos.entitlements.startTrialIfMissing(older.id, 30)),
        tier: "pro" as const,
        subscriptionActive: false,
        stripeSubscriptionId: "sub_g",
        stripeStatus: "past_due",
      };
      await repos.entitlements.upsert(older.id, {
        ...base,
        graceEndsAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
        stripeSyncedAt: new Date(now.getTime() - 9 * 86_400_000).toISOString(),
      });
      await repos.entitlements.upsert(newer.id, {
        ...base,
        graceEndsAt: new Date(now.getTime() - 86_400_000).toISOString(),
        stripeSyncedAt: null,
      });
      await repos.entitlements.upsert(open.id, {
        ...base,
        graceEndsAt: new Date(now.getTime() + 86_400_000).toISOString(),
        stripeSyncedAt: now.toISOString(),
      });

      const read = await repos.entitlements.get(older.id);
      expect(read?.graceEndsAt).toBe(new Date(now.getTime() - 2 * 86_400_000).toISOString());
      expect(read?.stripeSyncedAt).toBe(new Date(now.getTime() - 9 * 86_400_000).toISOString());
      expect((await repos.entitlements.get(newer.id))?.stripeSyncedAt).toBeNull();

      expect(await repos.entitlements.listExpiredGracePeriods(now, 10)).toEqual([
        older.id,
        newer.id,
      ]);
      expect(await repos.entitlements.listExpiredGracePeriods(now, 1)).toEqual([older.id]);

      await repos.entitlements.update(older.id, (current) => ({ ...current!, graceEndsAt: null }));
      expect(await repos.entitlements.listExpiredGracePeriods(now, 10)).toEqual([newer.id]);
      expect((await repos.entitlements.get(older.id))?.graceEndsAt).toBeNull();
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
      expect(done?.completedAt).toBeTruthy();
      // A repeated completion keeps the first completion time.
      const again = await repos.tasks.update(u.id, task.id, { lifecycle: "done" });
      expect(again?.completedAt).toBe(done?.completedAt);
      const reopened = await repos.tasks.update(u.id, task.id, { lifecycle: "active" });
      expect(reopened?.completedAt).toBeNull();
      await repos.tasks.update(u.id, task.id, { lifecycle: "done" });

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

    it("tasks: recurrence and series id round-trip, and clear to null", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "repeat@example.com");
      const task = await repos.tasks.create(u.id, {
        sourceText: "Weekly review",
        sourceContext: null,
      });
      expect(task.recurrence).toBeNull();
      expect(task.seriesId).toBeNull();

      const rule = {
        freq: "weekly" as const,
        mode: "fixed" as const,
        weekdays: [1, 4],
        seriesValues: { title: "Weekly review", urgency: 0.7 },
      };
      const set = await repos.tasks.update(u.id, task.id, { recurrence: rule, seriesId: task.id });
      expect(set?.recurrence).toEqual(rule);
      expect(set?.seriesId).toBe(task.id);
      expect((await repos.tasks.list(u.id))[0]?.recurrence).toEqual(rule);

      // A narrow patch to another field leaves the rule alone.
      const retitled = await repos.tasks.update(u.id, task.id, { title: "Review" });
      expect(retitled?.recurrence).toEqual(rule);

      const cleared = await repos.tasks.update(u.id, task.id, { recurrence: null });
      expect(cleared?.recurrence).toBeNull();
      expect(cleared?.seriesId).toBe(task.id);
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
      expect(listed[0]!.promptVersion).toBe("triage.v1");
      expect(listed[0]!.siftId).toBeNull();
      expect(listed[0]!.workflowRunId).toBeNull();
    });

    it("aiRuns: a workflow sift counts once, however many stage rows it writes", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "sifts@example.com");
      const siftId = "sift_abc";
      // The accounting row is written when the sift is accepted…
      await repos.aiRuns.insert({
        ...aiRun(u.id, "task_1"),
        stage: SIFT_ACCOUNTING_STAGE,
        siftId,
        model: "sifty.workflow",
        transport: "workflow",
        promptVersion: "sift.v1",
      });
      // …then one row per stage step carries the cost detail.
      for (const stage of ["enrich", "prioritize", "triage", "subtasks", "plan"]) {
        await repos.aiRuns.insert({
          ...aiRun(u.id, "task_1"),
          stage,
          siftId,
          workflowRunId: "wrun_1",
          costCents: 0.5,
        });
      }
      // A legacy single-shot run (agent brief) still counts as one.
      await repos.aiRuns.insert({ ...aiRun(u.id, null), stage: null });

      expect(await repos.aiRuns.countSucceededToday(u.id)).toBe(2);
      expect(await repos.aiRuns.countSince(u.id, new Date(Date.now() - 60_000))).toBe(2);
      const rows = await repos.aiRuns.list(u.id);
      expect(rows).toHaveLength(7);
      expect(rows.filter((r) => r.siftId === siftId)).toHaveLength(6);
      expect(rows.find((r) => r.stage === "plan")?.workflowRunId).toBe("wrun_1");
    });

    it("aiRuns: setStatus flips the accounting row and is tenant-scoped", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "status-a@example.com");
      const b = await createUser(repos, "status-b@example.com");
      const { id } = await repos.aiRuns.insert({
        ...aiRun(a.id, null),
        stage: SIFT_ACCOUNTING_STAGE,
        siftId: "sift_x",
      });
      expect(await repos.aiRuns.countSucceededToday(a.id)).toBe(1);

      await repos.aiRuns.setStatus(b.id, id, "failed", "not yours");
      expect(await repos.aiRuns.countSucceededToday(a.id)).toBe(1);

      await repos.aiRuns.setStatus(a.id, id, "failed", "workflow died");
      expect(await repos.aiRuns.countSucceededToday(a.id)).toBe(0);
      const [row] = await repos.aiRuns.list(a.id, 1);
      expect(row?.status).toBe("failed");
      expect(row?.error).toBe("workflow died");
    });

    it("aiRuns: rollup aggregates every tenant by day, stage, model, and user", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "roll-a@example.com");
      const b = await createUser(repos, "roll-b@example.com");
      await repos.aiRuns.insert({
        ...aiRun(a.id, null),
        stage: "enrich",
        model: "anthropic/claude-haiku-4.5",
        inputTokens: 100,
        outputTokens: 10,
        costCents: 0.25,
      });
      await repos.aiRuns.insert({
        ...aiRun(a.id, null),
        stage: "plan",
        model: "anthropic/claude-sonnet-4.5",
        inputTokens: 200,
        outputTokens: 20,
        costCents: 1.5,
        status: "failed",
        error: "boom",
      });
      await repos.aiRuns.insert({
        ...aiRun(b.id, null),
        stage: "enrich",
        model: "anthropic/claude-haiku-4.5",
        inputTokens: 50,
        outputTokens: 5,
        costCents: null,
      });
      const since = new Date(Date.now() - 60_000);

      const byStage = await repos.aiRuns.rollup({ since, by: "stage" });
      expect(byStage.map((r) => r.key)).toEqual(["plan", "enrich"]);
      expect(byStage[1]).toEqual({
        key: "enrich",
        runs: 2,
        failed: 0,
        inputTokens: 150,
        outputTokens: 15,
        costCents: 0.25,
      });
      expect(byStage[0]).toMatchObject({ key: "plan", runs: 1, failed: 1, costCents: 1.5 });

      const byModel = await repos.aiRuns.rollup({ since, by: "model" });
      expect(byModel.map((r) => r.key)).toEqual([
        "anthropic/claude-sonnet-4.5",
        "anthropic/claude-haiku-4.5",
      ]);

      const byUser = await repos.aiRuns.rollup({ since, by: "user" });
      expect(byUser.map((r) => [r.key, r.runs])).toEqual([
        [a.id, 2],
        [b.id, 1],
      ]);

      const byDay = await repos.aiRuns.rollup({ since, by: "day" });
      expect(byDay).toHaveLength(1);
      expect(byDay[0]!.key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(byDay[0]!.runs).toBe(3);

      // The window is honored.
      expect(
        await repos.aiRuns.rollup({ since: new Date(Date.now() + 60_000), by: "day" }),
      ).toEqual([]);
    });

    it("tasks.list honors lifecycles and limit, newest-updated first", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "list-opts@example.com");
      const a = await repos.tasks.create(u.id, { sourceText: "A", sourceContext: null });
      const b = await repos.tasks.create(u.id, { sourceText: "B", sourceContext: null });
      const c = await repos.tasks.create(u.id, { sourceText: "C", sourceContext: null });
      await repos.tasks.update(u.id, c.id, { lifecycle: "done" });
      await repos.tasks.update(u.id, a.id, { lifecycle: "active" });

      const open = await repos.tasks.list(u.id, { lifecycles: ["inbox", "active", "waiting"] });
      expect(open.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
      const one = await repos.tasks.list(u.id, { lifecycles: ["inbox", "active"], limit: 1 });
      expect(one).toHaveLength(1);
      expect([a.id, b.id]).toContain(one[0]!.id);
      expect(await repos.tasks.list(u.id, { limit: 0 })).toEqual([]);
      // Unbounded: every lifecycle, same-millisecond updates in any order.
      expect((await repos.tasks.list(u.id)).map((t) => t.id).sort()).toEqual(
        [a.id, b.id, c.id].sort(),
      );
    });

    it("labels.listByIds returns only the user's labels among the ids", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "labels-a@example.com");
      const b = await createUser(repos, "labels-b@example.com");
      const work = await repos.labels.ensure(a.id, {
        id: "label_la_work",
        name: "Work",
        tone: "mist",
      });
      await repos.labels.ensure(a.id, { id: "label_la_home", name: "Home", tone: "sand" });
      const theirs = await repos.labels.ensure(b.id, {
        id: "label_lb_work",
        name: "Work",
        tone: "mist",
      });

      const got = await repos.labels.listByIds(a.id, [work.id, theirs.id, "label_nope"]);
      expect(got.map((l) => l.id)).toEqual([work.id]);
      expect(await repos.labels.listByIds(a.id, [])).toEqual([]);
    });

    it("tasks.update with ifSiftId is a compare-and-set on the sift owner", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "cas@example.com");
      const t = await repos.tasks.create(u.id, { sourceText: "Claim me", sourceContext: null });

      // Two claims race from the same null read: exactly one wins.
      const [a, b] = await Promise.all([
        repos.tasks.update(u.id, t.id, { siftId: "sift_a" }, { ifSiftId: null }),
        repos.tasks.update(u.id, t.id, { siftId: "sift_b" }, { ifSiftId: null }),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      const winner = (await repos.tasks.get(u.id, t.id))!.siftId;
      expect(["sift_a", "sift_b"]).toContain(winner);

      // A stale owner cannot write; the current owner can.
      const loser = winner === "sift_a" ? "sift_b" : "sift_a";
      expect(
        await repos.tasks.update(u.id, t.id, { title: "stale" }, { ifSiftId: loser }),
      ).toBeNull();
      expect((await repos.tasks.get(u.id, t.id))!.title).toBe("Claim me");
      const ok = await repos.tasks.update(u.id, t.id, { title: "fresh" }, { ifSiftId: winner });
      expect(ok?.title).toBe("fresh");
      // Unconditional updates are unaffected.
      expect((await repos.tasks.update(u.id, t.id, { title: "any" }))?.title).toBe("any");
    });

    it("labels.list limit, labels.findByNames (case-insensitive), memories.list filters", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "bounded@example.com");
      await repos.labels.ensure(u.id, { id: "label_b1", name: "Work", tone: "mist" });
      await repos.labels.ensure(u.id, { id: "label_b2", name: "Home", tone: "sand" });
      await repos.labels.ensure(u.id, { id: "label_b3", name: "Errand", tone: "sage" });
      expect(await repos.labels.list(u.id, { limit: 2 })).toHaveLength(2);
      const found = await repos.labels.findByNames(u.id, ["work", "ERRAND", "nope"]);
      expect(found.map((l) => l.name).sort()).toEqual(["Errand", "Work"]);
      expect(await repos.labels.findByNames(u.id, [])).toEqual([]);

      await repos.memories.create(u.id, { text: "pinned one", pinned: true });
      await repos.memories.create(u.id, { text: "pinned two", pinned: true });
      await repos.memories.create(u.id, { text: "loose", pinned: false });
      const pinned = await repos.memories.list(u.id, { pinned: true });
      expect(pinned.map((m) => m.text).sort()).toEqual(["pinned one", "pinned two"]);
      expect(await repos.memories.list(u.id, { pinned: true, limit: 1 })).toHaveLength(1);
      expect(await repos.memories.list(u.id)).toHaveLength(3);
    });

    it("stripeEvents: first sight wins, delete re-arms", async () => {
      const repos = getRepos();
      expect(await repos.stripeEvents.recordIfNew("evt_1", "invoice.paid")).toBe(true);
      expect(await repos.stripeEvents.recordIfNew("evt_1", "invoice.paid")).toBe(false);
      await repos.stripeEvents.delete("evt_1");
      expect(await repos.stripeEvents.recordIfNew("evt_1", "invoice.paid")).toBe(true);
    });
  });

  describe("notifications", () => {
    const prefs = {
      timezone: "Europe/Ljubljana",
      emailEnabled: true,
      pushEnabled: false,
      morningPlanEnabled: true,
      morningPlanHour: 7,
      dueRemindersEnabled: true,
      dueReminderHour: 15,
      weeklyReviewEnabled: true,
      weeklyReviewDay: 0,
      quietHoursStart: 22,
      quietHoursEnd: 7,
    };

    it("preferences: upsert replaces, get round-trips, list pages by user id", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "prefs-a@example.com");
      const b = await createUser(repos, "prefs-b@example.com");
      const c = await createUser(repos, "prefs-c@example.com");
      expect(await repos.notificationPreferences.get(a.id)).toBeNull();

      await repos.notificationPreferences.upsert(a.id, prefs);
      const saved = await repos.notificationPreferences.upsert(a.id, {
        ...prefs,
        morningPlanHour: 6,
        quietHoursStart: null,
        quietHoursEnd: null,
      });
      expect(saved).toMatchObject({ userId: a.id, morningPlanHour: 6, quietHoursStart: null });
      expect(await repos.notificationPreferences.get(a.id)).toMatchObject({
        morningPlanHour: 6,
        timezone: "Europe/Ljubljana",
      });

      await repos.notificationPreferences.upsert(b.id, prefs);
      // c never saved: not a digest candidate.
      void c;
      const ids = [a.id, b.id].sort();
      const page1 = await repos.notificationPreferences.list(1);
      expect(page1.map((p) => p.userId)).toEqual([ids[0]]);
      const page2 = await repos.notificationPreferences.list(1, page1[0]!.userId);
      expect(page2.map((p) => p.userId)).toEqual([ids[1]]);
      expect(await repos.notificationPreferences.list(1, page2[0]!.userId)).toEqual([]);
    });

    it("pushSubscriptions: endpoint is unique and moves between accounts", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "push-a@example.com");
      const b = await createUser(repos, "push-b@example.com");
      const input = {
        endpoint: "https://push.example/e1",
        p256dh: "p1",
        auth: "a1",
        userAgent: "ua",
      };

      const first = await repos.pushSubscriptions.upsert(a.id, input);
      await repos.pushSubscriptions.touch(first.id, new Date("2026-10-12T05:00:00Z"));
      const refreshed = await repos.pushSubscriptions.upsert(a.id, { ...input, p256dh: "p2" });
      expect(refreshed.id).toBe(first.id);
      expect(refreshed.p256dh).toBe("p2");
      expect(refreshed.lastUsedAt).toBe("2026-10-12T05:00:00.000Z");

      // Same browser, different account: the row follows the new owner.
      const moved = await repos.pushSubscriptions.upsert(b.id, input);
      expect(moved.id).toBe(first.id);
      expect(moved.lastUsedAt).toBeNull();
      expect(await repos.pushSubscriptions.listForUser(a.id)).toEqual([]);
      expect((await repos.pushSubscriptions.listForUser(b.id)).map((s) => s.endpoint)).toEqual([
        input.endpoint,
      ]);

      // Tenancy: a cannot delete b's subscription by endpoint.
      expect(await repos.pushSubscriptions.deleteByEndpoint(a.id, input.endpoint)).toBe(false);
      expect(await repos.pushSubscriptions.deleteByEndpoint(b.id, input.endpoint)).toBe(true);
      expect(await repos.pushSubscriptions.listForUser(b.id)).toEqual([]);

      const again = await repos.pushSubscriptions.upsert(b.id, input);
      await repos.pushSubscriptions.remove(again.id);
      expect(await repos.pushSubscriptions.listForUser(b.id)).toEqual([]);
    });

    it("notificationSends: one claim per (user, kind, channel, period)", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "sends-a@example.com");
      const b = await createUser(repos, "sends-b@example.com");
      const key = {
        kind: "morning_plan" as const,
        channel: "email" as const,
        periodKey: "2026-10-12",
      };

      const claim = await repos.notificationSends.claim({ userId: a.id, ...key });
      expect(claim).not.toBeNull();
      expect(await repos.notificationSends.claim({ userId: a.id, ...key })).toBeNull();
      // Other channel, other period, other user: all still claimable.
      expect(
        await repos.notificationSends.claim({ userId: a.id, ...key, channel: "push" }),
      ).not.toBeNull();
      expect(
        await repos.notificationSends.claim({ userId: a.id, ...key, periodKey: "2026-10-13" }),
      ).not.toBeNull();
      expect(await repos.notificationSends.claim({ userId: b.id, ...key })).not.toBeNull();

      await repos.notificationSends.finalize(claim!.id, { status: "sent" });
      const mine = await repos.notificationSends.listForUser(a.id);
      expect(mine).toHaveLength(3);
      const sent = mine.find((s) => s.id === claim!.id)!;
      expect(sent.status).toBe("sent");
      expect(sent.sentAt).not.toBeNull();
      expect(mine.filter((s) => s.status === "pending")).toHaveLength(2);
      expect(await repos.notificationSends.listForUser(b.id)).toHaveLength(1);

      await repos.notificationSends.finalize(claim!.id, { status: "failed", error: "boom" });
      const failed = (await repos.notificationSends.listForUser(a.id, 10)).find(
        (s) => s.id === claim!.id,
      )!;
      expect(failed).toMatchObject({ status: "failed", error: "boom", sentAt: null });
    });

    it("notificationSends: an abandoned pending claim is taken over after its lease", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "lease@example.com");
      const key = {
        userId: a.id,
        kind: "morning_plan" as const,
        channel: "email" as const,
        periodKey: "2026-10-12",
      };
      const t0 = new Date("2026-10-12T05:00:00Z");
      const first = await repos.notificationSends.claim(key, t0);
      expect(first).not.toBeNull();
      // Still inside the lease: refused.
      expect(
        await repos.notificationSends.claim(
          key,
          new Date(t0.getTime() + NOTIFICATION_CLAIM_LEASE_MS - 1000),
        ),
      ).toBeNull();
      // Past the lease and still pending: same row, handed to the new runner.
      const retaken = await repos.notificationSends.claim(
        key,
        new Date(t0.getTime() + NOTIFICATION_CLAIM_LEASE_MS + 1000),
      );
      expect(retaken?.id).toBe(first!.id);
      // Finalized rows are never taken over, however old.
      await repos.notificationSends.finalize(first!.id, { status: "sent" });
      expect(await repos.notificationSends.claim(key, new Date("2026-10-12T23:00:00Z"))).toBeNull();
      expect(await repos.notificationSends.listForUser(a.id)).toHaveLength(1);
    });

    it("users.delete cascades notification rows", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "cascade@example.com");
      await repos.notificationPreferences.upsert(a.id, prefs);
      await repos.pushSubscriptions.upsert(a.id, {
        endpoint: "https://push.example/cascade",
        p256dh: "p",
        auth: "a",
        userAgent: null,
      });
      await repos.notificationSends.claim({
        userId: a.id,
        kind: "morning_plan",
        channel: "email",
        periodKey: "2026-10-12",
      });
      expect(await repos.users.delete(a.id)).toBe(true);
      expect(await repos.notificationPreferences.get(a.id)).toBeNull();
      expect(await repos.pushSubscriptions.listForUser(a.id)).toEqual([]);
      expect(await repos.notificationSends.listForUser(a.id)).toEqual([]);
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

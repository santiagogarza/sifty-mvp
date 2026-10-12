import type { Repos } from "@/lib/db/repos";
import {
  DAILY_PLAN_LEASE_MS,
  IdConflictError,
  NOTIFICATION_CLAIM_LEASE_MS,
  SIFT_ACCOUNTING_STAGE,
} from "@/lib/db/repos/types";
import type { ClarifyingQuestionPayload } from "@/lib/domain/types";
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

    it("decisions.listByKind returns one kind in any status, newest first, bounded, per tenant", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "kind-a@example.com");
      const b = await createUser(repos, "kind-b@example.com");
      const proposal = (text: string) => ({
        kind: "memory_proposal" as const,
        taskId: null,
        payload: {
          kind: "memory_proposal" as const,
          text,
          memoryKind: "fact" as const,
          rationale: null,
        },
        resumeToken: null,
        expiresAt: null,
      });
      const first = await repos.decisions.create(a.id, proposal("Ana = accountant"));
      const second = await repos.decisions.create(a.id, proposal("Jure = lawyer"));
      await repos.decisions.create(a.id, {
        kind: "clarifying_question",
        taskId: null,
        payload: {
          kind: "clarifying_question",
          question: "Which year?",
          options: [],
          siftId: "sift_1",
          confidence: 0.4,
        },
        resumeToken: null,
        expiresAt: null,
      });
      await repos.decisions.create(b.id, proposal("Ana = accountant"));
      await repos.decisions.resolve(a.id, first.id, { status: "dismissed", answer: null });

      const all = await repos.decisions.listByKind(a.id, "memory_proposal", { limit: 10 });
      expect(all.map((d) => d.id).sort()).toEqual([first.id, second.id].sort());
      expect(all.map((d) => d.status).sort()).toEqual(["dismissed", "open"]);
      expect(await repos.decisions.listByKind(a.id, "memory_proposal", { limit: 1 })).toHaveLength(
        1,
      );
      expect(await repos.decisions.listByKind(b.id, "memory_proposal", { limit: 10 })).toHaveLength(
        1,
      );
      expect(await repos.decisions.listByKind(a.id, "approval", { limit: 10 })).toEqual([]);
    });

    it("decisions: tenancy, newest-first listing, counts, and the open → resolved CAS", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "dec-a@example.com");
      const b = await createUser(repos, "dec-b@example.com");
      const task = await repos.tasks.create(a.id, { sourceText: "Taxes", sourceContext: null });

      const older = await repos.decisions.create(a.id, {
        kind: "clarifying_question",
        taskId: task.id,
        payload: question("Which year?", ["2025", "2026"], "sift_1"),
        resumeToken: null,
        expiresAt: null,
      });
      await new Promise((r) => setTimeout(r, 5));
      // A deadline a week out: relative, so this case never turns into a
      // time bomb once the calendar passes a hardcoded date.
      const deadline = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const newer = await repos.decisions.create(a.id, {
        id: "dec_fixed",
        kind: "clarifying_question",
        taskId: task.id,
        payload: question("Federal or state?", [], "sift_1"),
        resumeToken: "decision:dec_fixed",
        expiresAt: deadline,
      });
      expect(newer.id).toBe("dec_fixed");
      expect(newer.status).toBe("open");
      expect(newer.resumeToken).toBe("decision:dec_fixed");
      expect(newer.expiresAt).toBe(deadline);

      // Newest first; counts match.
      expect((await repos.decisions.listOpen(a.id, { limit: 10 })).map((d) => d.id)).toEqual([
        newer.id,
        older.id,
      ]);
      expect((await repos.decisions.listOpen(a.id, { limit: 1 })).map((d) => d.id)).toEqual([
        newer.id,
      ]);
      expect(await repos.decisions.countOpen(a.id)).toBe(2);
      expect(
        (await repos.decisions.listOpenForTask(a.id, task.id, { limit: 10 })).map((d) => d.id),
      ).toEqual([newer.id, older.id]);
      // The per-task read is bounded too: a tight limit drops the older row.
      expect(
        (await repos.decisions.listOpenForTask(a.id, task.id, { limit: 1 })).map((d) => d.id),
      ).toEqual([newer.id]);

      // B sees nothing and cannot resolve A's decision.
      expect(await repos.decisions.listOpen(b.id, { limit: 10 })).toEqual([]);
      expect(await repos.decisions.countOpen(b.id)).toBe(0);
      expect(await repos.decisions.get(b.id, newer.id)).toBeNull();
      expect(
        await repos.decisions.resolve(b.id, newer.id, { status: "dismissed", answer: null }),
      ).toBeNull();
      expect((await repos.decisions.get(a.id, newer.id))?.status).toBe("open");

      // A fixed id already taken by another tenant is a conflict, not a hijack.
      await expect(
        repos.decisions.create(b.id, {
          id: "dec_fixed",
          kind: "clarifying_question",
          taskId: null,
          payload: question("steal?", [], "sift_x"),
          resumeToken: null,
          expiresAt: null,
        }),
      ).rejects.toThrow(IdConflictError);
      // …and a replay by the owner returns the existing row untouched.
      const replayed = await repos.decisions.create(a.id, {
        id: "dec_fixed",
        kind: "clarifying_question",
        taskId: task.id,
        payload: question("changed", [], "sift_1"),
        resumeToken: null,
        expiresAt: null,
      });
      expect(replayed.payload).toEqual(newer.payload);

      // Exactly one of two concurrent resolutions wins.
      const answer = { text: "2026", option: null, via: "app" as const };
      const [x, y] = await Promise.all([
        repos.decisions.resolve(a.id, newer.id, { status: "answered", answer }),
        repos.decisions.resolve(a.id, newer.id, { status: "dismissed", answer: null }),
      ]);
      expect([x, y].filter(Boolean)).toHaveLength(1);
      const resolved = (await repos.decisions.get(a.id, newer.id))!;
      expect(["answered", "dismissed"]).toContain(resolved.status);
      expect(resolved.resolvedAt).not.toBeNull();
      if (resolved.status === "answered") expect(resolved.answer).toEqual(answer);
      expect(await repos.decisions.countOpen(a.id)).toBe(1);
      expect((await repos.decisions.listOpen(a.id, { limit: 10 })).map((d) => d.id)).toEqual([
        older.id,
      ]);

      // Deleting the task takes its decisions with it.
      expect(await repos.tasks.delete(a.id, task.id)).toBe(true);
      expect(await repos.decisions.get(a.id, older.id)).toBeNull();
      expect(await repos.decisions.countOpen(a.id)).toBe(0);
    });

    it("decisions: a row past its deadline is neither listed nor counted, even while still `open`", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "dec-ttl@example.com");
      const task = await repos.tasks.create(u.id, { sourceText: "Stale", sourceContext: null });
      const stale = await repos.decisions.create(u.id, {
        kind: "clarifying_question",
        taskId: task.id,
        payload: question("Still here?", [], "sift_old"),
        resumeToken: null,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const live = await repos.decisions.create(u.id, {
        kind: "clarifying_question",
        taskId: task.id,
        payload: question("Fresh?", [], "sift_new"),
        resumeToken: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect((await repos.decisions.listOpen(u.id, { limit: 10 })).map((d) => d.id)).toEqual([
        live.id,
      ]);
      expect(await repos.decisions.countOpen(u.id)).toBe(1);
      // The per-task read still sees it, so a re-sift or a delete can close it.
      expect(
        (await repos.decisions.listOpenForTask(u.id, task.id, { limit: 10 }))
          .map((d) => d.id)
          .sort(),
      ).toEqual([live.id, stale.id].sort());
      // The row itself is untouched: the asking run (if alive) still closes it.
      expect((await repos.decisions.get(u.id, stale.id))?.status).toBe("open");
    });

    it("tasks: siftedWithAssumptions round-trips and defaults to false", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "assume@example.com");
      const t = await repos.tasks.create(u.id, { sourceText: "Assume", sourceContext: null });
      expect(t.siftedWithAssumptions).toBe(false);
      const flagged = await repos.tasks.update(u.id, t.id, { siftedWithAssumptions: true });
      expect(flagged?.siftedWithAssumptions).toBe(true);
      expect((await repos.tasks.get(u.id, t.id))?.siftedWithAssumptions).toBe(true);
      const cleared = await repos.tasks.update(u.id, t.id, { siftedWithAssumptions: false });
      expect(cleared?.siftedWithAssumptions).toBe(false);
    });

    it("stripeEvents: first sight wins, delete re-arms", async () => {
      const repos = getRepos();
      expect(await repos.stripeEvents.recordIfNew("evt_1", "invoice.paid")).toBe(true);
      expect(await repos.stripeEvents.recordIfNew("evt_1", "invoice.paid")).toBe(false);
      await repos.stripeEvents.delete("evt_1");
      expect(await repos.stripeEvents.recordIfNew("evt_1", "invoice.paid")).toBe(true);
    });

    it("tasks.list filters by due date and orders soonest first when asked", async () => {
      const repos = getRepos();
      const u = await createUser(repos, "due-list@example.com");
      const late = await repos.tasks.create(u.id, { sourceText: "Late", sourceContext: null });
      const soon = await repos.tasks.create(u.id, { sourceText: "Soon", sourceContext: null });
      const undated = await repos.tasks.create(u.id, { sourceText: "None", sourceContext: null });
      const done = await repos.tasks.create(u.id, { sourceText: "Done", sourceContext: null });
      await repos.tasks.update(u.id, late.id, { due: "2026-10-20" });
      await repos.tasks.update(u.id, soon.id, { due: "2026-10-14" });
      await repos.tasks.update(u.id, done.id, { due: "2026-10-13", lifecycle: "done" });

      const byDue = await repos.tasks.list(u.id, {
        lifecycles: ["inbox", "active", "waiting"],
        dueOnOrBefore: "2026-10-20",
        orderBy: "due",
        limit: 10,
      });
      expect(byDue.map((t) => t.id)).toEqual([soon.id, late.id]);
      const horizon = await repos.tasks.list(u.id, { dueOnOrBefore: "2026-10-15", orderBy: "due" });
      expect(horizon.map((t) => t.id)).toEqual([done.id, soon.id]);
      // `orderBy: "due"` alone drops undated rows; the default keeps them.
      expect((await repos.tasks.list(u.id, { orderBy: "due" })).map((t) => t.id)).not.toContain(
        undated.id,
      );
      expect((await repos.tasks.list(u.id)).map((t) => t.id)).toContain(undated.id);
    });

    it("users.list pages every account in id order", async () => {
      const repos = getRepos();
      const made = await Promise.all(
        ["p1@example.com", "p2@example.com", "p3@example.com"].map((e) => createUser(repos, e)),
      );
      const ids = made.map((u) => u.id).sort();
      const first = await repos.users.list(2);
      expect(first.map((u) => u.id)).toEqual(ids.slice(0, 2));
      const rest = await repos.users.list(2, first[1]!.id);
      expect(rest.map((u) => u.id)).toEqual(ids.slice(2));
      expect(await repos.users.list(2, ids[2])).toEqual([]);
    });

    it("taskEvents: append is idempotent on id, tenant-scoped, and listable per task", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "events-a@example.com");
      const b = await createUser(repos, "events-b@example.com");
      const task = await repos.tasks.create(a.id, { sourceText: "T", sourceContext: null });
      const other = await repos.tasks.create(a.id, { sourceText: "O", sourceContext: null });

      const first = await repos.taskEvents.append(a.id, {
        id: "evt_fixed",
        taskId: task.id,
        kind: "plan.moved_in",
        payload: { reason: "due tomorrow" },
      });
      const replay = await repos.taskEvents.append(a.id, {
        id: "evt_fixed",
        taskId: task.id,
        kind: "plan.moved_out",
        payload: { reason: "changed my mind" },
      });
      expect(replay).toEqual(first);
      expect(replay.kind).toBe("plan.moved_in");
      await expect(
        repos.taskEvents.append(b.id, {
          id: "evt_fixed",
          taskId: task.id,
          kind: "plan.moved_in",
          payload: {},
        }),
      ).rejects.toBeInstanceOf(IdConflictError);

      await repos.taskEvents.append(a.id, {
        taskId: other.id,
        kind: "plan.rescored",
        payload: {},
      });
      expect(await repos.taskEvents.list(a.id)).toHaveLength(2);
      const forTask = await repos.taskEvents.listForTask(a.id, task.id, 10);
      expect(forTask.map((e) => e.id)).toEqual(["evt_fixed"]);
      expect(forTask[0]!.payload).toEqual({ reason: "due tomorrow" });
      expect(await repos.taskEvents.listForTask(b.id, task.id, 10)).toEqual([]);
      expect(await repos.taskEvents.list(b.id)).toEqual([]);
    });

    it("dailyPlans: one running plan per user, one cron claim per local day, lease and tenancy", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "plans-a@example.com");
      const b = await createUser(repos, "plans-b@example.com");
      const base = { userId: a.id, planDate: "2026-10-13", timezone: "Europe/Ljubljana" };
      const run = async (userId: string) =>
        (await repos.aiRuns.insert({ ...aiRun(userId, null), stage: "prioritize" })).id;
      const t0 = new Date("2026-10-13T03:00:00.000Z");
      const later = new Date(t0.getTime() + DAILY_PLAN_LEASE_MS + 1_000);

      const cron = await repos.dailyPlans.claim(
        { ...base, trigger: "cron", aiRunId: await run(a.id) },
        t0,
      );
      expect(cron.ok).toBe(true);
      if (!cron.ok) throw new Error("unreachable");
      expect(cron.plan).toMatchObject({ ...base, trigger: "cron", status: "running", moves: [] });
      expect(cron.plan.aiRunId).toBeTruthy();

      // While it runs, every further claim for this user is refused — manual too.
      const blocked = await repos.dailyPlans.claim(
        { ...base, trigger: "manual", aiRunId: await run(a.id) },
        t0,
      );
      expect(blocked).toEqual({
        ok: false,
        reason: "running",
        plan: expect.objectContaining({ id: cron.plan.id }),
      });
      // Other users are independent.
      expect(
        (
          await repos.dailyPlans.claim(
            { ...base, userId: b.id, trigger: "cron", aiRunId: await run(b.id) },
            t0,
          )
        ).ok,
      ).toBe(true);

      // Once it finishes, the same local day still refuses a cron rerun but takes a manual plan.
      await repos.dailyPlans.update(a.id, cron.plan.id, { status: "completed" });
      expect(
        await repos.dailyPlans.claim({ ...base, trigger: "cron", aiRunId: await run(a.id) }, t0),
      ).toEqual({
        ok: false,
        reason: "planned",
      });
      const manual = await repos.dailyPlans.claim(
        { ...base, trigger: "manual", aiRunId: await run(a.id) },
        t0,
      );
      expect(manual.ok).toBe(true);
      if (!manual.ok) throw new Error("unreachable");
      expect((await repos.dailyPlans.latest(a.id))!.id).toBe(manual.plan.id);
      expect((await repos.dailyPlans.runningFor(a.id, t0))!.id).toBe(manual.plan.id);

      // Past the lease a running row is considered dead: it no longer blocks.
      expect(await repos.dailyPlans.runningFor(a.id, later)).toBeNull();
      const afterLease = await repos.dailyPlans.claim(
        { ...base, trigger: "manual", aiRunId: await run(a.id) },
        later,
      );
      expect(afterLease.ok).toBe(true);

      const finished = await repos.dailyPlans.update(a.id, cron.plan.id, {
        status: "completed",
        workflowRunId: "wrun_1",
        summary: "Lead with the deck.",
        moves: [{ taskId: "task_1", title: "Deck", kind: "moved_in", reason: "due tomorrow" }],
        considered: 12,
        finishedAt: "2026-10-13T04:05:00.000Z",
      });
      expect(finished).toMatchObject({
        status: "completed",
        workflowRunId: "wrun_1",
        summary: "Lead with the deck.",
        considered: 12,
        finishedAt: "2026-10-13T04:05:00.000Z",
      });
      expect(finished!.moves).toEqual([
        { taskId: "task_1", title: "Deck", kind: "moved_in", reason: "due tomorrow" },
      ]);
      expect((await repos.dailyPlans.get(a.id, cron.plan.id))!.moves).toHaveLength(1);

      // Tenancy: B can neither read nor update A's plans.
      expect(await repos.dailyPlans.get(b.id, cron.plan.id)).toBeNull();
      expect(await repos.dailyPlans.update(b.id, cron.plan.id, { status: "failed" })).toBeNull();
      expect((await repos.dailyPlans.get(a.id, cron.plan.id))!.status).toBe("completed");

      // Deleting the user takes the plans with it.
      await repos.users.delete(a.id);
      expect(await repos.dailyPlans.latest(a.id)).toBeNull();
    });

    it("aiRuns.complete fills a reserved row in place and is tenant-scoped", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "complete-a@example.com");
      const b = await createUser(repos, "complete-b@example.com");
      const { id } = await repos.aiRuns.insert({
        ...aiRun(a.id, null),
        stage: "prioritize",
        model: "sifty.workflow",
        transport: "workflow",
        inputTokens: null,
        outputTokens: null,
        costCents: 0,
      });
      await repos.aiRuns.complete(b.id, id, {
        model: "hijack",
        transport: "gateway",
        status: "failed",
        durationMs: 1,
        inputTokens: 1,
        outputTokens: 1,
        costCents: 1,
      });
      expect((await repos.aiRuns.list(a.id))[0]!.model).toBe("sifty.workflow");
      await repos.aiRuns.complete(a.id, id, {
        model: "anthropic/claude-haiku-4.5",
        transport: "gateway",
        status: "succeeded",
        durationMs: 1200,
        inputTokens: 900,
        outputTokens: 120,
        costCents: 0.15,
        workflowRunId: "wrun_c",
        error: null,
      });
      const [row] = await repos.aiRuns.list(a.id);
      expect(row).toMatchObject({
        id,
        model: "anthropic/claude-haiku-4.5",
        transport: "gateway",
        status: "succeeded",
        durationMs: 1200,
        inputTokens: 900,
        outputTokens: 120,
        workflowRunId: "wrun_c",
      });
      expect(row!.costCents).toBeCloseTo(0.15);
      expect(await repos.aiRuns.list(a.id)).toHaveLength(1);
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

  describe("executions", () => {
    const create = (taskId: string, key: string, policy: "auto" | "ask_first" = "auto") => ({
      taskId,
      executor: "research" as const,
      policy,
      connector: null,
      idempotencyKey: key,
    });

    it("create is idempotent per (user, key); rows, steps, and policies are per tenant and cascade", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "exec-a@example.com");
      const b = await createUser(repos, "exec-b@example.com");
      const task = await repos.tasks.create(a.id, { sourceText: "Lease", sourceContext: null });
      const bTask = await repos.tasks.create(b.id, { sourceText: "Theirs", sourceContext: null });

      const first = await repos.executions.create(a.id, create(task.id, "k1", "ask_first"));
      expect(first.created).toBe(true);
      expect(first.execution).toMatchObject({
        status: "queued",
        executor: "research",
        policy: "ask_first",
        idempotencyKey: "k1",
        reservedCents: 0,
        costCents: 0,
        answers: [],
        result: null,
        cancelRequested: false,
        startedAt: null,
        finishedAt: null,
      });
      const replay = await repos.executions.create(a.id, create(task.id, "k1"));
      expect(replay.created).toBe(false);
      expect(replay.execution.id).toBe(first.execution.id);
      expect(replay.execution.policy).toBe("ask_first");
      // Same key, other tenant: their own row.
      const theirs = await repos.executions.create(b.id, create(bTask.id, "k1"));
      expect(theirs.created).toBe(true);
      expect(theirs.execution.id).not.toBe(first.execution.id);
      // A caller-fixed id that belongs to someone else is refused.
      await expect(
        repos.executions.create(b.id, { ...create(bTask.id, "k9"), id: first.execution.id }),
      ).rejects.toBeInstanceOf(IdConflictError);

      expect(await repos.executions.get(b.id, first.execution.id)).toBeNull();
      expect(await repos.executions.listForTask(b.id, task.id, { limit: 10 })).toEqual([]);
      expect(
        await repos.executions.transition(b.id, first.execution.id, {
          from: ["queued"],
          to: "running",
        }),
      ).toBeNull();
      expect(await repos.executions.update(b.id, first.execution.id, { error: "x" })).toBeNull();
      expect(await repos.executions.settle(b.id, first.execution.id, { costCents: 1 })).toBeNull();
      expect(
        await repos.executions.reserve(b.id, first.execution.id, { cents: 1, capCents: 10 }),
      ).toEqual({ ok: false, reason: "not_found" });

      const step = await repos.executions.appendStep(a.id, {
        id: `${first.execution.id}:0`,
        executionId: first.execution.id,
        seq: 0,
        kind: "tool_call",
        name: "lookup",
        status: "ok",
        input: { q: "lease" },
        output: { hits: 2 },
        durationMs: 12,
        costCents: 0.5,
      });
      // Idempotent on id and on (execution, seq).
      const again = await repos.executions.appendStep(a.id, {
        id: `${first.execution.id}:0`,
        executionId: first.execution.id,
        seq: 0,
        kind: "note",
        name: "other",
        status: "ok",
        input: null,
        output: null,
        durationMs: null,
        costCents: 9,
      });
      expect(again).toEqual(step);
      const bySeq = await repos.executions.appendStep(a.id, {
        executionId: first.execution.id,
        seq: 0,
        kind: "note",
        name: "other",
        status: "ok",
        input: null,
        output: null,
        durationMs: null,
        costCents: 9,
      });
      expect(bySeq.id).toBe(step.id);
      await repos.executions.appendStep(a.id, {
        executionId: first.execution.id,
        seq: 1,
        kind: "model_call",
        name: "summarize",
        status: "ok",
        input: null,
        output: null,
        durationMs: 300,
        costCents: 1.25,
      });
      expect(
        (await repos.executions.listSteps(a.id, first.execution.id, { limit: 10 })).map(
          (s) => s.seq,
        ),
      ).toEqual([0, 1]);
      expect(await repos.executions.listSteps(a.id, first.execution.id, { limit: 1 })).toHaveLength(
        1,
      );
      expect(await repos.executions.listSteps(b.id, first.execution.id, { limit: 10 })).toEqual([]);
      await expect(
        repos.executions.appendStep(b.id, {
          id: `${first.execution.id}:0`,
          executionId: first.execution.id,
          seq: 0,
          kind: "note",
          name: "steal",
          status: "ok",
          input: null,
          output: null,
          durationMs: null,
          costCents: 0,
        }),
      ).rejects.toBeInstanceOf(IdConflictError);

      await repos.executionPolicies.set(a.id, "task", task.id, "ask_first");
      await repos.executionPolicies.set(a.id, "connector", "gmail", "auto");
      await repos.executionPolicies.set(a.id, "connector", "gmail", "ask_first");
      expect((await repos.executionPolicies.get(a.id, "connector", "gmail"))?.policy).toBe(
        "ask_first",
      );
      expect(await repos.executionPolicies.get(b.id, "connector", "gmail")).toBeNull();
      expect(await repos.executionPolicies.list(a.id, "connector", { limit: 10 })).toHaveLength(1);
      expect(await repos.executionPolicies.clear(b.id, "task", task.id)).toBe(false);
      expect(await repos.executionPolicies.clear(a.id, "task", task.id)).toBe(true);
      expect(await repos.executionPolicies.get(a.id, "task", task.id)).toBeNull();

      // Deleting the task takes its executions and their steps.
      expect(await repos.tasks.delete(a.id, task.id)).toBe(true);
      expect(await repos.executions.get(a.id, first.execution.id)).toBeNull();
      expect(await repos.executions.listSteps(a.id, first.execution.id, { limit: 10 })).toEqual([]);
      // Deleting the user takes the rest.
      expect(await repos.users.delete(b.id)).toBe(true);
      expect(await repos.executions.get(b.id, theirs.execution.id)).toBeNull();
    });

    it("transition is a compare-and-set over the from list and patches bookkeeping", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "exec-cas@example.com");
      const task = await repos.tasks.create(a.id, { sourceText: "Lease", sourceContext: null });
      const { execution } = await repos.executions.create(a.id, create(task.id, "cas"));

      expect(
        await repos.executions.transition(a.id, execution.id, { from: ["running"], to: "done" }),
      ).toBeNull();
      const running = await repos.executions.transition(a.id, execution.id, {
        from: ["queued", "needs_approval"],
        to: "running",
        patch: { startedAt: "2026-10-12T10:00:00.000Z", workflowRunId: "wrun_1" },
      });
      expect(running).toMatchObject({
        status: "running",
        startedAt: "2026-10-12T10:00:00.000Z",
        workflowRunId: "wrun_1",
      });
      // Two concurrent terminal writes: exactly one wins.
      const [done, cancelled] = await Promise.all([
        repos.executions.transition(a.id, execution.id, {
          from: ["running"],
          to: "done",
          patch: { result: { summary: "ok", draft: null }, finishedAt: "2026-10-12T10:01:00.000Z" },
        }),
        repos.executions.transition(a.id, execution.id, {
          from: ["running"],
          to: "cancelled",
          patch: { cancelReason: "user" },
        }),
      ]);
      expect([done, cancelled].filter(Boolean)).toHaveLength(1);
      const final = (await repos.executions.get(a.id, execution.id))!;
      expect(["done", "cancelled"]).toContain(final.status);
      expect(final.updatedAt >= running!.updatedAt).toBe(true);

      const patched = await repos.executions.update(a.id, execution.id, {
        answers: ["Warehouse"],
        decisionId: "dec_1",
        cancelRequested: true,
      });
      expect(patched).toMatchObject({
        answers: ["Warehouse"],
        decisionId: "dec_1",
        cancelRequested: true,
      });
      expect(
        (await repos.executions.update(a.id, execution.id, { decisionId: null }))!.decisionId,
      ).toBeNull();
    });

    it("reserve enforces the monthly cap atomically, settle releases it, and usage is per calendar month", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "exec-budget@example.com");
      const b = await createUser(repos, "exec-budget-b@example.com");
      const task = await repos.tasks.create(a.id, { sourceText: "Lease", sourceContext: null });
      const bTask = await repos.tasks.create(b.id, { sourceText: "Theirs", sourceContext: null });
      const now = new Date();

      const one = await repos.executions.create(a.id, create(task.id, "b1"));
      const two = await repos.executions.create(a.id, create(task.id, "b2"));
      const three = await repos.executions.create(a.id, create(task.id, "b3"));
      const theirs = await repos.executions.create(b.id, create(bTask.id, "b1"));

      const r1 = await repos.executions.reserve(a.id, one.execution.id, {
        cents: 6,
        capCents: 10,
        now,
      });
      expect(r1).toMatchObject({ ok: true, usage: { committedCents: 0, reservedCents: 6 } });
      // Re-reserving the same row replaces, never adds.
      const r1b = await repos.executions.reserve(a.id, one.execution.id, {
        cents: 5,
        capCents: 10,
        now,
      });
      expect(r1b).toMatchObject({ ok: true, usage: { committedCents: 0, reservedCents: 5 } });
      // Exactly at the cap passes; one over is refused and writes nothing.
      const r2 = await repos.executions.reserve(a.id, two.execution.id, {
        cents: 5,
        capCents: 10,
        now,
      });
      expect(r2).toMatchObject({ ok: true, usage: { committedCents: 0, reservedCents: 10 } });
      const r3 = await repos.executions.reserve(a.id, three.execution.id, {
        cents: 1,
        capCents: 10,
        now,
      });
      expect(r3).toEqual({
        ok: false,
        reason: "budget",
        usage: { committedCents: 0, reservedCents: 10 },
      });
      expect((await repos.executions.get(a.id, three.execution.id))!.reservedCents).toBe(0);
      // Another tenant's budget is their own; Infinity never refuses.
      expect(
        (
          await repos.executions.reserve(b.id, theirs.execution.id, {
            cents: 1000,
            capCents: 1200,
            now,
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await repos.executions.reserve(a.id, three.execution.id, {
            cents: 1,
            capCents: Number.POSITIVE_INFINITY,
            now,
          })
        ).ok,
      ).toBe(true);
      await repos.executions.reserve(a.id, three.execution.id, { cents: 0, capCents: 10, now });

      // Settling turns the hold into committed spend (possibly less than reserved).
      await repos.executions.transition(a.id, one.execution.id, { from: ["queued"], to: "done" });
      const settled = await repos.executions.settle(a.id, one.execution.id, { costCents: 2.5 });
      expect(settled).toMatchObject({ reservedCents: 0, costCents: 2.5 });
      expect(await repos.executions.monthlyUsage(a.id, now)).toEqual({
        committedCents: 2.5,
        reservedCents: 5,
      });
      // …and frees room: 2.5 + 5 + 2 = 9.5 fits, 2.5 + 5 + 3 does not.
      expect(
        (await repos.executions.reserve(a.id, three.execution.id, { cents: 2, capCents: 10, now }))
          .ok,
      ).toBe(true);
      expect(
        (await repos.executions.reserve(a.id, three.execution.id, { cents: 3, capCents: 10, now }))
          .ok,
      ).toBe(false);

      // Spend from an earlier month is invisible this month.
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15));
      expect(await repos.executions.monthlyUsage(a.id, nextMonth)).toEqual({
        committedCents: 0,
        reservedCents: 0,
      });
      expect(await repos.executions.monthlyUsage(b.id, now)).toEqual({
        committedCents: 0,
        reservedCents: 1000,
      });

      // Concurrent reservations never overshoot the cap together.
      const c = await createUser(repos, "exec-race@example.com");
      const cTask = await repos.tasks.create(c.id, { sourceText: "Race", sourceContext: null });
      const rows = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          repos.executions.create(c.id, create(cTask.id, `race-${i}`)),
        ),
      );
      const results = await Promise.all(
        rows.map((r) =>
          repos.executions.reserve(c.id, r.execution.id, { cents: 4, capCents: 10, now }),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(2);
      expect(await repos.executions.monthlyUsage(c.id, now)).toEqual({
        committedCents: 0,
        reservedCents: 8,
      });
    });

    it("listActive and countByStatus back the inbox and the away digest", async () => {
      const repos = getRepos();
      const a = await createUser(repos, "exec-list@example.com");
      const task = await repos.tasks.create(a.id, { sourceText: "Lease", sourceContext: null });
      const other = await repos.tasks.create(a.id, { sourceText: "Other", sourceContext: null });
      const before = new Date(Date.now() - 60_000);
      const queued = await repos.executions.create(a.id, create(task.id, "l1"));
      const parked = await repos.executions.create(a.id, create(other.id, "l2"));
      const finished = await repos.executions.create(a.id, create(task.id, "l3"));
      await repos.executions.transition(a.id, parked.execution.id, {
        from: ["queued"],
        to: "running",
      });
      await repos.executions.transition(a.id, parked.execution.id, {
        from: ["running"],
        to: "drafted",
      });
      await repos.executions.transition(a.id, finished.execution.id, {
        from: ["queued"],
        to: "running",
      });
      await repos.executions.transition(a.id, finished.execution.id, {
        from: ["running"],
        to: "done",
      });

      const active = await repos.executions.listActive(a.id, { limit: 10 });
      expect(active.map((e) => e.id).sort()).toEqual(
        [queued.execution.id, parked.execution.id].sort(),
      );
      expect(await repos.executions.listActive(a.id, { limit: 1 })).toHaveLength(1);
      expect(
        (await repos.executions.listForTask(a.id, task.id, { limit: 10 })).map((e) => e.id).sort(),
      ).toEqual([queued.execution.id, finished.execution.id].sort());
      expect(await repos.executions.listForTask(a.id, task.id, { limit: 1 })).toHaveLength(1);

      const counts = await repos.executions.countByStatus(a.id, { since: before });
      expect(counts).toMatchObject({ queued: 1, drafted: 1, done: 1, running: 0, cancelled: 0 });
      const none = await repos.executions.countByStatus(a.id, {
        since: new Date(Date.now() + 60_000),
      });
      expect(Object.values(none).every((n) => n === 0)).toBe(true);
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

function question(text: string, options: string[], siftId: string): ClarifyingQuestionPayload {
  return { kind: "clarifying_question", question: text, options, siftId, confidence: 0.4 };
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

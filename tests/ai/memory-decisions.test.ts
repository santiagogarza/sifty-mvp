import { type MemoryExtractInput, extractMemories } from "@/lib/ai/memory/execute";
import { decisionsSink, memoryFromProposal } from "@/lib/ai/memory/propose";
import type { Repos } from "@/lib/db/repos";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * Memory proposals through the Decisions inbox: filing, deduping against
 * open / confirmed / dismissed rows, confirming into `memories`, and the
 * dismissal negative that keeps the same idea from coming back.
 */

const client = {
  start: vi.fn<WorkflowClient["start"]>(),
  wait: vi.fn<WorkflowClient["wait"]>(),
  resume: vi.fn<WorkflowClient["resume"]>(),
};

beforeEach(() => {
  __resetRateLimits();
  client.start.mockReset().mockResolvedValue({ runId: "wrun_mem" });
  client.resume.mockReset().mockResolvedValue({ ok: false, reason: "not_found" } as never);
  setWorkflowClientForTesting(client);
});
afterEach(() => setWorkflowClientForTesting(null));

async function seedSifted(repos: Repos, userId: string, sourceText: string, siftId = "sift_1") {
  const created = await repos.tasks.create(userId, { sourceText, sourceContext: null });
  return (await repos.tasks.update(userId, created.id, { aiStatus: "ready", siftId }))!;
}

const input = (userId: string, taskId: string): MemoryExtractInput => ({
  userId,
  taskId,
  siftId: "sift_1",
  trigger: "sift",
  contradictions: [],
  modelPreference: null,
  offline: true,
});

async function answer(cookie: string, id: string, option: string) {
  const { POST } = await import("@/app/api/decisions/[id]/answer/route");
  return POST(
    new Request(`http://localhost/api/decisions/${id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ option }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function dismiss(cookie: string, id: string) {
  const { POST } = await import("@/app/api/decisions/[id]/dismiss/route");
  return POST(
    new Request(`http://localhost/api/decisions/${id}/dismiss`, {
      method: "POST",
      headers: { cookie },
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("memory proposals in the Decisions inbox", () => {
  it("a sift files a proposal as an open memory_proposal decision, detached from the task", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "p@example.com",
      displayName: "P",
      isCreator: false,
    });
    const task = await seedSifted(repos, user.id, "Send the Q3 numbers to Ana, my accountant");

    expect(await extractMemories(input(user.id, task.id), null)).toEqual({
      outcome: "proposed",
      proposals: 1,
      filed: 1,
    });
    const open = await repos.decisions.listOpen(user.id, { limit: 10 });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      kind: "memory_proposal",
      taskId: null,
      resumeToken: null,
      expiresAt: null,
      payload: {
        kind: "memory_proposal",
        text: "Ana = accountant",
        memoryKind: "fact",
        rationale: "Ana, my accountant",
      },
    });
    expect(await repos.decisions.countOpen(user.id)).toBe(1);

    // Deleting the source task leaves the proposal (and later its negative) in place.
    await repos.tasks.delete(user.id, task.id);
    expect(await repos.decisions.countOpen(user.id)).toBe(1);

    // The same capture sifted again proposes nothing new while the row is open.
    const task2 = await seedSifted(repos, user.id, "Send the Q3 numbers to Ana, my accountant");
    expect(await extractMemories(input(user.id, task2.id), null)).toEqual({
      outcome: "proposed",
      proposals: 1,
      filed: 0,
    });
    expect(await repos.decisions.countOpen(user.id)).toBe(1);
  });

  it("a Remember that loses to a dismiss takes its memory back; one that loses to another Remember keeps it", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "race@example.com" });
    const task = await seedSifted(repos, user.id, "Call Ana, my accountant");
    await extractMemories(input(user.id, task.id), null);
    const [proposal] = await repos.decisions.listOpen(user.id, { limit: 10 });

    // The dismiss lands between Remember's memory write and its resolve.
    const resolve = repos.decisions.resolve.bind(repos.decisions);
    const spy = vi.spyOn(repos.decisions, "resolve").mockImplementationOnce(async (u, id, inp) => {
      await resolve(u, id, { status: "dismissed", answer: null });
      return resolve(u, id, inp);
    });
    const lost = await answer(cookie, proposal!.id, "Remember");
    spy.mockRestore();
    expect(lost.status).toBe(409);
    expect((await repos.decisions.get(user.id, proposal!.id))!.status).toBe("dismissed");
    expect(await repos.memories.list(user.id)).toEqual([]);
  });

  it("the sink files a proposal only once while it is open", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "once@example.com",
      displayName: "O",
      isCreator: false,
    });
    const task = await seedSifted(repos, user.id, "Send the Q3 numbers to Ana, my accountant");
    await extractMemories(input(user.id, task.id), null);
    // The same capture sifted again proposes nothing new while the row is open.
    expect(await extractMemories(input(user.id, task.id), null)).toEqual({
      outcome: "proposed",
      proposals: 1,
      filed: 0,
    });
    expect(await repos.decisions.countOpen(user.id)).toBe(1);
  });

  it("confirming writes a pinned memory; the proposal is then never raised again", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "confirm@example.com" });
    const task = await seedSifted(repos, user.id, "Send the Q3 numbers to Ana, my accountant");
    await extractMemories(input(user.id, task.id), null);
    const [proposal] = await repos.decisions.listOpen(user.id, { limit: 10 });

    const res = await answer(cookie, proposal!.id, "Remember");
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe("remembered");
    const memories = await repos.memories.list(user.id);
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({ text: "Ana = accountant", kind: "fact", pinned: true });
    expect(await repos.decisions.countOpen(user.id)).toBe(0);

    // Known both as a memory and as an answered proposal: nothing re-raised.
    const again = await seedSifted(repos, user.id, "Ask Ana, my accountant, about VAT", "sift_2");
    expect(await extractMemories({ ...input(user.id, again.id), siftId: "sift_2" }, null)).toEqual({
      outcome: "skipped",
      reason: "nothing",
    });
    expect(await repos.decisions.countOpen(user.id)).toBe(0);
  });

  it("dismissing records a negative: the same proposal is not re-raised and no memory is written", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "dismiss@example.com" });
    const task = await seedSifted(repos, user.id, "Call Ana, my accountant");
    await extractMemories(input(user.id, task.id), null);
    const [proposal] = await repos.decisions.listOpen(user.id, { limit: 10 });

    expect((await dismiss(cookie, proposal!.id)).status).toBe(200);
    expect((await repos.decisions.get(user.id, proposal!.id))!.status).toBe("dismissed");
    expect(await repos.memories.list(user.id)).toEqual([]);

    const again = await seedSifted(
      repos,
      user.id,
      "Email Ana, my accountant, the receipts",
      "sift_2",
    );
    expect(await extractMemories({ ...input(user.id, again.id), siftId: "sift_2" }, null)).toEqual({
      outcome: "proposed",
      proposals: 1,
      filed: 0,
    });
    expect(await repos.decisions.countOpen(user.id)).toBe(0);
    // A different fact still gets through.
    const other = await seedSifted(
      repos,
      user.id,
      "Ask Jure, my lawyer, about the lease",
      "sift_3",
    );
    expect(await extractMemories({ ...input(user.id, other.id), siftId: "sift_3" }, null)).toEqual({
      outcome: "proposed",
      proposals: 1,
      filed: 1,
    });
  });

  it("an expired proposal does not block the idea, and a re-sift's expiry spares proposals", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "exp@example.com",
      displayName: "E",
      isCreator: false,
    });
    const task = await seedSifted(repos, user.id, "Call Ana, my accountant");
    await extractMemories(input(user.id, task.id), null);
    const [proposal] = await repos.decisions.listOpen(user.id, { limit: 10 });

    // A re-sift expires the task's open questions but leaves the proposal alone.
    const { expireOpenDecisionsForTask } = await import("@/lib/decisions/service");
    expect(await expireOpenDecisionsForTask(repos, user.id, task.id)).toBe(0);
    expect((await repos.decisions.get(user.id, proposal!.id))!.status).toBe("open");

    // Had it expired some other way, the next extraction raises it again.
    await repos.decisions.resolve(user.id, proposal!.id, { status: "expired", answer: null });
    const again = await seedSifted(
      repos,
      user.id,
      "Email Ana, my accountant, the receipts",
      "sift_2",
    );
    expect(await extractMemories({ ...input(user.id, again.id), siftId: "sift_2" }, null)).toEqual({
      outcome: "proposed",
      proposals: 1,
      filed: 1,
    });
    expect(await repos.decisions.countOpen(user.id)).toBe(1);
  });

  it("Remember writes the memory before resolving, under a decision-derived id, so a retry or a second tab cannot duplicate it", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "twice@example.com" });
    const task = await seedSifted(repos, user.id, "Call Ana, my accountant");
    await extractMemories(input(user.id, task.id), null);
    const [proposal] = await repos.decisions.listOpen(user.id, { limit: 10 });

    // The memory write fails once: the proposal stays open, nothing is stored.
    const create = vi.spyOn(repos.memories, "create").mockRejectedValueOnce(new Error("db down"));
    await expect(answer(cookie, proposal!.id, "Remember")).rejects.toThrow("db down");
    create.mockRestore();
    expect((await repos.decisions.get(user.id, proposal!.id))!.status).toBe("open");
    expect(await repos.memories.list(user.id)).toEqual([]);

    // Two confirmations (two tabs): one memory, second answer is 409.
    const [first, second] = await Promise.all([
      answer(cookie, proposal!.id, "Remember"),
      answer(cookie, proposal!.id, "Remember"),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const memories = await repos.memories.list(user.id);
    expect(memories).toHaveLength(1);
    expect(memories[0]!.id).toBe(`mem_${proposal!.id}`);
  });

  it("the sink dedupes within a batch and across tenants independently", async () => {
    const repos = getTestRepos();
    const a = await repos.users.create({
      email: "a@example.com",
      displayName: "A",
      isCreator: false,
    });
    const b = await repos.users.create({
      email: "b@example.com",
      displayName: "B",
      isCreator: false,
    });
    const proposals = [
      { text: "Ana = accountant", kind: "fact" as const, evidence: "e", confidence: 0.9 },
      { text: "ANA = Accountant", kind: "fact" as const, evidence: "e", confidence: 0.9 },
    ];
    const source = { taskId: "task_x", siftId: "sift_x", trigger: "sift" as const };
    expect(await decisionsSink(repos, a.id, proposals, source)).toEqual({ filed: 1 });
    expect(await decisionsSink(repos, b.id, proposals, source)).toEqual({ filed: 1 });
    expect(await repos.decisions.countOpen(a.id)).toBe(1);
    expect(await repos.decisions.countOpen(b.id)).toBe(1);
  });

  it("memoryFromProposal ignores other decision kinds", () => {
    expect(
      memoryFromProposal({
        id: "dec_q",
        kind: "clarifying_question",
        status: "open",
        taskId: "task_1",
        payload: {
          kind: "clarifying_question",
          question: "Which year?",
          options: [],
          siftId: "sift_1",
          confidence: 0.4,
        },
        answer: null,
        resumeToken: null,
        createdAt: "2026-10-12T00:00:00.000Z",
        updatedAt: "2026-10-12T00:00:00.000Z",
        resolvedAt: null,
        expiresAt: null,
      }),
    ).toBeNull();
  });
});

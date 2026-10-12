import { nextInstanceId } from "@/lib/recurrence/spawn";
import { describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * `PATCH /api/tasks/:id` with `lifecycle: "done"` on a recurring task
 * spawns the next instance and returns it as `spawned`. Replays and
 * non-recurring tasks spawn nothing.
 */

async function patch(id: string, cookie: string, body: unknown) {
  const { PATCH } = await import("@/app/api/tasks/[id]/route");
  return PATCH(
    new Request(`http://localhost/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("completing a recurring task over the API", () => {
  it("returns the task and its spawned successor; a replay returns the same successor", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "repeat@example.com" });
    const created = await repos.tasks.create(user.id, {
      sourceText: "Water the plants",
      sourceContext: null,
    });
    await repos.tasks.update(user.id, created.id, {
      title: "Water the plants",
      lifecycle: "active",
      aiStatus: "ready",
      due: "2026-10-12",
      recurrence: { freq: "daily", mode: "fixed" },
      seriesId: created.id,
    });

    const res = await patch(created.id, cookie, {
      lifecycle: "done",
      timeZone: "Europe/Madrid",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      task: { lifecycle: string; completedAt: string | null };
      spawned: {
        id: string;
        title: string;
        due: string;
        lifecycle: string;
        aiStatus: string;
        seriesId: string;
        editedFields: string[];
      } | null;
    };
    expect(body.task.lifecycle).toBe("done");
    expect(body.task.completedAt).toBeTruthy();
    expect(body.spawned).toMatchObject({
      id: nextInstanceId(created.id, body.task.completedAt),
      title: "Water the plants",
      lifecycle: "active",
      aiStatus: "ready",
      seriesId: created.id,
    });
    expect(body.spawned!.editedFields).toContain("due");
    // Fixed daily from a due of the 12th: the 13th, whatever today is.
    expect(body.spawned!.due).toBe("2026-10-13");

    // Replayed completion (lost response, second device): same successor, no third row.
    const replay = await patch(created.id, cookie, { lifecycle: "done" });
    expect(replay.status).toBe(200);
    const replayed = (await replay.json()) as { spawned: { id: string } | null };
    expect(replayed.spawned?.id).toBe(body.spawned!.id);
    const mine = (await repos.tasks.list(user.id)).filter((t) => t.seriesId === created.id);
    expect(mine).toHaveLength(2);
    expect(await repos.aiRuns.list(user.id)).toEqual([]);
  });

  it("counts 'after completion' from the day the client completed it, not from sync time", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "late@example.com" });
    const created = await repos.tasks.create(user.id, {
      sourceText: "Stretch",
      sourceContext: null,
    });
    await repos.tasks.update(user.id, created.id, {
      recurrence: { freq: "daily", mode: "after_completion" },
    });
    // The push for an offline completion arrives much later than the completion itself.
    const res = await patch(created.id, cookie, { lifecycle: "done", completedOn: "2026-01-05" });
    const { spawned } = (await res.json()) as { spawned: { due: string } };
    expect(spawned.due).toBe("2026-01-06");
    expect(
      (await patch(created.id, cookie, { lifecycle: "done", completedOn: "2026-1-5" })).status,
    ).toBe(400);
  });

  it("a recurring task that arrives already done through create spawns its successor too", async () => {
    // Offline capture, repeat set, completed before the first push — or a
    // PATCH that 404'd and fell back to POST. The create path must not
    // strand the series.
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "offline@example.com" });
    const { POST } = await import("@/app/api/tasks/route");
    const body = {
      id: "task_offline1",
      sourceText: "Water the plants",
      title: "Water the plants",
      lifecycle: "done",
      aiStatus: "idle",
      due: "2026-10-12",
      recurrence: { freq: "daily", mode: "fixed" },
      seriesId: "task_offline1",
      completedOn: "2026-10-12",
      timeZone: "Europe/Madrid",
    };
    const post = () =>
      POST(
        new Request("http://localhost/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify(body),
        }),
      );
    const res = await post();
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      task: { lifecycle: string };
      spawned: { id: string; due: string; lifecycle: string; seriesId: string } | null;
    };
    expect(created.task.lifecycle).toBe("done");
    // A capture lives in the Inbox until it is filed; so does its successor.
    expect(created.spawned).toMatchObject({
      due: "2026-10-13",
      lifecycle: "inbox",
      seriesId: "task_offline1",
    });
    // The replayed create returns the same successor.
    const replay = (await (await post()).json()) as { spawned: { id: string } | null };
    expect(replay.spawned?.id).toBe(created.spawned!.id);
    expect(
      (await repos.tasks.list(user.id)).filter((t) => t.seriesId === "task_offline1"),
    ).toHaveLength(2);
  });

  it("a done recurring capture that still owes a sift hands it to the successor, not the finished row", async () => {
    const { setWorkflowClientForTesting } = await import("@/lib/workflows/dispatch");
    const start = vi.fn().mockResolvedValue({ runId: "wrun_successor" });
    setWorkflowClientForTesting({ start, wait: vi.fn(), resume: vi.fn() });
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
    try {
      const repos = getTestRepos();
      const { user, cookie } = await createUserWithCookie(repos, { email: "owed@example.com" });
      const { POST } = await import("@/app/api/tasks/route");
      const res = await POST(
        new Request("http://localhost/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({
            id: "task_owed1",
            sourceText: "Stretch for ten minutes",
            lifecycle: "done",
            aiStatus: "pending",
            recurrence: { freq: "daily", mode: "after_completion" },
            seriesId: "task_owed1",
            completedOn: "2026-10-12",
          }),
        }),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        task: { aiStatus: string; siftId: string | null };
        spawned: { id: string; aiStatus: string; siftId: string | null; due: string };
        sift: { enqueued: boolean; siftId?: string };
      };
      // The finished row is left alone; the live successor is being sifted.
      expect(body.task.aiStatus).toBe("idle");
      expect(body.task.siftId).toBeNull();
      expect(body.spawned.aiStatus).toBe("pending");
      expect(body.spawned.siftId).toBeTruthy();
      expect(body.spawned.due).toBe("2026-10-13");
      expect(body.sift).toMatchObject({ enqueued: true, siftId: body.spawned.siftId });
      expect(start).toHaveBeenCalledTimes(1);
      expect(start.mock.calls[0]![1][0]).toMatchObject({ taskId: body.spawned.id });
      // Exactly one sift was billed, for the successor.
      const runs = await repos.aiRuns.list(user.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.taskId).toBe(body.spawned.id);
    } finally {
      setWorkflowClientForTesting(null);
    }
  });

  it("completing while a sift is in flight supersedes it on the parent and sifts the successor", async () => {
    const { setWorkflowClientForTesting } = await import("@/lib/workflows/dispatch");
    const start = vi.fn().mockResolvedValue({ runId: "wrun_handoff" });
    setWorkflowClientForTesting({ start, wait: vi.fn(), resume: vi.fn() });
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
    try {
      const repos = getTestRepos();
      const { user, cookie } = await createUserWithCookie(repos, { email: "inflight@example.com" });
      const created = await repos.tasks.create(user.id, {
        sourceText: "Journal",
        sourceContext: null,
      });
      // Mid-sift: the enrich step is running under sift_old.
      await repos.tasks.update(user.id, created.id, {
        lifecycle: "active",
        aiStatus: "running",
        siftId: "sift_old",
        siftStage: "enrich",
        recurrence: { freq: "daily", mode: "fixed" },
        seriesId: created.id,
      });

      const res = await patch(created.id, cookie, { lifecycle: "done", completedOn: "2026-10-12" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        task: { aiStatus: string; siftId: string | null; siftStage: string | null };
        spawned: { id: string; aiStatus: string; siftId: string | null; lifecycle: string };
      };
      // The old run is superseded: its next step will see a different siftId and stop.
      expect(body.task).toMatchObject({ aiStatus: "idle", siftId: null, siftStage: null });
      expect(body.spawned).toMatchObject({ aiStatus: "pending", lifecycle: "active" });
      expect(body.spawned.siftId).toBeTruthy();
      expect(body.spawned.siftId).not.toBe("sift_old");
      expect(start).toHaveBeenCalledTimes(1);
      expect(start.mock.calls[0]![1][0]).toMatchObject({ taskId: body.spawned.id });

      // The superseded step body stops instead of writing to the finished row.
      const { executeSiftStage } = await import("@/lib/ai/sift/execute-stage");
      expect(
        await executeSiftStage(
          {
            userId: user.id,
            taskId: created.id,
            siftId: "sift_old",
            accountingRunId: "run_x",
            modelPreference: null,
            offline: true,
          },
          "enrich",
          "wrun_old",
        ),
      ).toBe("superseded");
    } finally {
      setWorkflowClientForTesting(null);
    }
  });

  it("completing a task waiting on a question expires the question and sifts the successor afresh", async () => {
    const { setWorkflowClientForTesting } = await import("@/lib/workflows/dispatch");
    const start = vi.fn().mockResolvedValue({ runId: "wrun_fresh" });
    const resume = vi.fn().mockResolvedValue({ ok: true, runId: "wrun_q" });
    setWorkflowClientForTesting({ start, wait: vi.fn(), resume });
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
    try {
      const repos = getTestRepos();
      const { user, cookie } = await createUserWithCookie(repos, { email: "asked@example.com" });
      const created = await repos.tasks.create(user.id, {
        sourceText: "Plan the offsite",
        sourceContext: null,
      });
      // The sift asked a question and parked: the task is `ready` with the asking run's id.
      await repos.tasks.update(user.id, created.id, {
        lifecycle: "active",
        aiStatus: "ready",
        siftId: "sift_q",
        clarifyingQuestion: "Which quarter?",
        recurrence: { freq: "monthly", mode: "fixed", dayOfMonth: 1 },
        seriesId: created.id,
      });
      const { openClarifyingQuestion } = await import("@/lib/decisions/service");
      const decision = await openClarifyingQuestion(repos, user.id, {
        id: "dec_q1",
        taskId: created.id,
        siftId: "sift_q",
        question: "Which quarter?",
        options: ["Q1", "Q2"],
        confidence: 0.4,
      });
      expect(decision.status).toBe("open");

      const res = await patch(created.id, cookie, { lifecycle: "done", completedOn: "2026-10-12" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        task: { aiStatus: string; siftId: string | null; clarifyingQuestion: string | null };
        spawned: {
          id: string;
          aiStatus: string;
          siftId: string | null;
          clarifyingQuestion: string | null;
        };
      };
      // The question is closed, its run released, and nothing can land on the finished row.
      expect((await repos.decisions.get(user.id, "dec_q1"))?.status).toBe("expired");
      expect(resume).toHaveBeenCalledTimes(1);
      expect(body.task).toMatchObject({ aiStatus: "idle", siftId: null, clarifyingQuestion: null });
      // The live successor gets a fresh sift (which may ask again, on the right row).
      expect(body.spawned).toMatchObject({ aiStatus: "pending", clarifyingQuestion: null });
      expect(body.spawned.siftId).toBeTruthy();
      expect(start).toHaveBeenCalledTimes(1);
      expect(start.mock.calls[0]![1][0]).toMatchObject({ taskId: body.spawned.id });
      expect(await repos.decisions.listOpenForTask(user.id, created.id, { limit: 10 })).toEqual([]);
    } finally {
      setWorkflowClientForTesting(null);
    }
  });

  it("an open memory proposal on the parent is not a reason to re-sift the successor", async () => {
    const { setWorkflowClientForTesting } = await import("@/lib/workflows/dispatch");
    const start = vi.fn();
    setWorkflowClientForTesting({ start, wait: vi.fn(), resume: vi.fn() });
    try {
      const repos = getTestRepos();
      const { user, cookie } = await createUserWithCookie(repos, { email: "memo@example.com" });
      const created = await repos.tasks.create(user.id, {
        sourceText: "Water the plants",
        sourceContext: null,
      });
      await repos.tasks.update(user.id, created.id, {
        lifecycle: "active",
        aiStatus: "ready",
        recurrence: { freq: "daily", mode: "fixed" },
        seriesId: created.id,
      });
      const proposal = await repos.decisions.create(user.id, {
        kind: "memory_proposal",
        taskId: created.id,
        payload: {
          kind: "memory_proposal",
          text: "Waters plants daily",
          memoryKind: "fact",
          rationale: null,
        },
        resumeToken: null,
        expiresAt: null,
      });
      const body = (await (await patch(created.id, cookie, { lifecycle: "done" })).json()) as {
        task: { aiStatus: string };
        spawned: { aiStatus: string; siftId: string | null };
      };
      // The organized parent's copy is organized too; nothing is spent, and the proposal stays open.
      expect(body.task.aiStatus).toBe("ready");
      expect(body.spawned).toMatchObject({ aiStatus: "ready", siftId: null });
      expect(start).not.toHaveBeenCalled();
      expect((await repos.decisions.get(user.id, proposal.id))?.status).toBe("open");
    } finally {
      setWorkflowClientForTesting(null);
    }
  });

  it("a successor whose owed sift failed to enqueue is retried by the next completion attempt", async () => {
    const { setWorkflowClientForTesting } = await import("@/lib/workflows/dispatch");
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue down"))
      .mockResolvedValue({ runId: "wrun_2" });
    setWorkflowClientForTesting({ start, wait: vi.fn(), resume: vi.fn() });
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
    try {
      const repos = getTestRepos();
      const { user, cookie } = await createUserWithCookie(repos, { email: "retry@example.com" });
      const created = await repos.tasks.create(user.id, {
        sourceText: "Backup laptop",
        sourceContext: null,
      });
      await repos.tasks.update(user.id, created.id, {
        lifecycle: "active",
        aiStatus: "pending",
        recurrence: { freq: "weekly", mode: "fixed", weekdays: [1] },
        seriesId: created.id,
      });

      const first = (await (await patch(created.id, cookie, { lifecycle: "done" })).json()) as {
        spawned: { id: string; aiStatus: string; siftId: string | null };
      };
      // The run did not start: the successor is left failed (retryable), not idle.
      expect(first.spawned.aiStatus).toBe("failed");

      const second = (await (await patch(created.id, cookie, { lifecycle: "done" })).json()) as {
        spawned: { id: string; aiStatus: string; siftId: string | null };
      };
      expect(second.spawned.id).toBe(first.spawned.id);
      expect(second.spawned.aiStatus).toBe("pending");
      expect(second.spawned.siftId).toBeTruthy();
      expect(start).toHaveBeenCalledTimes(2);
    } finally {
      setWorkflowClientForTesting(null);
    }
  });

  it("the successor lands where the client says the task lived, else where the row was, else the Inbox", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "landing@example.com" });
    const make = async (lifecycle: "someday" | "waiting" | "active") => {
      const t = await repos.tasks.create(user.id, {
        sourceText: `Series ${lifecycle}`,
        sourceContext: null,
      });
      await repos.tasks.update(user.id, t.id, {
        lifecycle,
        aiStatus: "ready",
        recurrence: { freq: "daily", mode: "fixed" },
        seriesId: t.id,
      });
      return t.id;
    };
    const spawnedOf = async (res: Response) =>
      ((await res.json()) as { spawned: { lifecycle: string } }).spawned.lifecycle;

    // Client knows best.
    const a = await make("someday");
    expect(
      await spawnedOf(await patch(a, cookie, { lifecycle: "done", completedFrom: "waiting" })),
    ).toBe("waiting");
    // No client hint: the row before this write.
    const b = await make("waiting");
    expect(await spawnedOf(await patch(b, cookie, { lifecycle: "done" }))).toBe("waiting");
    // Retry after a crashed spawn: the row is already done; the Inbox is the review gate.
    const c = await make("active");
    await repos.tasks.update(user.id, c, { lifecycle: "done" });
    expect(await spawnedOf(await patch(c, cookie, { lifecycle: "done" }))).toBe("inbox");
  });

  it("spawns nothing for a one-off task or a non-completing patch", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "once@example.com" });
    const oneOff = await repos.tasks.create(user.id, { sourceText: "Once", sourceContext: null });
    const done = await patch(oneOff.id, cookie, { lifecycle: "done" });
    expect(((await done.json()) as { spawned: unknown }).spawned).toBeNull();

    const repeating = await repos.tasks.create(user.id, {
      sourceText: "Again",
      sourceContext: null,
    });
    await repos.tasks.update(user.id, repeating.id, {
      recurrence: { freq: "weekly", mode: "fixed", weekdays: [1] },
    });
    const retitled = await patch(repeating.id, cookie, { title: "Again, renamed" });
    expect(((await retitled.json()) as { spawned: unknown }).spawned).toBeNull();
    expect(await repos.tasks.list(user.id)).toHaveLength(2 + 3); // + the starter examples
  });

  it("accepts a recurrence rule from the sync layer and rejects malformed ones", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "rule@example.com" });
    const task = await repos.tasks.create(user.id, { sourceText: "Rule", sourceContext: null });

    const ok = await patch(task.id, cookie, {
      recurrence: {
        freq: "weekly",
        mode: "fixed",
        weekdays: [1, 4],
        seriesValues: { title: "Series title", urgency: 0.5 },
      },
      seriesId: task.id,
    });
    expect(ok.status).toBe(200);
    expect((await repos.tasks.get(user.id, task.id))?.recurrence).toEqual({
      freq: "weekly",
      mode: "fixed",
      weekdays: [1, 4],
      seriesValues: { title: "Series title", urgency: 0.5 },
    });

    expect(
      (await patch(task.id, cookie, { recurrence: { freq: "hourly", mode: "fixed" } })).status,
    ).toBe(400);
    expect(
      (
        await patch(task.id, cookie, {
          recurrence: { freq: "weekly", mode: "fixed", weekdays: [7] },
        })
      ).status,
    ).toBe(400);
    expect(
      (await patch(task.id, cookie, { lifecycle: "done", timeZone: "Mars/Olympus" })).status,
    ).toBe(400);

    const cleared = await patch(task.id, cookie, { recurrence: null });
    expect(cleared.status).toBe(200);
    expect((await repos.tasks.get(user.id, task.id))?.recurrence).toBeNull();
  });
});

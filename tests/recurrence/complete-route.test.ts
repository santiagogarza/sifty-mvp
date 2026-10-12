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
    expect(created.spawned).toMatchObject({
      due: "2026-10-13",
      lifecycle: "active",
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
    setWorkflowClientForTesting({ start, wait: vi.fn() });
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

import { nextInstanceId } from "@/lib/recurrence/spawn";
import { describe, expect, it } from "vitest";
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
      id: nextInstanceId(created.id),
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

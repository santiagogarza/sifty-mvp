import { describe, expect, it } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/** The sift poller reads `GET /api/tasks/:id`: task plus the labels it links. */
describe("GET /api/tasks/:id", () => {
  it("returns the task with its labels, and 404 for someone else's task", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "poll@example.com" });
    const other = await createUserWithCookie(repos, { email: "other-poll@example.com" });
    const work = await repos.labels.ensure(user.id, { id: "label_pw", name: "Work", tone: "mist" });
    await repos.labels.ensure(user.id, { id: "label_px", name: "Unused", tone: "sand" });
    const task = await repos.tasks.create(user.id, { sourceText: "Poll me", sourceContext: null });
    await repos.tasks.update(user.id, task.id, { labelIds: [work.id], siftStage: "triage" });

    const { GET } = await import("@/app/api/tasks/[id]/route");
    const ctx = { params: Promise.resolve({ id: task.id }) };
    const res = await GET(
      new Request(`http://localhost/api/tasks/${task.id}`, { headers: { cookie } }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.id).toBe(task.id);
    expect(body.task.siftStage).toBe("triage");
    expect(body.labels).toEqual([work]);

    const foreign = await GET(
      new Request(`http://localhost/api/tasks/${task.id}`, { headers: { cookie: other.cookie } }),
      ctx,
    );
    expect(foreign.status).toBe(404);
  });
});

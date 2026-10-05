import type { Lifecycle } from "@/lib/domain/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestRepos } from "../setup";

/**
 * The server derives `completedAt` from lifecycle the same way the client
 * store does. A board drag syncs the new status; if this drifts, the next
 * device pulls a Done card back into the wrong order.
 */

const T0 = "2026-07-22T12:00:00.000Z";
const T1 = "2026-07-22T15:00:00.000Z";

async function createInboxTask(sourceText: string) {
  const repos = getTestRepos();
  const user = await repos.users.create({
    email: `${sourceText.replace(/\s+/g, "-").toLowerCase()}@example.com`,
    passwordHash: null,
    displayName: "Lifecycle",
    isCreator: false,
  });
  const task = await repos.tasks.create(user.id, { sourceText, sourceContext: null });
  return { repos, userId: user.id, task };
}

describe("task lifecycle transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps completedAt when a task moves to done", async () => {
    const { repos, userId, task } = await createInboxTask("Ship the preview");
    vi.setSystemTime(new Date(T1));

    const updated = await repos.tasks.update(userId, task.id, { lifecycle: "done" });

    expect(updated?.lifecycle).toBe("done");
    expect(updated?.completedAt).toBe(T1);
    expect(updated?.createdAt).toBe(T0);
  });

  it("clears completedAt when a finished task leaves done", async () => {
    const destinations: Lifecycle[] = ["inbox", "active", "waiting", "someday", "dropped"];
    for (const lifecycle of destinations) {
      const { repos, userId, task } = await createInboxTask(`Reopen ${lifecycle}`);
      await repos.tasks.update(userId, task.id, { lifecycle: "done" });
      vi.setSystemTime(new Date(T1));

      const updated = await repos.tasks.update(userId, task.id, { lifecycle });

      expect(updated?.lifecycle).toBe(lifecycle);
      expect(updated?.completedAt).toBeNull();
    }
  });

  it("keeps the original completion stamp when done is patched again", async () => {
    const { repos, userId, task } = await createInboxTask("File the receipt");
    const finished = await repos.tasks.update(userId, task.id, { lifecycle: "done" });
    expect(finished?.completedAt).toBe(T0);

    vi.setSystemTime(new Date(T1));
    const again = await repos.tasks.update(userId, task.id, { lifecycle: "done" });

    expect(again?.lifecycle).toBe("done");
    expect(again?.completedAt).toBe(T0);
    expect(again?.updatedAt).toBe(T1);
  });

  it("leaves the completion stamp in place when the patch is not a status change", async () => {
    const { repos, userId, task } = await createInboxTask("Book the venue");
    await repos.tasks.update(userId, task.id, { lifecycle: "done" });
    vi.setSystemTime(new Date(T1));

    const updated = await repos.tasks.update(userId, task.id, { title: "Book the smaller venue" });

    expect(updated?.title).toBe("Book the smaller venue");
    expect(updated?.lifecycle).toBe("done");
    expect(updated?.completedAt).toBe(T0);
  });

  it("returns null when the task does not exist", async () => {
    const { repos, userId } = await createInboxTask("Missing target");

    expect(await repos.tasks.update(userId, "task_missing", { lifecycle: "done" })).toBeNull();
  });
});

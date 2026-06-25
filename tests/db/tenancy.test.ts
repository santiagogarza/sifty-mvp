import { describe, expect, it } from "vitest";
import { getTestRepos } from "../setup";

/**
 * Tenancy guard.
 *
 * The repository contract is: every method that takes `userId` must ignore
 * rows owned by other users. This test exercises that against the
 * in-memory repository (which mirrors the Postgres one's semantics) and
 * should be expanded to run against a real Postgres in CI when DATABASE_URL
 * is set.
 */
describe("repository tenancy", () => {
  it("never returns or mutates another user's rows", async () => {
    const repos = getTestRepos();
    const a = await repos.users.create({
      email: "a@example.com",
      passwordHash: null,
      displayName: "A",
      isCreator: false,
    });
    const b = await repos.users.create({
      email: "b@example.com",
      passwordHash: null,
      displayName: "B",
      isCreator: false,
    });

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
    await repos.memories.create(a.id, "I avoid deep work after 4pm");
    expect(await repos.memories.list(b.id)).toEqual([]);

    // aiRuns counts don't leak
    await repos.aiRuns.insert({
      userId: a.id,
      taskId: aTask.id,
      promptVersion: "triage.v1",
      model: "anthropic/claude-haiku-4-5",
      transport: "gateway",
      status: "succeeded",
      durationMs: 100,
      inputTokens: 10,
      outputTokens: 20,
      costCents: 1,
      offline: false,
      error: null,
    });
    expect(await repos.aiRuns.countSucceededToday(a.id)).toBe(1);
    expect(await repos.aiRuns.countSucceededToday(b.id)).toBe(0);
  });
});

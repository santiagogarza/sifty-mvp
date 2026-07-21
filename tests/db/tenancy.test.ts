import { IdConflictError } from "@/lib/db/repos/types";
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
    await repos.memories.create(a.id, { text: "I avoid deep work after 4pm" });
    expect(await repos.memories.list(b.id)).toEqual([]);

    // Labels are isolated, and B can't link A's label to B's task
    const aLabel = await repos.labels.ensure(a.id, { id: "label_a1", name: "Work", tone: "sand" });
    expect(await repos.labels.list(b.id)).toEqual([]);
    const bTask = await repos.tasks.create(b.id, { sourceText: "B task", sourceContext: null });
    const bPatched = await repos.tasks.update(b.id, bTask.id, { labelIds: [aLabel.id] });
    expect(bPatched?.labelIds).toEqual([]);

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

  it("labels.ensure never claims or clobbers another tenant's id", async () => {
    const repos = getTestRepos();
    const a = await repos.users.create({
      email: "la@example.com",
      passwordHash: null,
      displayName: "A",
      isCreator: false,
    });
    const b = await repos.users.create({
      email: "lb@example.com",
      passwordHash: null,
      displayName: "B",
      isCreator: false,
    });

    const aLabel = await repos.labels.ensure(a.id, { id: "label_x1", name: "Work", tone: "sand" });
    // B pushes a label suggesting A's id: gets a fresh id, A's row intact.
    const bLabel = await repos.labels.ensure(b.id, { id: "label_x1", name: "Focus", tone: "mist" });
    expect(bLabel.id).not.toBe(aLabel.id);
    expect(await repos.labels.list(a.id)).toEqual([aLabel]);
    expect(await repos.labels.list(b.id)).toEqual([bLabel]);
  });

  it("memories.create is idempotent for the owner and 409-conflicts across tenants", async () => {
    const repos = getTestRepos();
    const a = await repos.users.create({
      email: "ma@example.com",
      passwordHash: null,
      displayName: "A",
      isCreator: false,
    });
    const b = await repos.users.create({
      email: "mb@example.com",
      passwordHash: null,
      displayName: "B",
      isCreator: false,
    });

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

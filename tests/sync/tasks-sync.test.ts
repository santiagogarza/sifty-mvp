import { describe, expect, it } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * Sync contract for the task/label/memory routes: the client store creates
 * entities optimistically with its own ids and replays them; the server
 * must accept those ids, be idempotent on retries, and round-trip labels.
 */

async function post(path: string, cookie: string, body: unknown, method = "POST") {
  const routes = {
    "/api/tasks": (await import("@/app/api/tasks/route")).POST,
    "/api/labels": (await import("@/app/api/labels/route")).PUT,
    "/api/memories": (await import("@/app/api/memories/route")).POST,
  } as const;
  const handler = routes[path as keyof typeof routes];
  return handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );
}

describe("task sync contract", () => {
  it("accepts a client-generated id with enrichment and round-trips labels", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "sync@example.com" });

    const labelRes = await post(
      "/api/labels",
      cookie,
      { id: "label_abc123", name: "Work", tone: "sand" },
      "PUT",
    );
    expect(labelRes.status).toBe(200);

    const res = await post("/api/tasks", cookie, {
      id: "task_client1",
      sourceText: "Ship the thing",
      sourceContext: null,
      createdAt: "2026-07-01T10:00:00.000Z",
      title: "Ship the thing, properly",
      lifecycle: "active",
      aiStatus: "ready",
      urgency: 0.8,
      importance: 0.9,
      labelIds: ["label_abc123"],
      subtasks: [{ id: "st_1", title: "Write the plan", done: false, order: 0 }],
      editedFields: ["title"],
    });
    expect(res.status).toBe(201);
    const { task } = await res.json();
    expect(task.id).toBe("task_client1");
    expect(task.title).toBe("Ship the thing, properly");
    expect(task.labelIds).toEqual(["label_abc123"]);
    expect(task.createdAt).toBe("2026-07-01T10:00:00.000Z");
    expect(task.editedFields).toEqual(["title"]);

    const listed = await repos.tasks.list(user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.labelIds).toEqual(["label_abc123"]);
    expect(listed[0]!.subtasks[0]!.title).toBe("Write the plan");
  });

  it("create is idempotent per id and 409s on a cross-tenant id claim", async () => {
    const repos = getTestRepos();
    const { cookie } = await createUserWithCookie(repos, { email: "a-sync@example.com" });
    const { cookie: otherCookie } = await createUserWithCookie(repos, {
      email: "b-sync@example.com",
    });

    const body = { id: "task_shared1", sourceText: "Mine", sourceContext: null };
    expect((await post("/api/tasks", cookie, body)).status).toBe(201);
    // Replay (e.g. retried push) returns the same task, no duplicate.
    const replay = await post("/api/tasks", cookie, body);
    expect(replay.status).toBe(201);

    // Another tenant cannot claim the id.
    const stolen = await post("/api/tasks", otherCookie, body);
    expect(stolen.status).toBe(409);
  });

  it("label ensure is idempotent by name and returns the canonical label", async () => {
    const { cookie } = await createUserWithCookie(getTestRepos(), {
      email: "labels@example.com",
    });
    const first = await post(
      "/api/labels",
      cookie,
      { id: "label_dev1", name: "Errand", tone: "sage" },
      "PUT",
    );
    const { label: a } = await first.json();
    // Second device pushes the same name with a different id.
    const second = await post(
      "/api/labels",
      cookie,
      { id: "label_dev2", name: "errand", tone: "mist" },
      "PUT",
    );
    const { label: b } = await second.json();
    expect(b.id).toBe(a.id);
  });

  it("accepts the sync layer's full-entity PATCH body verbatim", async () => {
    // Regression: the client pushes edits as the complete wire entity. If
    // the strict PATCH schema drifts from that shape, every edit push 400s
    // and user edits silently stop reaching the server.
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "patch@example.com" });
    const task = await repos.tasks.create(user.id, {
      sourceText: "Original capture",
      sourceContext: null,
    });

    const fullEntityBody = {
      title: "Edited title",
      description: null,
      nextAction: null,
      sourceContext: "Answer: yes, by Friday",
      lifecycle: "inbox",
      aiStatus: "ready",
      aiError: null,
      aiAttempts: 1,
      urgency: 0.5,
      importance: 0.5,
      priorityBucket: "schedule",
      effort: "small",
      due: null,
      delegationCandidate: "self",
      confidence: 0.7,
      clarifyingQuestion: null,
      rationale: "r",
      agentBrief: null,
      labelIds: [],
      subtasks: [],
      editedFields: ["title"],
    };
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const res = await PATCH(
      new Request(`http://localhost/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(fullEntityBody),
      }),
      { params: Promise.resolve({ id: task.id }) },
    );
    expect(res.status).toBe(200);
    const persisted = await repos.tasks.get(user.id, task.id);
    expect(persisted?.title).toBe("Edited title");
    expect(persisted?.sourceContext).toBe("Answer: yes, by Friday");
    expect(persisted?.editedFields).toEqual(["title"]);
  });

  it("memory create accepts the client id and full shape", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "mem@example.com" });
    const res = await post("/api/memories", cookie, {
      id: "mem_client1",
      text: "Prefers mornings",
      kind: "preference",
      pinned: true,
    });
    expect(res.status).toBe(201);
    const listed = await repos.memories.list(user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe("mem_client1");
    expect(listed[0]!.pinned).toBe(true);
  });
});

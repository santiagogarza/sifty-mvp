// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ClientHandle, bootClient, settle } from "./client-harness";

// The tasks route hands new captures to the Workflow runtime, whose package
// hardens realm intrinsics on import and does not load under jsdom. The
// sync contract does not depend on the sift running, so enqueueing is
// stubbed at its seam: creates still come back `pending`.
vi.mock("@/lib/ai/sift/enqueue", () => ({
  enqueueSift: async ({ task }: { task: { id: string } }) => ({
    ok: true,
    task,
    siftId: "sift_sync_test",
    runId: "wrun_sync_test",
  }),
  wantsSift: (task: { aiStatus: string }) =>
    task.aiStatus === "pending" || task.aiStatus === "running" || task.aiStatus === "failed",
}));

/**
 * Client sync behavior, end to end: store mutation → `lib/store/sync` →
 * real route handlers → in-memory repo, and back through pull/reconcile.
 * Each scenario here reproduces a finding from
 * `.cursor/reviews/review-sync-demo-45c2-b7e2.md`.
 */

const LEDGER_KEY = "sifty-sync-ledger-v1";

function ledger() {
  return JSON.parse(window.localStorage.getItem(LEDGER_KEY) ?? "null");
}

async function bootAndPull(previous?: ClientHandle): Promise<ClientHandle> {
  const client = await bootClient(previous);
  await client.sync.syncFromServer();
  await settle(client);
  return client;
}

/**
 * Capture a task and let its create land. Marks it `ready` so the mount
 * pull's triage auto-resume (which this harness does not route) stays out
 * of the call log.
 */
async function captureSynced(client: ClientHandle, text: string): Promise<string> {
  const task = client.store.getState().createTask({ sourceText: text });
  client.store.getState().setAiStatus(task.id, "ready");
  await settle(client);
  expect((await client.repos.tasks.get(client.userId, task.id))?.aiStatus).toBe("ready");
  return task.id;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("narrow patches", () => {
  it("pushes only the keys that changed and never clobbers fields written server-side", async () => {
    const client = await bootAndPull();
    const id = await captureSynced(client, "Write the launch post");

    // Something lands on the server behind the client's back (agent-brief
    // route, another device, a triage result).
    await client.repos.tasks.update(client.userId, id, {
      agentBrief: "# Brief",
      due: "2026-11-02",
    });

    client.calls.length = 0;
    client.store.getState().updateTask(id, { title: "Launch post" }, { editedFields: ["title"] });
    await settle(client);

    const patches = client.calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(Object.keys(patches[0]!.body as object).sort()).toEqual(["editedFields", "title"]);

    const server = await client.repos.tasks.get(client.userId, id);
    expect(server?.title).toBe("Launch post");
    expect(server?.agentBrief).toBe("# Brief");
    expect(server?.due).toBe("2026-11-02");
  });

  it("replays only the dirty keys after a reload", async () => {
    const client = await bootAndPull();
    const id = await captureSynced(client, "Call the accountant");

    const offline = client.intercept((method) => {
      if (method === "PATCH") throw new TypeError("Failed to fetch");
      return null;
    });
    client.store.getState().updateTask(id, { effort: "deep" }, { editedFields: ["effort"] });
    await settle(client);
    offline();
    expect(ledger().dirty.tasks[id]).toEqual(expect.arrayContaining(["effort"]));

    await client.repos.tasks.update(client.userId, id, { nextAction: "Book a slot" });

    const reloaded = await bootAndPull(client);
    const patches = reloaded.calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(Object.keys(patches[0]!.body as object).sort()).toEqual(["editedFields", "effort"]);
    const server = await reloaded.repos.tasks.get(reloaded.userId, id);
    expect(server?.effort).toBe("deep");
    expect(server?.nextAction).toBe("Book a slot");
  });
});

describe("narrow memory patches", () => {
  it("sends only the changed memory key and keeps server-side fields", async () => {
    const client = await bootAndPull();
    const memory = client.store.getState().addMemory({ text: "Prefers mornings" });
    await settle(client);
    await client.repos.memories.update(client.userId, memory.id, { pinned: true });

    client.calls.length = 0;
    client.store.getState().updateMemory(memory.id, { text: "Prefers early mornings" });
    await settle(client);

    const patches = client.calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(Object.keys(patches[0]!.body as object)).toEqual(["text"]);
    const server = (await client.repos.memories.list(client.userId)).find(
      (m) => m.id === memory.id,
    );
    expect(server?.text).toBe("Prefers early mornings");
    expect(server?.pinned).toBe(true);
  });
});

describe("reconcile", () => {
  it("overlays the dirty keys onto the server copy instead of keeping the whole stale entity", async () => {
    const client = await bootAndPull();
    const id = await captureSynced(client, "Renew the passport");

    // Another device sets (and protects) a due date while this one is
    // offline editing the title.
    await client.repos.tasks.update(
      client.userId,
      id,
      { due: "2026-12-01" },
      { editedFields: ["due"] },
    );
    const offline = client.intercept((method) => {
      if (method === "PATCH") throw new TypeError("Failed to fetch");
      return null;
    });
    client.store
      .getState()
      .updateTask(id, { title: "Renew passport" }, { editedFields: ["title"] });
    await settle(client);
    offline();

    const reloaded = await bootAndPull(client);
    const local = reloaded.store.getState().tasks.find((t) => t.id === id);
    expect(local?.title).toBe("Renew passport");
    expect(local?.due).toBe("2026-12-01");
    expect(local?.editedFields.sort()).toEqual(["due", "title"]);

    const server = await reloaded.repos.tasks.get(reloaded.userId, id);
    expect(server?.title).toBe("Renew passport");
    expect(server?.due).toBe("2026-12-01");
    expect(server?.editedFields.sort()).toEqual(["due", "title"]);
  });

  it("carries a pending lifecycle change's completedAt through a reload", async () => {
    const client = await bootAndPull();
    const id = await captureSynced(client, "File the expense report");

    const offline = client.intercept((method) => {
      if (method === "PATCH") throw new TypeError("Failed to fetch");
      return null;
    });
    client.store.getState().setLifecycle(id, "done");
    await settle(client);
    offline();
    const completedAt = client.store.getState().tasks.find((t) => t.id === id)?.completedAt;
    expect(completedAt).toBeTruthy();

    const reloaded = await bootAndPull(client);
    const local = reloaded.store.getState().tasks.find((t) => t.id === id);
    expect(local?.lifecycle).toBe("done");
    expect(local?.completedAt).toBe(completedAt);
    expect((await reloaded.repos.tasks.get(reloaded.userId, id))?.completedAt).toBeTruthy();
  });

  it("shares one pull between concurrent mounts", async () => {
    const client = await bootClient();
    await Promise.all([client.sync.syncFromServer(), client.sync.syncFromServer()]);
    await settle(client);
    expect(client.calls.filter((c) => c.method === "GET" && c.path === "/api/tasks")).toHaveLength(
      1,
    );
    expect(client.calls.filter((c) => c.path === "/api/auth/me")).toHaveLength(1);
  });

  it("does not let a push that settles during an overlapping pull clear its dirty mark", async () => {
    const client = await bootAndPull();
    const id = await captureSynced(client, "Ship it");

    // Hold the second mount's snapshot after it was taken, so it is stale
    // by the time it is reconciled.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let gated = 0;
    const ungate = client.intercept(async (method, path, proceed) => {
      if (method !== "GET" || path !== "/api/tasks" || gated++ > 0) return null;
      const res = await proceed();
      await gate;
      return res;
    });

    const pull = client.sync.syncFromServer();
    client.store.getState().updateTask(id, { title: "Shipped" }, { editedFields: ["title"] });
    await vi.advanceTimersByTimeAsync(500); // PATCH lands while the pull is in flight
    expect((await client.repos.tasks.get(client.userId, id))?.title).toBe("Shipped");
    expect(ledger().dirty.tasks[id]).toBeDefined();

    release();
    await pull;
    ungate();
    await settle(client);
    expect(client.store.getState().tasks.find((t) => t.id === id)?.title).toBe("Shipped");
    expect(ledger().dirty.tasks[id]).toBeUndefined();
  });
});

describe("rejections", () => {
  it("treats a 4xx as terminal: no replay, surfaced as not syncing, retried only on the next edit", async () => {
    const client = await bootAndPull();
    const id = await captureSynced(client, "Pay the invoice");

    client.calls.length = 0;
    const reject = client.intercept((method) =>
      method === "PATCH"
        ? new Response(JSON.stringify({ error: "Invalid input" }), { status: 400 })
        : null,
    );
    client.store.getState().updateTask(id, { title: "Pay invoice" }, { editedFields: ["title"] });
    await settle(client);
    reject();
    expect(client.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(client.sync.getSyncStatus().rejected).toBe(1);

    // A reload must not replay the rejected push, and must keep the flag.
    const reloaded = await bootAndPull(client);
    expect(reloaded.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect(reloaded.sync.getSyncStatus().rejected).toBe(1);
    // The local edit is kept, not reverted to the server copy.
    expect(reloaded.store.getState().tasks.find((t) => t.id === id)?.title).toBe("Pay invoice");

    // The next edit gets exactly one fresh attempt, which clears the flag.
    reloaded.calls.length = 0;
    reloaded.store.getState().updateTask(id, { title: "Pay the invoice today" });
    await settle(reloaded);
    expect(reloaded.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(reloaded.sync.getSyncStatus().rejected).toBe(0);
    expect((await reloaded.repos.tasks.get(reloaded.userId, id))?.title).toBe(
      "Pay the invoice today",
    );
  });

  it("keeps a 408 retryable", async () => {
    const client = await bootAndPull();
    const id = await captureSynced(client, "Book the dentist");

    const timeout = client.intercept((method) =>
      method === "PATCH" ? new Response(null, { status: 408 }) : null,
    );
    client.store.getState().updateTask(id, { title: "Dentist" }, { editedFields: ["title"] });
    await settle(client);
    timeout();
    expect(client.sync.getSyncStatus().rejected).toBe(0);

    const reloaded = await bootAndPull(client);
    expect((await reloaded.repos.tasks.get(reloaded.userId, id))?.title).toBe("Dentist");
  });

  it("rejects the task that references a rejected label instead of deferring it forever", async () => {
    const client = await bootAndPull();
    const id = await captureSynced(client, "Plan the offsite");

    client.calls.length = 0;
    const reject = client.intercept((method) =>
      method === "PUT"
        ? new Response(JSON.stringify({ error: "Invalid input" }), { status: 400 })
        : null,
    );
    const label = client.store.getState().ensureLabel("Offsite");
    client.store
      .getState()
      .updateTask(id, { labelIds: [label.id] }, { editedFields: ["labelIds"] });
    await settle(client);
    reject();

    expect(client.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect(client.sync.getSyncStatus().rejected).toBe(2);
    expect((await client.repos.tasks.get(client.userId, id))?.labelIds).toEqual([]);

    const reloaded = await bootAndPull(client);
    expect(reloaded.calls.filter((c) => c.method === "PUT" || c.method === "PATCH")).toHaveLength(
      0,
    );
    expect(reloaded.sync.getSyncStatus().rejected).toBe(2);
  });

  it("keeps a 429 retryable", async () => {
    const client = await bootAndPull();
    const id = await captureSynced(client, "Water the plants");

    const limit = client.intercept((method) =>
      method === "PATCH" ? new Response(null, { status: 429 }) : null,
    );
    client.store.getState().updateTask(id, { title: "Water plants" }, { editedFields: ["title"] });
    await settle(client);
    limit();
    expect(client.sync.getSyncStatus().rejected).toBe(0);

    const reloaded = await bootAndPull(client);
    expect(reloaded.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect((await reloaded.repos.tasks.get(reloaded.userId, id))?.title).toBe("Water plants");
  });
});

describe("replay ordering", () => {
  async function captureWithOfflineLabel(client: ClientHandle) {
    const id = await captureSynced(client, "Draft the grant");
    const offline = client.intercept((method) => {
      if (method !== "GET") throw new TypeError("Failed to fetch");
      return null;
    });
    const label = client.store.getState().ensureLabel("Grants");
    client.store
      .getState()
      .updateTask(id, { labelIds: [label.id] }, { editedFields: ["labelIds"] });
    await settle(client);
    offline();
    expect(ledger().dirty.labels[label.id]).toBeDefined();
    expect(ledger().dirty.tasks[id]).toBeDefined();
    return { id, labelId: label.id };
  }

  it("pushes a dirty label before the dirty task that references it", async () => {
    const client = await bootAndPull();
    const { id, labelId } = await captureWithOfflineLabel(client);

    const reloaded = await bootAndPull(client);
    const order = reloaded.calls
      .filter((c) => c.method === "PUT" || c.method === "PATCH")
      .map((c) => c.method);
    expect(order.indexOf("PUT")).toBeLessThan(order.indexOf("PATCH"));
    const server = await reloaded.repos.tasks.get(reloaded.userId, id);
    expect(server?.labelIds).toEqual([labelId]);
    expect(ledger().dirty.tasks[id]).toBeUndefined();
    expect(ledger().dirty.labels[labelId]).toBeUndefined();
  });

  it("defers the task when its label replay fails instead of dropping the link", async () => {
    const client = await bootAndPull();
    const { id, labelId } = await captureWithOfflineLabel(client);

    const reloaded = await bootClient(client);
    reloaded.intercept((method) => (method === "PUT" ? new Response(null, { status: 503 }) : null));
    await reloaded.sync.syncFromServer();
    await settle(reloaded);
    expect(reloaded.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect((await reloaded.repos.tasks.get(reloaded.userId, id))?.labelIds).toEqual([]);
    expect(ledger().dirty.tasks[id]).toBeDefined();

    const healed = await bootAndPull(reloaded);
    expect((await healed.repos.tasks.get(healed.userId, id))?.labelIds).toEqual([labelId]);
  });
});

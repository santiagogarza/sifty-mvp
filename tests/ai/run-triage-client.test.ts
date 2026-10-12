// @vitest-environment jsdom
import type { Task } from "@/lib/domain/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The browser side of server-side sifting: `resiftTask` must put the
 * persisted preference on the wire as `modelPreference`, and `watchSift`
 * must adopt stage progress from `GET /api/tasks/:id` — fully when the
 * task is clean, bookkeeping-only while local edits are unpushed.
 */

const STORE_KEY = "sifty-store-v1";

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function serverTask(local: Task, patch: Partial<Task>): Task {
  return { ...local, ...patch };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function setup(opts: { dirty?: () => boolean; waitForTask?: () => Promise<void> } = {}) {
  const { registerSyncHooks, useStore } = await import("@/lib/store/store");
  registerSyncHooks({
    taskUpserted: () => {},
    taskDeleted: () => {},
    labelEnsured: () => {},
    memoryUpserted: () => {},
    memoryDeleted: () => {},
    waitForTask: opts.waitForTask ?? (async () => {}),
    isTaskDirty: opts.dirty ?? (() => false),
  });
  return { useStore, registerSyncHooks };
}

describe("resiftTask", () => {
  it("POSTs taskId + modelPreference, then polls the task until it is ready", async () => {
    vi.useFakeTimers();
    const { useStore, registerSyncHooks } = await setup();
    const { resiftTask } = await import("@/lib/ai/run-triage");

    useStore.getState().setModelPreference("openai");
    const task = useStore.getState().createTask({ sourceText: "Call the bank tomorrow" });

    // Every poll carries the siftId the 202 announced; a watcher never
    // settles on a snapshot from another run.
    const states: Array<Partial<Task>> = [
      { aiStatus: "running", siftStage: "enrich", title: "Call the bank", siftId: "s" },
      {
        aiStatus: "running",
        siftStage: "plan",
        title: "Call the bank",
        nextAction: "Call",
        siftId: "s",
      },
      {
        aiStatus: "ready",
        siftStage: null,
        title: "Call the bank",
        nextAction: "Call",
        siftId: "s",
      },
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/triage") {
        return json(
          { task: serverTask(task, { aiStatus: "pending" }), siftId: "s", runId: "r" },
          202,
        );
      }
      const next = states.shift() ?? { aiStatus: "ready" as const, siftStage: null, siftId: "s" };
      return json({ task: serverTask(task, next), labels: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = resiftTask(task.id);
    await vi.advanceTimersByTimeAsync(10_000);
    await run;

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/triage");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({ taskId: task.id, modelPreference: "openai" });

    const polls = fetchMock.mock.calls.filter(([u]) => u !== "/api/triage");
    expect(polls.length).toBe(3);
    expect(polls[0]![0]).toBe(`/api/tasks/${task.id}`);

    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.aiStatus).toBe("ready");
    expect(updated?.title).toBe("Call the bank");
    expect(updated?.nextAction).toBe("Call");
    registerSyncHooks(null);
  });

  it("a double click sends one POST (the lock) and a re-sift while watching re-arms the watcher", async () => {
    vi.useFakeTimers();
    const { useStore, registerSyncHooks } = await setup();
    const { isTriageInFlight, resiftTask, watchSift } = await import("@/lib/ai/run-triage");
    const task = useStore.getState().createTask({ sourceText: "Call the bank" });

    // Poll answers: the first run finishes (ready, attempt 1); after the
    // re-sift the server reports pending → running → ready (attempt 2).
    let posts = 0;
    let pollsAfterResift = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/triage") {
        posts += 1;
        return json(
          { task: serverTask(task, { aiStatus: "pending" }), siftId: "s2", runId: "r2" },
          202,
        );
      }
      if (posts === 0) {
        return json({
          task: serverTask(task, { aiStatus: "ready", aiAttempts: 1, siftId: "s1" }),
          labels: [],
        });
      }
      pollsAfterResift += 1;
      // The first poll after the POST still shows the superseded run.
      const state: Partial<Task> =
        pollsAfterResift === 1
          ? { aiStatus: "ready", siftStage: null, aiAttempts: 1, siftId: "s1" }
          : pollsAfterResift === 2
            ? { aiStatus: "running", siftStage: "enrich", aiAttempts: 1, siftId: "s2" }
            : { aiStatus: "ready", siftStage: null, aiAttempts: 2, siftId: "s2" };
      return json({ task: serverTask(task, state), labels: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Watcher running; its first poll (old run's final state) is in flight
    // when the user re-sifts twice in a row.
    const watch = watchSift(task.id);
    const a = resiftTask(task.id);
    const b = resiftTask(task.id);
    expect(isTriageInFlight(task.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([watch, a, b]);

    expect(posts).toBe(1);
    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.aiStatus).toBe("ready");
    expect(updated?.aiAttempts).toBe(2);
    registerSyncHooks(null);
  });

  it("a re-sift that lands while the watcher is adopting a settled, dirty snapshot is not wiped", async () => {
    vi.useFakeTimers();
    let dirty = true;
    let waits = 0;
    const { useStore, registerSyncHooks } = await setup({
      dirty: () => dirty,
      // The create has long landed (first wait resolves at once); the edit's
      // push "drains" slowly, and the user re-sifts while the watcher waits.
      waitForTask: () =>
        ++waits === 1 ? Promise.resolve() : new Promise((r) => setTimeout(r, 2_000)),
    });
    const { resiftTask, watchSift } = await import("@/lib/ai/run-triage");
    const task = useStore.getState().createTask({ sourceText: "Call the bank" });
    useStore.getState().updateTask(task.id, { title: "Mine" }, { editedFields: ["title"] });

    let posts = 0;
    let newRunPolls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/triage") {
          posts += 1;
          return json(
            { task: serverTask(task, { aiStatus: "pending" }), siftId: "s2", runId: "r2" },
            202,
          );
        }
        if (posts === 0) {
          return json({
            task: serverTask(task, { aiStatus: "ready", aiAttempts: 1, siftId: "s1" }),
            labels: [],
          });
        }
        newRunPolls += 1;
        const state: Partial<Task> =
          newRunPolls < 2
            ? { aiStatus: "running", siftStage: "plan", aiAttempts: 1, siftId: "s2" }
            : { aiStatus: "ready", siftStage: null, aiAttempts: 2, siftId: "s2" };
        return json({ task: serverTask(task, state), labels: [] });
      }),
    );

    let sawFailure = false;
    const unsubscribe = useStore.subscribe((s) => {
      if (s.tasks.find((t) => t.id === task.id)?.aiStatus === "failed") sawFailure = true;
    });
    const watch = watchSift(task.id);
    // First poll (old run, ready) is adopted while dirty → the watcher waits
    // on the push; the re-sift lands during that wait, after the first run
    // has already used the whole watch budget.
    await vi.advanceTimersByTimeAsync(500);
    vi.setSystemTime(Date.now() + 130_000);
    const resift = resiftTask(task.id);
    await vi.advanceTimersByTimeAsync(3_000);
    dirty = false; // the edit has been pushed by now
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all([watch, resift]);
    unsubscribe();

    expect(posts).toBe(1);
    // The spent budget of the first run never times the new one out.
    expect(sawFailure).toBe(false);
    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.aiAttempts).toBe(2);
    expect(updated?.aiStatus).toBe("ready");
    registerSyncHooks(null);
  });

  it("a denial while local edits are unpushed keeps the edits and adopts only the status", async () => {
    const { useStore, registerSyncHooks } = await setup({ dirty: () => true });
    const { resiftTask } = await import("@/lib/ai/run-triage");
    const task = useStore.getState().createTask({ sourceText: "One more" });
    useStore.getState().updateTask(task.id, { title: "My title" }, { editedFields: ["title"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          {
            error: "You've used today's 5 free sifts.",
            code: "free_cap",
            task: serverTask(task, {
              title: "Server title",
              aiStatus: "failed",
              aiError: "You've used today's 5 free sifts.",
            }),
          },
          402,
        ),
      ),
    );
    await resiftTask(task.id);
    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.title).toBe("My title");
    expect(updated?.aiStatus).toBe("failed");
    expect(updated?.aiError).toBe("You've used today's 5 free sifts.");
    registerSyncHooks(null);
  });

  it("surfaces a cap denial from the server on the task", async () => {
    const { useStore, registerSyncHooks } = await setup();
    const { resiftTask } = await import("@/lib/ai/run-triage");
    const task = useStore.getState().createTask({ sourceText: "One more" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          {
            error: "You've used today's 5 free sifts.",
            code: "free_cap",
            task: serverTask(task, {
              aiStatus: "failed",
              aiError: "You've used today's 5 free sifts.",
            }),
          },
          402,
        ),
      ),
    );
    await resiftTask(task.id);
    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.aiStatus).toBe("failed");
    expect(updated?.aiError).toBe("You've used today's 5 free sifts.");
    registerSyncHooks(null);
  });
});

describe("watchSift", () => {
  it("adopts stage progress as it lands and new labels with it", async () => {
    vi.useFakeTimers();
    const { useStore, registerSyncHooks } = await setup();
    const { watchSift } = await import("@/lib/ai/run-triage");
    const task = useStore.getState().createTask({ sourceText: "Draft the investor update" });

    const label = { id: "label_work", name: "Work", tone: "mist" as const };
    const states: Array<{ task: Partial<Task>; labels: unknown[] }> = [
      { task: { aiStatus: "running", siftStage: "enrich" }, labels: [] },
      {
        task: { aiStatus: "running", siftStage: "prioritize", labelIds: [label.id] },
        labels: [label],
      },
      {
        task: {
          aiStatus: "ready",
          siftStage: null,
          labelIds: [label.id],
          title: "Investor update",
        },
        labels: [label],
      },
    ];
    const seen: Array<string | null> = [];
    const fetchMock = vi.fn(async () => {
      const next = states.shift() ?? states[0]!;
      return json({ task: serverTask(task, next.task), labels: next.labels });
    });
    vi.stubGlobal("fetch", fetchMock);
    const unsubscribe = useStore.subscribe((s) => {
      const t = s.tasks.find((x) => x.id === task.id);
      if (t && seen[seen.length - 1] !== t.siftStage) seen.push(t.siftStage);
    });

    const run = watchSift(task.id);
    await vi.advanceTimersByTimeAsync(10_000);
    await run;
    unsubscribe();

    expect(seen).toEqual(["enrich", "prioritize", null]);
    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.aiStatus).toBe("ready");
    expect(updated?.title).toBe("Investor update");
    expect(useStore.getState().labels.map((l) => l.id)).toContain("label_work");
    registerSyncHooks(null);
  });

  it("while local edits are unpushed it adopts only AI bookkeeping, never content", async () => {
    vi.useFakeTimers();
    // Local edits stay unpushed until the watcher waits for the chain after
    // the settled snapshot has been served; then the push "drains".
    let dirty = true;
    let readySeen = false;
    const { useStore, registerSyncHooks } = await setup({
      dirty: () => dirty,
      waitForTask: async () => {
        if (readySeen) dirty = false;
      },
    });
    const { watchSift } = await import("@/lib/ai/run-triage");
    const task = useStore.getState().createTask({ sourceText: "Draft the investor update" });
    useStore.getState().updateTask(task.id, { title: "My title" }, { editedFields: ["title"] });

    const states: Array<Partial<Task>> = [
      { aiStatus: "running", siftStage: "triage", title: "Server title" },
      { aiStatus: "ready", siftStage: null, title: "Server title", nextAction: "Server action" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const next = states.shift();
        if (!next) {
          // The post-settle refetch once the push drained.
          return json({
            task: serverTask(task, {
              aiStatus: "ready",
              title: "My title",
              nextAction: "Server action",
            }),
            labels: [],
          });
        }
        if (next.aiStatus === "ready") readySeen = true;
        return json({ task: serverTask(task, next), labels: [] });
      }),
    );

    const run = watchSift(task.id);
    await vi.advanceTimersByTimeAsync(10_000);
    await run;

    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.title).toBe("My title");
    expect(updated?.aiStatus).toBe("ready");
    expect(updated?.nextAction).toBe("Server action");
    registerSyncHooks(null);
  });

  it("gives up with a retryable message when the sift never settles", async () => {
    vi.useFakeTimers();
    const { useStore, registerSyncHooks } = await setup();
    const { SIFT_TIMEOUT_MESSAGE, watchSift } = await import("@/lib/ai/run-triage");
    const task = useStore.getState().createTask({ sourceText: "Stuck" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ task: serverTask(task, { aiStatus: "running", siftStage: "enrich" }), labels: [] }),
      ),
    );
    const run = watchSift(task.id);
    await vi.advanceTimersByTimeAsync(130_000);
    await run;
    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.aiStatus).toBe("failed");
    expect(updated?.aiError).toBe(SIFT_TIMEOUT_MESSAGE);
    registerSyncHooks(null);
  });

  it("stops quietly when the task never reached the server (404)", async () => {
    const { useStore, registerSyncHooks } = await setup();
    const { watchSift } = await import("@/lib/ai/run-triage");
    const task = useStore.getState().createTask({ sourceText: "Offline capture" });
    const fetchMock = vi.fn(async () => json({ error: "Not found" }, 404));
    vi.stubGlobal("fetch", fetchMock);
    await watchSift(task.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useStore.getState().tasks.find((t) => t.id === task.id)?.aiStatus).toBe("pending");
    registerSyncHooks(null);
  });
});

describe("store persistence", () => {
  it("migrates a v3 blob's preferredModelId onto a registry preference", async () => {
    window.localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        state: { tasks: [], labels: [], memories: [], preferredModelId: "gpt-4o" },
        version: 3,
      }),
    );
    const { useStore } = await import("@/lib/store/store");
    await useStore.persist.rehydrate();

    expect(useStore.getState().modelPreference).toBe("openai");
    const persisted = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "{}");
    expect(persisted.version).toBe(4);
    expect(persisted.state.modelPreference).toBe("openai");
    expect(persisted.state).not.toHaveProperty("preferredModelId");
  });

  it("falls back to the default preference for a v3 blob with an unknown model id", async () => {
    window.localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        state: { tasks: [], labels: [], memories: [], preferredModelId: "???" },
        version: 3,
      }),
    );
    const { useStore } = await import("@/lib/store/store");
    await useStore.persist.rehydrate();
    expect(useStore.getState().modelPreference).toBe("recommended");
  });
});

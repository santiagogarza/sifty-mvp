// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The browser side of the preference contract: Settings persists a
 * preference, `runTriage` must put exactly that on the wire as
 * `modelPreference`, and a pre-registry persisted blob migrates. These
 * import the real store, so a rename on either side fails here.
 */

const STORE_KEY = "sifty-store-v1";

const triageResponse = {
  output: {
    title: "Call the bank",
    description: null,
    nextAction: "Call during business hours",
    urgency: 0.6,
    importance: 0.5,
    effort: "quick",
    dueHint: null,
    delegationCandidate: "self",
    suggestedLabels: [],
    subtasks: [],
    rationale: null,
    confidence: 0.8,
    clarifyingQuestion: null,
  },
  task: null,
  labels: [],
};

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("runTriage request body", () => {
  it("sends the persisted preference as modelPreference and never a raw modelId", async () => {
    vi.useFakeTimers();
    const { registerSyncHooks, useStore } = await import("@/lib/store/store");
    const { runTriage } = await import("@/lib/ai/run-triage");

    registerSyncHooks({
      taskUpserted: () => {},
      taskDeleted: () => {},
      labelEnsured: () => {},
      memoryUpserted: () => {},
      memoryDeleted: () => {},
      waitForTask: async () => {},
      isTaskDirty: () => false,
    });

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(triageResponse), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    useStore.getState().setModelPreference("openai");
    const task = useStore.getState().createTask({ sourceText: "Call the bank tomorrow" });

    const run = runTriage(task.id);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/triage");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.taskId).toBe(task.id);
    expect(body.modelPreference).toBe("openai");
    expect(body).not.toHaveProperty("modelId");

    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.aiStatus).toBe("ready");
    expect(updated?.title).toBe("Call the bank");

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

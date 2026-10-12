// @vitest-environment jsdom
import { useDecisionsStore } from "@/lib/decisions/client";
import type { Decision } from "@/lib/domain/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The client cache's two guarantees: a resolved item never comes back from
 * a fetch that predates its resolution, and `refresh()` always answers with
 * a fetch started after the call (never a coalesced older one).
 */

vi.mock("@/lib/ai/run-triage", () => ({ watchSift: vi.fn() }));

function decision(id: string): Decision {
  return {
    id,
    kind: "clarifying_question",
    status: "open",
    taskId: `task_${id}`,
    payload: {
      kind: "clarifying_question",
      question: "?",
      options: [],
      siftId: "s",
      confidence: 0.4,
    },
    answer: null,
    resumeToken: null,
    createdAt: "2026-10-12T10:00:00.000Z",
    updatedAt: "2026-10-12T10:00:00.000Z",
    resolvedAt: null,
    expiresAt: null,
  };
}

type Deferred = { resolve: (res: Response) => void };
const pending: Deferred[] = [];
const fetchMock = vi.fn();

function listResponse(ids: string[]): Response {
  return new Response(
    JSON.stringify({ decisions: ids.map(decision), tasks: [], count: ids.length }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  pending.length = 0;
  fetchMock.mockReset().mockImplementation(
    (url: string, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        if (typeof url === "string" && url.startsWith("/api/decisions/") && init?.method) {
          resolve(new Response(JSON.stringify({ decision: {}, task: null, mode: "resumed" })));
          return;
        }
        pending.push({ resolve });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  useDecisionsStore.setState({ decisions: [], tasks: {}, count: 0, loaded: false, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDecisionsStore", () => {
  it("a fetch in flight when the user answers cannot put the answered item back", async () => {
    const store = useDecisionsStore.getState();
    const first = store.refresh();
    await Promise.resolve();
    pending[0]!.resolve(listResponse(["a", "b"]));
    await first;
    expect(useDecisionsStore.getState().count).toBe(2);

    // A background refresh starts, then the user answers "a" before it lands.
    const stale = store.refresh();
    await Promise.resolve();
    await store.answer("a", { text: "x", option: null });
    expect(useDecisionsStore.getState().decisions.map((d) => d.id)).toEqual(["b"]);
    pending[1]!.resolve(listResponse(["a", "b"]));
    await stale;
    expect(useDecisionsStore.getState().decisions.map((d) => d.id)).toEqual(["b"]);
    expect(useDecisionsStore.getState().count).toBe(1);

    // A fetch started after the answer is trusted again (server agrees).
    const fresh = store.refresh();
    await Promise.resolve();
    pending[2]!.resolve(listResponse(["b"]));
    await fresh;
    expect(useDecisionsStore.getState().decisions.map((d) => d.id)).toEqual(["b"]);
  });

  it("refresh() waits out an in-flight fetch and runs its own, reporting failure honestly", async () => {
    const store = useDecisionsStore.getState();
    const first = store.refresh();
    await Promise.resolve();
    const second = store.refresh();
    await Promise.resolve();
    // Only one request so far: the second call is queued behind the first.
    expect(pending).toHaveLength(1);
    pending[0]!.resolve(listResponse(["a"]));
    await first;
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.resolve(new Response("nope", { status: 500 }));
    await expect(second).resolves.toEqual({ ok: false });
    expect(useDecisionsStore.getState().error).toMatch(/500/);
    // The last good list is kept.
    expect(useDecisionsStore.getState().decisions.map((d) => d.id)).toEqual(["a"]);
  });
});

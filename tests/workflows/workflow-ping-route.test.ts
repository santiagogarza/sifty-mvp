import {
  type WorkflowClient,
  setWorkflowClientForTesting,
  startWorkflow,
  waitForRun,
} from "@/lib/workflows/dispatch";
import { pingWorkflow } from "@/lib/workflows/ping";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * The dispatch seam stands in for the Workflow world here: these tests
 * cover the route's gating and response contract, not the runtime (that
 * is exercised end-to-end by the Local World under `pnpm dev` / Playwright).
 */

const client = {
  start: vi.fn<WorkflowClient["start"]>(),
  wait: vi.fn<WorkflowClient["wait"]>(),
};

beforeEach(() => {
  vi.stubEnv("CREATOR_EMAIL", "s.gonzalez.garza@gmail.com");
  client.start.mockReset();
  client.wait.mockReset();
  setWorkflowClientForTesting(client);
});

afterEach(() => {
  setWorkflowClientForTesting(null);
});

async function post(cookie: string | null) {
  const { POST } = await import("@/app/api/admin/workflow-ping/route");
  return POST(
    new Request("http://localhost/api/admin/workflow-ping", {
      method: "POST",
      headers: cookie ? { cookie } : {},
    }),
  );
}

describe("POST /api/admin/workflow-ping", () => {
  it("is 401 signed out and 404 for non-creators (does not advertise itself)", async () => {
    expect((await post(null)).status).toBe(401);
    const { cookie } = await createUserWithCookie(getTestRepos(), {
      email: "member@example.com",
      isCreator: false,
    });
    expect((await post(cookie)).status).toBe(404);
    expect(client.start).not.toHaveBeenCalled();
  });

  it("starts pingWorkflow for the creator and reports the outcome", async () => {
    const { user, cookie } = await createUserWithCookie(getTestRepos(), {
      email: "s.gonzalez.garza@gmail.com",
      isCreator: true,
    });
    client.start.mockResolvedValue({ runId: "wrun_test" });
    client.wait.mockResolvedValue({
      status: "completed",
      value: { echo: "ping-x", startedAt: "a", finishedAt: "b" },
    });

    const res = await post(cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runId).toBe("wrun_test");
    expect(body.status).toBe("completed");
    expect(client.start).toHaveBeenCalledWith(pingWorkflow, [user.id, body.echo, 0]);
    expect(client.wait).toHaveBeenCalledWith("wrun_test", 20_000);
  });

  it("reports pending and failed outcomes as 200 with the run id", async () => {
    const { cookie } = await createUserWithCookie(getTestRepos(), {
      email: "s.gonzalez.garza@gmail.com",
      isCreator: true,
    });
    client.start.mockResolvedValue({ runId: "wrun_slow" });
    client.wait.mockResolvedValueOnce({ status: "pending" });
    const pending = await (await post(cookie)).json();
    expect(pending).toMatchObject({ runId: "wrun_slow", status: "pending" });

    client.wait.mockResolvedValueOnce({ status: "failed", error: "EROFS: read-only data dir" });
    const failed = await (await post(cookie)).json();
    expect(failed).toMatchObject({ status: "failed", error: "EROFS: read-only data dir" });
  });

  it("clamps ?hold= to 0…15000 ms and ignores garbage", async () => {
    const { user, cookie } = await createUserWithCookie(getTestRepos(), {
      email: "s.gonzalez.garza@gmail.com",
      isCreator: true,
    });
    client.start.mockResolvedValue({ runId: "wrun_hold" });
    client.wait.mockResolvedValue({ status: "pending" });
    const { POST } = await import("@/app/api/admin/workflow-ping/route");
    const fire = (query: string) =>
      POST(
        new Request(`http://localhost/api/admin/workflow-ping${query}`, {
          method: "POST",
          headers: { cookie },
        }),
      );
    for (const [query, hold] of [
      ["?hold=4000", 4000],
      ["?hold=20000", 15_000],
      ["?hold=-50", 0],
      ["?hold=nope", 0],
      ["", 0],
    ] as const) {
      client.start.mockClear();
      await fire(query);
      expect(client.start.mock.calls[0]![1]).toEqual([user.id, expect.any(String), hold]);
    }
  });

  it("answers 503 with the runtime's message when the run cannot start", async () => {
    const { cookie } = await createUserWithCookie(getTestRepos(), {
      email: "s.gonzalez.garza@gmail.com",
      isCreator: true,
    });
    client.start.mockRejectedValue(new Error("no world"));
    const res = await post(cookie);
    expect(res.status).toBe(503);
    expect((await res.json()).detail).toBe("no world");
  });
});

describe("workflow dispatch seam", () => {
  it("routes start/wait through the test client", async () => {
    client.start.mockResolvedValue({ runId: "wrun_1" });
    client.wait.mockResolvedValue({ status: "pending" });
    expect(await startWorkflow(pingWorkflow, ["u", "x", 0])).toEqual({ runId: "wrun_1" });
    expect(await waitForRun("wrun_1", 10)).toEqual({ status: "pending" });
  });

  it("calling a workflow function directly, without the runtime, fails at its first primitive", async () => {
    // Without the SWC transform the directives are no-ops: the body runs
    // inline and `createHook()` throws because there is no run context.
    // Routes must always go through `startWorkflow()`.
    await expect(pingWorkflow("u", "hello")).rejects.toThrow();
  });
});

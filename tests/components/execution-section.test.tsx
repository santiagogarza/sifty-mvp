// @vitest-environment jsdom
import { ExecutionSection } from "@/components/tasks/execution-section";
import { useToastStore } from "@/components/ui/toast";
import { EXECUTION_CHANGED_EVENT } from "@/lib/decisions/client";
import type { Execution, ExecutionStep, Task } from "@/lib/domain/types";
import { useExecutionsStore } from "@/lib/executions/client";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The task sheet's execution panel: one primary action with the policy
 * next to it, a live status card while Sifty works, a pointer into
 * Decisions while it waits, the result when it is done.
 */

const task: Task = {
  id: "task_x",
  sourceText: "Research the lease",
  sourceContext: null,
  title: "Research the lease",
  description: null,
  nextAction: "Read the current lease",
  lifecycle: "active",
  aiStatus: "ready",
  aiError: null,
  aiAttempts: 1,
  urgency: 0.5,
  importance: 0.6,
  priorityBucket: "schedule",
  effort: "medium",
  due: null,
  delegationCandidate: "ai",
  assigneeName: null,
  confidence: 0.8,
  clarifyingQuestion: null,
  rationale: null,
  agentBrief: null,
  siftId: "sift_x",
  siftStage: null,
  plan: null,
  siftedWithAssumptions: false,
  labelIds: [],
  subtasks: [],
  editedFields: [],
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  completedAt: null,
};

function execution(status: Execution["status"], extra: Partial<Execution> = {}): Execution {
  return {
    id: "exec_1",
    taskId: task.id,
    status,
    executor: "research",
    policy: "draft_then_approve",
    connector: null,
    idempotencyKey: "k",
    workflowRunId: "wrun_1",
    decisionId: null,
    reservedCents: 5,
    costCents: 0,
    result: null,
    answers: [],
    error: null,
    cancelReason: null,
    cancelRequested: false,
    createdAt: "2026-10-12T10:01:00.000Z",
    startedAt: "2026-10-12T10:01:01.000Z",
    finishedAt: null,
    updatedAt: "2026-10-12T10:01:01.000Z",
    ...extra,
  };
}

const step: ExecutionStep = {
  id: "exec_1:0",
  executionId: "exec_1",
  seq: 0,
  kind: "note",
  name: "research.gather",
  status: "ok",
  input: null,
  output: null,
  durationMs: 12,
  costCents: 0,
  createdAt: "2026-10-12T10:01:02.000Z",
};

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function routeFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = Object.keys(handlers).find((k) => url.includes(k));
    if (!key) return json({ error: `unmocked ${url}` }, 500);
    return handlers[key]!(init);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  useExecutionsStore.setState({ byTask: {} });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ExecutionSection", () => {
  it("offers Run now with the default policy explained, and starts an execution", async () => {
    const started = execution("queued");
    routeFetch({
      "/executions": () => json({ executions: [], steps: [] }),
      "/execution-policies": () => json({ policy: "draft_then_approve", saved: false }),
      "/execute": (init) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({ policy: "draft_then_approve" });
        return json({ execution: started, created: true }, 202);
      },
    });
    render(<ExecutionSection task={task} />);
    const run = await screen.findByTestId("execution-run");
    expect(run).toHaveTextContent("Run now");
    expect(screen.getByTestId("execution-policy")).toHaveValue("draft_then_approve");
    expect(screen.getByText(/Sifty works first and shows you the draft/)).toBeInTheDocument();

    await userEvent.click(run);
    await waitFor(() => expect(screen.getByTestId("execution-status")).toHaveTextContent("Queued"));
    expect(screen.getByTestId("execution-cancel")).toBeInTheDocument();
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
      "Sifty is on it. You'll find the draft in Decisions.",
    );
  });

  it("changing the policy saves it for the task and sends it with the run", async () => {
    const puts: unknown[] = [];
    routeFetch({
      "/executions": () => json({ executions: [], steps: [] }),
      "/execution-policies": (init) => {
        if (init?.method === "PUT") {
          puts.push(JSON.parse(String(init.body)));
          return json({ policy: { scope: "task", key: task.id, policy: "ask_first" } });
        }
        return json({ policy: "draft_then_approve", saved: false });
      },
      "/execute": (init) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({ policy: "ask_first" });
        return json(
          { execution: execution("queued", { policy: "ask_first" }), created: true },
          202,
        );
      },
    });
    render(<ExecutionSection task={task} />);
    const select = await screen.findByTestId("execution-policy");
    await userEvent.selectOptions(select, "ask_first");
    await waitFor(() =>
      expect(puts).toEqual([{ scope: "task", key: task.id, policy: "ask_first" }]),
    );
    expect(screen.getByText(/Saved for this task/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("execution-run"));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        "Sifty will ask before it starts — check Decisions.",
      ),
    );
  });

  it("a 402 explains the tier and points at plans; another error is a toast", async () => {
    let attempt = 0;
    routeFetch({
      "/executions": () => json({ executions: [], steps: [] }),
      "/execution-policies": () => json({ policy: "draft_then_approve", saved: false }),
      "/execute": () => {
        attempt += 1;
        return attempt === 1
          ? json(
              {
                error: "Letting Sifty work on tasks for you is part of Pro.",
                code: "execution_pro",
                execution: null,
              },
              402,
            )
          : json({ error: "Sifty is already working on this task.", code: "already_running" }, 409);
      },
    });
    render(<ExecutionSection task={task} />);
    await userEvent.click(await screen.findByTestId("execution-run"));
    const denied = await screen.findByTestId("execution-denied");
    expect(denied).toHaveTextContent("part of Pro");
    expect(screen.getByRole("link", { name: /See plans/ })).toHaveAttribute(
      "href",
      "/settings/billing",
    );
    await userEvent.click(screen.getByTestId("execution-run"));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        "Sifty is already working on this task.",
      ),
    );
  });

  it("while parked on a draft it links into Decisions; Stop cancels", async () => {
    const drafted = execution("drafted", { decisionId: "dec_d" });
    routeFetch({
      "/cancel": () =>
        json({ execution: execution("cancelled", { cancelReason: "user" }), immediate: true }),
      "/executions": () => json({ executions: [drafted], steps: [step] }),
      "/execution-policies": () => json({ policy: "draft_then_approve", saved: false }),
    });
    render(<ExecutionSection task={task} />);
    expect(await screen.findByTestId("execution-status")).toHaveTextContent("Draft ready");
    expect(screen.getByTestId("execution-review-link")).toHaveAttribute(
      "href",
      "/decisions?focus=dec_d",
    );
    expect(screen.queryByTestId("execution-run")).toBeNull();
    await userEvent.click(screen.getByTestId("execution-steps-toggle"));
    expect(screen.getByTestId("execution-steps")).toHaveTextContent("research.gather");
    await userEvent.click(screen.getByTestId("execution-cancel"));
    await waitFor(() =>
      expect(screen.getByTestId("execution-status")).toHaveTextContent("Cancelled"),
    );
    expect(screen.getByText("Stopped.")).toBeInTheDocument();
    expect(screen.getByTestId("execution-run")).toHaveTextContent("Run again");
  });

  it("shows the result when done, and refreshes when an answer elsewhere moves the execution", async () => {
    let calls = 0;
    routeFetch({
      "/executions": () => {
        calls += 1;
        return json({
          executions: [
            calls === 1
              ? execution("needs_approval", { decisionId: "dec_a" })
              : execution("done", {
                  finishedAt: "2026-10-12T10:05:00.000Z",
                  result: {
                    summary: "Research notes for “Research the lease”",
                    draft: {
                      title: "Research notes",
                      body: "- Read the current lease",
                      format: "markdown",
                    },
                  },
                }),
          ],
          steps: [step],
        });
      },
      "/execution-policies": () => json({ policy: "draft_then_approve", saved: false }),
    });
    render(<ExecutionSection task={task} />);
    expect(await screen.findByTestId("execution-status")).toHaveTextContent(
      "Waiting for your go-ahead",
    );
    expect(screen.getByTestId("execution-review-link")).toHaveTextContent("Answer in Decisions");

    window.dispatchEvent(
      new CustomEvent(EXECUTION_CHANGED_EVENT, {
        detail: { taskId: task.id, executionId: "exec_1" },
      }),
    );
    await waitFor(() => expect(screen.getByTestId("execution-status")).toHaveTextContent("Done"));
    expect(screen.getByTestId("execution-result")).toHaveTextContent("Read the current lease");
    expect(screen.getByText("Research notes for “Research the lease”")).toBeInTheDocument();
  });
});

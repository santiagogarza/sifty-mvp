// @vitest-environment jsdom
import { DailyPlanCard } from "@/components/tasks/daily-plan-card";
import { useToastStore } from "@/components/ui/toast";
import type { PublicDailyPlan } from "@/lib/ai/plan/public";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The daily plan card above Today: what it shows, hides, and does on Re-plan. */

const openDetail = vi.fn();
vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail, openCapture: vi.fn(), openCommand: vi.fn(), serverReady: true }),
}));
const syncFromServer = vi.fn(async () => ({ authenticated: true, error: null }));
vi.mock("@/lib/store/sync", () => ({ syncFromServer: () => syncFromServer() }));

function task(id: string, title: string): Task {
  return {
    id,
    sourceText: title,
    sourceContext: null,
    title,
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "schedule",
    effort: "small",
    due: null,
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    siftId: null,
    siftStage: null,
    plan: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-10-12T10:00:00.000Z",
    updatedAt: "2026-10-12T10:00:00.000Z",
    completedAt: null,
  };
}

function plan(overrides: Partial<PublicDailyPlan> = {}): PublicDailyPlan {
  return {
    id: "plan_1",
    planDate: "2026-10-12",
    timezone: "UTC",
    trigger: "cron",
    status: "completed",
    summary: "Lead with the deck.",
    moves: [{ taskId: "task_deck", title: "Deck", kind: "moved_in", reason: "due tomorrow" }],
    considered: 9,
    error: null,
    createdAt: "2026-10-12T04:00:00.000Z",
    finishedAt: "2026-10-12T04:00:05.000Z",
    ...overrides,
  };
}

type PlanResponse = { plan: PublicDailyPlan | null; running: boolean; canReplan: boolean };
let responses: PlanResponse[] = [];
const fetchMock = vi.fn();

beforeEach(() => {
  openDetail.mockReset();
  syncFromServer.mockClear();
  responses = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/plan/replan") {
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          plan: plan({
            id: "plan_2",
            status: "running",
            trigger: "manual",
            timezone: body.timeZone,
          }),
        }),
        { status: 202 },
      );
    }
    const next = responses.length > 1 ? responses.shift()! : responses[0]!;
    return new Response(JSON.stringify(next), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  useStore.setState({ tasks: [task("task_deck", "Deck")], hydrated: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("DailyPlanCard", () => {
  it("renders nothing for an account that cannot plan and has no plan", async () => {
    responses = [{ plan: null, running: false, canReplan: false }];
    render(<DailyPlanCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("daily-plan-card")).toBeNull();
  });

  it("shows the summary, the moves with their explanation, and the footer", async () => {
    responses = [{ plan: plan(), running: false, canReplan: true }];
    render(<DailyPlanCard />);
    expect(await screen.findByText("Lead with the deck.")).toBeInTheDocument();
    expect(screen.getByText("Deck")).toBeInTheDocument();
    expect(screen.getByText(/Moved into Today: due tomorrow/)).toBeInTheDocument();
    expect(screen.getByText(/1 move · 9 open tasks considered/)).toBeInTheDocument();
    expect(screen.getByTestId("replan-today")).toBeEnabled();
  });

  it("a move opens its task; a move whose task is gone is inert; long lists fold", async () => {
    const moves = Array.from({ length: 7 }, (_, i) => ({
      taskId: i === 0 ? "task_deck" : `task_gone_${i}`,
      title: i === 0 ? "Deck" : `Gone ${i}`,
      kind: "rescored" as const,
      reason: `reason ${i}`,
    }));
    responses = [{ plan: plan({ moves }), running: false, canReplan: false }];
    render(<DailyPlanCard />);
    await userEvent.click(await screen.findByRole("button", { name: "Deck" }));
    expect(openDetail).toHaveBeenCalledWith("task_deck");
    expect(screen.getByRole("button", { name: "Gone 1" })).toBeDisabled();
    expect(screen.queryByText("Gone 6")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "and 2 more" }));
    expect(screen.getByText("Gone 6")).toBeInTheDocument();
    // No Re-plan button without the entitlement, even with a plan to show.
    expect(screen.queryByTestId("replan-today")).toBeNull();
  });

  it("a failed plan shows its error and when it was attempted", async () => {
    responses = [
      {
        plan: plan({ status: "failed", error: "Planning failed — try again.", moves: [] }),
        running: false,
        canReplan: true,
      },
    ];
    render(<DailyPlanCard />);
    expect(await screen.findByText("Planning failed — try again.")).toBeInTheDocument();
    expect(screen.getByText(/^Attempted /)).toBeInTheDocument();
  });

  it("Re-plan today posts the browser zone, polls while running, then pulls the workspace", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    responses = [
      { plan: plan(), running: false, canReplan: true },
      { plan: plan({ id: "plan_2", status: "running" }), running: true, canReplan: true },
      {
        plan: plan({ id: "plan_2", status: "completed", summary: "New day, new plan.", moves: [] }),
        running: false,
        canReplan: true,
      },
    ];
    render(<DailyPlanCard />);
    const button = await screen.findByTestId("replan-today");
    await userEvent.click(button);

    const post = fetchMock.mock.calls.find((c) => c[0] === "/api/plan/replan")!;
    expect(JSON.parse(String(post[1].body)).timeZone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(screen.getByText("Sifty is planning your day…")).toBeInTheDocument();
    expect(screen.getByTestId("replan-today")).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    await waitFor(() => expect(screen.getByText("New day, new plan.")).toBeInTheDocument());
    expect(syncFromServer).toHaveBeenCalled();
    expect(screen.getByTestId("replan-today")).toBeEnabled();
    expect(screen.getByText(/nothing moved/)).toBeInTheDocument();
  });

  it("a refused re-plan surfaces the server's message", async () => {
    responses = [{ plan: null, running: false, canReplan: true }];
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/plan/replan") {
        return new Response(
          JSON.stringify({
            error: "You've hit today's fair-use limit for sifting. It resets tomorrow.",
          }),
          {
            status: 402,
          },
        );
      }
      return new Response(JSON.stringify(responses[0]), { status: 200 });
    });
    useToastStore.setState({ toasts: [] });
    render(<DailyPlanCard />);
    await userEvent.click(await screen.findByTestId("replan-today"));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
        "You've hit today's fair-use limit for sifting. It resets tomorrow.",
      ]),
    );
    expect(screen.getByTestId("replan-today")).toBeEnabled();
  });
});

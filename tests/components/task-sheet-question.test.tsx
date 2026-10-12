// @vitest-environment jsdom
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { useDecisionsStore } from "@/lib/decisions/client";
import type { Decision, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The clarifying question on the task sheet. The one path that matters is
 * "answer through the open decision" (resumes the sift that asked); the
 * append-and-re-sift fallback exists only for tasks that predate decisions
 * and must never fire just because the cache has not loaded yet.
 */

vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail: vi.fn(), openCapture: vi.fn(), openCommand: vi.fn() }),
}));
const resiftTask = vi.fn();
vi.mock("@/lib/ai/run-triage", () => ({
  resiftTask: (id: string) => resiftTask(id),
  watchSift: vi.fn(),
  isTriageInFlight: () => false,
}));

const task: Task = {
  id: "task_q",
  sourceText: "Taxes",
  sourceContext: null,
  title: "Taxes",
  description: null,
  nextAction: null,
  lifecycle: "inbox",
  aiStatus: "ready",
  aiError: null,
  aiAttempts: 1,
  urgency: 0.4,
  importance: 0.4,
  priorityBucket: "unset",
  effort: "small",
  due: null,
  delegationCandidate: "self",
  assigneeName: null,
  confidence: 0.4,
  clarifyingQuestion: "What outcome would mark this as done?",
  rationale: null,
  agentBrief: null,
  siftId: "sift_q",
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

const decision: Decision = {
  id: "dec_q",
  kind: "clarifying_question",
  status: "open",
  taskId: task.id,
  payload: {
    kind: "clarifying_question",
    question: task.clarifyingQuestion!,
    options: ["A decision", "Something sent"],
    siftId: "sift_q",
    confidence: 0.4,
  },
  answer: null,
  resumeToken: "decision:dec_q",
  createdAt: "2026-10-12T10:00:05.000Z",
  updatedAt: "2026-10-12T10:00:05.000Z",
  resolvedAt: null,
  expiresAt: null,
};

const answer = vi.fn();
const dismiss = vi.fn();
const refresh = vi.fn();

beforeEach(() => {
  resiftTask.mockReset();
  answer.mockReset().mockResolvedValue({ ok: true, mode: "resumed" });
  dismiss.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset().mockResolvedValue(undefined);
  useStore.setState({ tasks: [task], labels: [] });
  useDecisionsStore.setState({
    decisions: [decision],
    tasks: {},
    count: 1,
    answer,
    dismiss,
    refresh,
  });
});

afterEach(() => cleanup());

describe("TaskDetailSheet clarifying question", () => {
  it("answers through the open decision, options included, and never re-sifts", async () => {
    render(<TaskDetailSheet taskId={task.id} onClose={vi.fn()} />);
    const block = screen.getByTestId("clarifying-question");
    expect(block).toHaveTextContent("What outcome would mark this as done?");
    await userEvent.click(screen.getByRole("button", { name: "Something sent" }));
    expect(answer).toHaveBeenCalledWith("dec_q", { text: null, option: "Something sent" });
    expect(resiftTask).not.toHaveBeenCalled();
    expect(useStore.getState().tasks[0]!.sourceContext).toBeNull();

    await userEvent.type(screen.getByPlaceholderText(/your own words/), "By June{enter}");
    expect(answer).toHaveBeenLastCalledWith("dec_q", { text: "By June", option: null });
  });

  it("'Let Sifty decide' dismisses the decision", async () => {
    render(<TaskDetailSheet taskId={task.id} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Let Sifty decide" }));
    expect(dismiss).toHaveBeenCalledWith("dec_q");
    expect(resiftTask).not.toHaveBeenCalled();
  });

  it("stays hidden while the sift is still running, so a reply cannot race the run", () => {
    useStore.setState({ tasks: [{ ...task, aiStatus: "running", siftStage: "subtasks" }] });
    render(<TaskDetailSheet taskId={task.id} onClose={vi.fn()} />);
    expect(screen.queryByTestId("clarifying-question")).toBeNull();
  });

  it("with no decision in the cache it fetches first, then falls back to append-and-re-sift", async () => {
    useDecisionsStore.setState({ decisions: [], count: 0 });
    let release!: () => void;
    refresh.mockReturnValue(
      new Promise<void>((r) => {
        release = r;
      }),
    );
    render(<TaskDetailSheet taskId={task.id} onClose={vi.fn()} />);
    expect(refresh).toHaveBeenCalledTimes(1);
    const input = screen.getByPlaceholderText("Answer briefly…");
    const reply = screen.getByRole("button", { name: "Reply" });
    // Until the fetch answers, nothing can be submitted.
    await userEvent.type(input, "File the federal return");
    expect(reply).toBeDisabled();
    expect(resiftTask).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(reply).toBeEnabled());
    await userEvent.click(reply);
    expect(resiftTask).toHaveBeenCalledWith(task.id);
    const updated = useStore.getState().tasks[0]!;
    expect(updated.sourceContext).toBe("Answer: File the federal return");
    expect(updated.clarifyingQuestion).toBeNull();
    expect(answer).not.toHaveBeenCalled();
  });

  it("the legacy fallback for 'Let Sifty decide' just clears the question", async () => {
    useDecisionsStore.setState({ decisions: [], count: 0 });
    render(<TaskDetailSheet taskId={task.id} onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Let Sifty decide" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    expect(dismiss).not.toHaveBeenCalled();
    expect(useStore.getState().tasks[0]!.clarifyingQuestion).toBeNull();
    expect(useStore.getState().tasks[0]!.siftedWithAssumptions).toBe(false);
  });

  it("shows the assumptions note with a re-sift link after a dismissed question", async () => {
    useStore.setState({
      tasks: [{ ...task, clarifyingQuestion: null, siftedWithAssumptions: true }],
    });
    render(<TaskDetailSheet taskId={task.id} onClose={vi.fn()} />);
    const note = screen.getByTestId("sifted-with-assumptions");
    expect(note).toHaveTextContent("Sifted on Sifty's own assumptions");
    await userEvent.click(screen.getByRole("button", { name: "Re-sift" }));
    expect(resiftTask).toHaveBeenCalledWith(task.id);
  });
});

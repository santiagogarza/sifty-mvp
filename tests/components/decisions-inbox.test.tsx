// @vitest-environment jsdom
import { DecisionsEmptyState } from "@/components/decisions/decisions-empty-state";
import { DecisionsInbox } from "@/components/decisions/decisions-inbox";
import { useToastStore } from "@/components/ui/toast";
import { useDecisionsStore } from "@/lib/decisions/client";
import type { Decision } from "@/lib/domain/types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openDetail = vi.fn();
vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail, openCapture: vi.fn(), openCommand: vi.fn(), serverReady: true }),
}));
vi.mock("@/lib/ai/run-triage", () => ({ watchSift: vi.fn() }));

function decision(id: string, question: string, options: string[], taskId: string): Decision {
  return {
    id,
    kind: "clarifying_question",
    status: "open",
    taskId,
    payload: { kind: "clarifying_question", question, options, siftId: "sift_1", confidence: 0.4 },
    answer: null,
    resumeToken: `decision:${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolvedAt: null,
    expiresAt: null,
  };
}

const DECISIONS = [
  decision("dec_new", "Which year?", ["2025", "2026"], "task_a"),
  decision("dec_old", "Is there a deadline?", [], "task_b"),
];
const TASKS = {
  task_a: { id: "task_a", title: "Taxes", sourceText: "Taxes", lifecycle: "inbox" as const },
  task_b: { id: "task_b", title: "Call Ana", sourceText: "Call Ana", lifecycle: "inbox" as const },
};

const answer = vi.fn();
const dismiss = vi.fn();

beforeEach(() => {
  answer.mockReset().mockResolvedValue({ ok: true, mode: "resumed" });
  dismiss.mockReset().mockResolvedValue({ ok: true });
  useDecisionsStore.setState({ decisions: DECISIONS, tasks: TASKS, count: 2, answer, dismiss });
});

afterEach(() => {
  cleanup();
});

function renderInbox(focusId?: string) {
  return render(
    <DecisionsInbox
      decisions={DECISIONS}
      tasks={TASKS}
      focusId={focusId}
      emptyState={<DecisionsEmptyState />}
    />,
  );
}

describe("DecisionsInbox", () => {
  it("renders one card per open decision with its task, question, and options", () => {
    renderInbox();
    const cards = screen.getAllByTestId("decision-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Taxes");
    expect(cards[0]).toHaveTextContent("Which year?");
    expect(screen.getByRole("button", { name: /^2026/ })).toBeInTheDocument();
    expect(cards[1]).toHaveTextContent("Is there a deadline?");
    // The first card is active and focusable; the rest are reachable by key.
    expect(cards[0]).toHaveAttribute("aria-selected", "true");
    expect(cards[0]).toHaveAttribute("tabindex", "0");
    expect(cards[1]).toHaveAttribute("tabindex", "-1");
  });

  it("tapping an option answers with it", async () => {
    renderInbox();
    await userEvent.click(screen.getByRole("button", { name: /^2026/ }));
    expect(answer).toHaveBeenCalledWith("dec_new", { text: null, option: "2026", draft: null });
  });

  it("typing an answer and pressing Enter submits free text", async () => {
    renderInbox();
    const inputs = screen.getAllByLabelText("Your answer");
    await userEvent.type(inputs[1]!, "Next Friday{enter}");
    expect(answer).toHaveBeenCalledWith("dec_old", {
      text: "Next Friday",
      option: null,
      draft: null,
    });
  });

  it("j/k move the active card, Enter focuses its answer field, Esc returns to the card", async () => {
    renderInbox();
    const list = screen.getByRole("listbox", { name: "Decisions" });
    const cards = screen.getAllByTestId("decision-card");
    list.focus();
    fireEvent.keyDown(list, { key: "j" });
    await waitFor(() => expect(cards[1]).toHaveAttribute("aria-selected", "true"));
    expect(document.activeElement).toBe(cards[1]);
    fireEvent.keyDown(list, { key: "k" });
    await waitFor(() => expect(cards[0]).toHaveAttribute("aria-selected", "true"));

    fireEvent.keyDown(list, { key: "Enter" });
    const inputs = screen.getAllByLabelText("Your answer");
    expect(document.activeElement).toBe(inputs[0]);
    // Keys typed in the field are never navigation.
    fireEvent.keyDown(inputs[0]!, { key: "j" });
    expect(cards[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(inputs[0]!, { key: "Escape" });
    expect(document.activeElement).toBe(cards[0]);
  });

  it("number keys pick an option and d dismisses the active card", async () => {
    renderInbox();
    const list = screen.getByRole("listbox", { name: "Decisions" });
    list.focus();
    fireEvent.keyDown(list, { key: "2" });
    expect(answer).toHaveBeenCalledWith("dec_new", { text: null, option: "2026", draft: null });
    // A number with no option behind it does nothing.
    fireEvent.keyDown(list, { key: "4" });
    expect(answer).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(list, { key: "j" });
    await waitFor(() =>
      expect(screen.getAllByTestId("decision-card")[1]).toHaveAttribute("aria-selected", "true"),
    );
    fireEvent.keyDown(list, { key: "d" });
    expect(dismiss).toHaveBeenCalledWith("dec_old");
  });

  it("the task title opens the task's detail sheet", async () => {
    renderInbox();
    await userEvent.click(screen.getByRole("button", { name: /Taxes/ }));
    expect(openDetail).toHaveBeenCalledWith("task_a");
  });

  it("a deep-linked decision starts active", () => {
    renderInbox("dec_old");
    const cards = screen.getAllByTestId("decision-card");
    expect(cards[1]).toHaveAttribute("aria-selected", "true");
  });

  it("a memory proposal renders as 'Remember this?' with Remember / Not this, and 1 confirms it", async () => {
    const proposal: Decision = {
      id: "dec_mem",
      kind: "memory_proposal",
      status: "open",
      taskId: "task_a",
      payload: {
        kind: "memory_proposal",
        text: "Ana = accountant",
        memoryKind: "fact",
        rationale: "Ana, my accountant",
      },
      answer: null,
      resumeToken: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resolvedAt: null,
      expiresAt: null,
    };
    answer.mockResolvedValue({ ok: true, mode: "remembered" });
    useDecisionsStore.setState({ decisions: [proposal], tasks: TASKS, count: 1, answer, dismiss });
    render(
      <DecisionsInbox
        decisions={[proposal]}
        tasks={TASKS}
        focusId="dec_mem"
        emptyState={<DecisionsEmptyState />}
      />,
    );
    const card = screen.getByTestId("decision-card");
    expect(card).toHaveTextContent("Remember this?");
    expect(screen.getByTestId("memory-proposal-text")).toHaveTextContent("Ana = accountant");
    expect(card).toHaveTextContent("From: “Ana, my accountant”");
    // No free-text answer box for a proposal.
    expect(screen.queryByLabelText("Your answer")).toBeNull();
    // Attached to a task here, so the title opens it; detached proposals disable it.
    expect(screen.getByRole("button", { name: /Taxes/ })).toBeEnabled();

    await userEvent.click(screen.getByTestId("memory-proposal-remember"));
    expect(answer).toHaveBeenCalledWith("dec_mem", { text: null, option: "Remember", draft: null });
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
      "Remembered — Sifty will use it from the next sift on.",
    );

    await userEvent.click(screen.getByTestId("memory-proposal-dismiss"));
    expect(dismiss).toHaveBeenCalledWith("dec_mem");
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
      "Noted — Sifty won't suggest that again.",
    );
  });

  it("a proposal without a task has an inert, disabled title", () => {
    const proposal: Decision = {
      id: "dec_mem2",
      kind: "memory_proposal",
      status: "open",
      taskId: null,
      payload: {
        kind: "memory_proposal",
        text: "Jure = lawyer",
        memoryKind: "fact",
        rationale: null,
      },
      answer: null,
      resumeToken: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resolvedAt: null,
      expiresAt: null,
    };
    useDecisionsStore.setState({ decisions: [proposal], tasks: {}, count: 1, answer, dismiss });
    render(
      <DecisionsInbox decisions={[proposal]} tasks={{}} emptyState={<DecisionsEmptyState />} />,
    );
    expect(screen.getByRole("button", { name: /Something Sifty noticed/ })).toBeDisabled();
    expect(screen.queryByText(/From:/)).toBeNull();
  });

  it("shows the empty state that explains what lands here", () => {
    render(<DecisionsInbox decisions={[]} tasks={{}} emptyState={<DecisionsEmptyState />} />);
    expect(screen.getByTestId("decisions-empty")).toHaveTextContent("Nothing waiting on you.");
    expect(screen.getByTestId("decisions-empty")).toHaveTextContent("Clarifying questions");
    expect(screen.getByTestId("decisions-empty")).toHaveTextContent("Memory suggestions");
    expect(screen.getByTestId("decisions-empty")).toHaveTextContent("Approvals");
  });
});

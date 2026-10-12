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

function base(id: string, taskId: string): Omit<Decision, "kind" | "payload"> {
  return {
    id,
    status: "open",
    taskId,
    answer: null,
    resumeToken: `decision:${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolvedAt: null,
    expiresAt: null,
  };
}

const approval: Decision = {
  ...base("dec_gate", "task_a"),
  kind: "approval",
  payload: {
    kind: "approval",
    executionId: "exec_1",
    executor: "research",
    action: "Research “Lease renewal” and write up notes",
    question: "Research “Lease renewal” and write up notes?",
    options: ["Approve", "Reject"],
    reason: "ask_first",
    estimateCents: 5,
  },
};

const question: Decision = {
  ...base("dec_q", "task_a"),
  kind: "approval",
  payload: {
    kind: "approval",
    executionId: "exec_1",
    executor: "research",
    action: "Research it",
    question: "Which lease?",
    options: ["Office", "Warehouse"],
    reason: "question",
    estimateCents: 0,
  },
};

const review: Decision = {
  ...base("dec_draft", "task_b"),
  kind: "draft_review",
  payload: {
    kind: "draft_review",
    executionId: "exec_2",
    executor: "research",
    summary: "Research notes for “Vendor contract”",
    draft: {
      title: "Research notes: Vendor contract",
      body: "# Notes\n\n- Call Ana\n- Read the lease",
      format: "markdown",
    },
  },
};

const TASKS = {
  task_a: {
    id: "task_a",
    title: "Lease renewal",
    sourceText: "Lease",
    lifecycle: "inbox" as const,
  },
  task_b: {
    id: "task_b",
    title: "Vendor contract",
    sourceText: "Vendor",
    lifecycle: "inbox" as const,
  },
};

const answer = vi.fn();
const dismiss = vi.fn();
const approveMany = vi.fn();

function renderInbox(decisions: Decision[]) {
  useDecisionsStore.setState({
    decisions,
    tasks: TASKS,
    count: decisions.length,
    answer,
    dismiss,
    approveMany,
  });
  return render(
    <DecisionsInbox decisions={decisions} tasks={TASKS} emptyState={<DecisionsEmptyState />} />,
  );
}

beforeEach(() => {
  answer.mockReset().mockResolvedValue({
    ok: true,
    mode: "execution",
    execution: { execution: null, mode: "accepted" },
  });
  dismiss.mockReset().mockResolvedValue({ ok: true });
  approveMany.mockReset().mockImplementation(async (ids: string[]) =>
    ids.map((id) => ({
      id,
      result: { ok: true, mode: "execution", execution: { execution: null, mode: "accepted" } },
    })),
  );
  useToastStore.setState({ toasts: [] });
});

afterEach(() => cleanup());

describe("approval cards", () => {
  it("an ask_first gate shows what Sifty wants to do with Approve as the one primary action", async () => {
    renderInbox([approval]);
    const card = screen.getByTestId("decision-card");
    expect(card).toHaveAttribute("data-decision-kind", "approval");
    expect(card).toHaveTextContent("Sifty wants to");
    expect(screen.getByTestId("approval-question")).toHaveTextContent(
      "Research “Lease renewal” and write up notes",
    );
    expect(card).toHaveTextContent("Estimated $0.05");
    expect(screen.queryByRole("textbox")).toBeNull();

    await userEvent.click(screen.getByTestId("approval-approve"));
    expect(answer).toHaveBeenCalledWith("dec_gate", { text: null, option: "Approve", draft: null });
    answer.mockResolvedValueOnce({
      ok: true,
      mode: "execution",
      execution: { execution: null, mode: "approved" },
    });
  });

  it("Reject dismisses (the server treats it as a rejection) and the toast says so", async () => {
    renderInbox([approval]);
    await userEvent.click(screen.getByTestId("approval-reject"));
    expect(dismiss).toHaveBeenCalledWith("dec_gate");
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        "Rejected — Sifty stopped on “Lease renewal”.",
      ),
    );
  });

  it("keys: 1 approves, 2 rejects, d rejects", async () => {
    renderInbox([approval]);
    const list = screen.getByRole("listbox", { name: "Decisions" });
    list.focus();
    fireEvent.keyDown(list, { key: "1" });
    expect(answer).toHaveBeenCalledWith("dec_gate", { text: null, option: "Approve", draft: null });
    // The card is busy until the answer settles; a key pressed meanwhile is ignored.
    fireEvent.keyDown(list, { key: "2" });
    expect(dismiss).not.toHaveBeenCalled();
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    fireEvent.keyDown(list, { key: "2" });
    expect(dismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(2));
    fireEvent.keyDown(list, { key: "d" });
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it("an executor question renders its options and free text, and 'Stop this' rejects", async () => {
    renderInbox([question]);
    expect(screen.getByTestId("decision-card")).toHaveTextContent("Research asks");
    expect(screen.getByTestId("approval-question")).toHaveTextContent("Which lease?");
    await userEvent.click(screen.getByRole("button", { name: /^Warehouse/ }));
    expect(answer).toHaveBeenCalledWith("dec_q", { text: null, option: "Warehouse", draft: null });
    const input = screen.getByRole("textbox", { name: "Your answer" });
    await userEvent.type(input, "The one downtown{Enter}");
    expect(answer).toHaveBeenCalledWith("dec_q", {
      text: "The one downtown",
      option: null,
      draft: null,
    });
    await userEvent.click(screen.getByRole("button", { name: "Stop this" }));
    expect(dismiss).toHaveBeenCalledWith("dec_q");
  });
});

describe("draft review cards", () => {
  it("shows the draft and approves it as written", async () => {
    renderInbox([review]);
    const card = screen.getByTestId("decision-card");
    expect(card).toHaveAttribute("data-decision-kind", "draft_review");
    expect(screen.getByTestId("draft-summary")).toHaveTextContent(
      "Research notes for “Vendor contract”",
    );
    expect(screen.getByTestId("draft-body")).toHaveTextContent("Call Ana");
    await userEvent.click(screen.getByTestId("draft-approve"));
    expect(answer).toHaveBeenCalledWith("dec_draft", {
      text: null,
      option: "Approve",
      draft: null,
    });
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        "Approved — “Vendor contract” is done",
      ),
    );
  });

  it("edit shows a diff of the changes and approves with the edited draft", async () => {
    answer.mockResolvedValue({
      ok: true,
      mode: "execution",
      execution: { execution: null, mode: "edited" },
    });
    renderInbox([review]);
    await userEvent.click(screen.getByTestId("draft-edit"));
    const body = screen.getByRole("textbox", { name: "Draft body" });
    expect(body).toHaveValue("# Notes\n\n- Call Ana\n- Read the lease");
    expect(screen.getByText("No changes yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve as is/ })).toBeInTheDocument();

    await userEvent.clear(body);
    await userEvent.type(body, "# Notes{Enter}{Enter}- Call the landlord{Enter}- Read the lease");
    const diff = screen.getByTestId("draft-diff");
    expect(diff).toHaveTextContent("- Call Ana");
    expect(diff).toHaveTextContent("- Call the landlord");
    expect(diff).toHaveTextContent("- Read the lease");
    expect(screen.getByText(/Your changes/)).toHaveTextContent("+1");
    expect(screen.getByText(/Your changes/)).toHaveTextContent("−1");

    await userEvent.click(screen.getByTestId("draft-approve-edits"));
    expect(answer).toHaveBeenCalledWith("dec_draft", {
      text: null,
      option: "Approve",
      draft: {
        title: "Research notes: Vendor contract",
        body: "# Notes\n\n- Call the landlord\n- Read the lease",
        format: "markdown",
      },
    });
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        "Approved with your edits — “Vendor contract” is done",
      ),
    );
  });

  it("discarding edits restores the draft; Reject dismisses", async () => {
    renderInbox([review]);
    await userEvent.click(screen.getByTestId("draft-edit"));
    const body = screen.getByRole("textbox", { name: "Draft body" });
    await userEvent.type(body, " more");
    await userEvent.click(screen.getByRole("button", { name: "Discard edits" }));
    expect(screen.queryByTestId("draft-editor")).toBeNull();
    expect(screen.getByTestId("draft-body")).toHaveTextContent("Read the lease");
    await userEvent.click(screen.getByTestId("draft-reject"));
    expect(dismiss).toHaveBeenCalledWith("dec_draft");
  });

  it("e and Enter open the editor; a long draft starts collapsed", async () => {
    const long: Decision = {
      ...review,
      id: "dec_long",
      payload: {
        ...review.payload,
        draft: {
          ...(review.payload as Extract<Decision["payload"], { kind: "draft_review" }>).draft,
          body: Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n"),
        },
      } as Decision["payload"],
    };
    renderInbox([long]);
    expect(screen.getByTestId("draft-body")).not.toHaveTextContent("line 20");
    await userEvent.click(screen.getByRole("button", { name: /Show the full draft/ }));
    expect(screen.getByTestId("draft-body")).toHaveTextContent("line 20");
    const list = screen.getByRole("listbox", { name: "Decisions" });
    list.focus();
    fireEvent.keyDown(list, { key: "e" });
    await waitFor(() => expect(screen.getByTestId("draft-editor")).toBeInTheDocument());
  });
});

describe("batch approve", () => {
  it("appears with two or more approvable items, selects with x or the checkbox, and needs a confirming click", async () => {
    renderInbox([approval, review, question]);
    const bar = screen.getByTestId("batch-bar");
    expect(bar).toHaveTextContent("2 items can be approved together");
    // The executor question is not batch-approvable: no checkbox on it.
    expect(screen.getAllByTestId("decision-select")).toHaveLength(2);

    const list = screen.getByRole("listbox", { name: "Decisions" });
    list.focus();
    fireEvent.keyDown(list, { key: "x" });
    expect(bar).toHaveTextContent("1 of 2 selected");
    await userEvent.click(screen.getAllByTestId("decision-select")[1]!);
    expect(bar).toHaveTextContent("2 of 2 selected");

    const approve = screen.getByTestId("batch-approve");
    expect(approve).toHaveTextContent("Approve 2");
    await userEvent.click(approve);
    expect(approveMany).not.toHaveBeenCalled();
    expect(approve).toHaveTextContent("Confirm: approve 2");
    await userEvent.click(approve);
    expect(approveMany).toHaveBeenCalledWith(["dec_gate", "dec_draft"]);
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Approved 2 items."),
    );
  });

  it("select all / clear, and a partial failure is reported honestly", async () => {
    approveMany.mockResolvedValueOnce([
      { id: "dec_gate", result: { ok: true, mode: "execution", execution: null } },
      { id: "dec_draft", result: { ok: false, error: "Already resolved" } },
    ]);
    renderInbox([approval, review]);
    await userEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByTestId("batch-bar")).toHaveTextContent("2 of 2 selected");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("batch-bar")).toHaveTextContent("2 items can be approved together");
    await userEvent.click(screen.getByRole("button", { name: "Select all" }));
    const approve = screen.getByTestId("batch-approve");
    await userEvent.click(approve);
    await userEvent.click(approve);
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        "Approved 1; 1 could not be approved and is still open.",
      ),
    );
  });

  it("does not appear for a single approvable item", () => {
    renderInbox([approval, question]);
    expect(screen.queryByTestId("batch-bar")).toBeNull();
    expect(screen.queryAllByTestId("decision-select")).toHaveLength(0);
  });
});

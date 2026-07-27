// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board/board-view";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-07-22T12:00:00.000Z";

function makeTask(id: string, title: string, lifecycle: Task["lifecycle"]): Task {
  return {
    id,
    sourceText: title,
    sourceContext: null,
    title,
    description: null,
    nextAction: "Next action",
    lifecycle,
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
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
}

afterEach(() => {
  useStore.setState({ tasks: [], labels: [], hydrated: true });
});

describe("BoardView keyboard model", () => {
  it("files with Shift+Right, keeps DOM focus on the moved card, and announces the move", async () => {
    const open = vi.fn();
    const task = makeTask("task_inbox", "Inbox card", "inbox");
    useStore.setState({ tasks: [task], labels: [], hydrated: true });

    render(<BoardView tasks={[task]} onOpen={open} />);

    const card = await screen.findByRole("option", { name: /Inbox card/i });
    await waitFor(() => expect(card).toHaveFocus());

    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });

    expect(useStore.getState().tasks.find((candidate) => candidate.id === task.id)?.lifecycle).toBe(
      "active",
    );
    await waitFor(() => expect(screen.getByRole("option", { name: /Inbox card/i })).toHaveFocus());
    expect(
      within(screen.getByRole("listbox", { name: /Focus tasks/i })).getByRole("option", {
        name: /Inbox card/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Inbox card moved to Focus.")).toBeInTheDocument();
  });

  it("uses j/k within a column and left/right across columns", async () => {
    const tasks = [
      makeTask("task_inbox_1", "Inbox one", "inbox"),
      makeTask("task_inbox_2", "Inbox two", "inbox"),
      makeTask("task_focus_1", "Focus one", "active"),
    ];
    useStore.setState({ tasks, labels: [], hydrated: true });

    render(<BoardView tasks={tasks} onOpen={vi.fn()} />);

    const first = await screen.findByRole("option", { name: /Inbox one/i });
    await waitFor(() => expect(first).toHaveFocus());

    fireEvent.keyDown(first, { key: "j" });
    await waitFor(() => expect(screen.getByRole("option", { name: /Inbox two/i })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole("option", { name: /Inbox two/i }), { key: "k" });
    await waitFor(() => expect(screen.getByRole("option", { name: /Inbox one/i })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole("option", { name: /Inbox one/i }), { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("option", { name: /Focus one/i })).toHaveFocus());
  });
});

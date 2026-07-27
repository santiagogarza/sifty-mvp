// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board/board-view";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-07-22T12:00:00.000Z";
const COMPLETED = "2026-07-20T10:00:00.000Z";

function makeTask(patch: Partial<Task>): Task {
  return {
    id: "task_undo",
    sourceText: "Undo card",
    sourceContext: null,
    title: "Undo card",
    description: null,
    nextAction: "Move it",
    lifecycle: "someday",
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
    ...patch,
  };
}

afterEach(() => {
  vi.useRealTimers();
  useStore.setState({ tasks: [], labels: [], hydrated: true });
});

describe("BoardView move undo", () => {
  it("moving to Done sets completedAt and Undo restores lifecycle plus null completedAt", async () => {
    const task = makeTask({ lifecycle: "someday", completedAt: null });
    useStore.setState({ tasks: [task], labels: [], hydrated: true });

    render(React.createElement(BoardView, { tasks: [task], onOpen: vi.fn() }));

    const card = await screen.findByRole("option", { name: /Undo card/i });
    await waitFor(() => expect(card).toHaveFocus());
    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });

    const moved = useStore.getState().tasks.find((candidate) => candidate.id === task.id);
    expect(moved?.lifecycle).toBe("done");
    expect(moved?.completedAt).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    const restored = useStore.getState().tasks.find((candidate) => candidate.id === task.id);
    expect(restored?.lifecycle).toBe("someday");
    expect(restored?.completedAt).toBeNull();
  });

  it("restores an existing Done completedAt and expires the undo action", async () => {
    const task = makeTask({ lifecycle: "done", completedAt: COMPLETED });
    useStore.setState({ tasks: [task], labels: [], hydrated: true });

    render(React.createElement(BoardView, { tasks: [task], onOpen: vi.fn() }));

    const card = await screen.findByRole("option", { name: /Undo card/i });
    await waitFor(() => expect(card).toHaveFocus());
    fireEvent.keyDown(card, { key: "ArrowLeft", shiftKey: true });

    expect(useStore.getState().tasks.find((candidate) => candidate.id === task.id)).toMatchObject({
      lifecycle: "someday",
      completedAt: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(useStore.getState().tasks.find((candidate) => candidate.id === task.id)).toMatchObject({
      lifecycle: "done",
      completedAt: COMPLETED,
    });

    vi.useFakeTimers();
    fireEvent.keyDown(screen.getByRole("option", { name: /Undo card/i }), {
      key: "ArrowLeft",
      shiftKey: true,
    });
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});

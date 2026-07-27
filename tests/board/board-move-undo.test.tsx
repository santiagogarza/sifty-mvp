// @vitest-environment jsdom
import { UndoPill } from "@/components/tasks/board/undo-pill";
import type { Task } from "@/lib/domain/types";
import { commitBoardMove, useBoardMove } from "@/lib/store/board-move";
import { useStore } from "@/lib/store/store";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `task_${seq}`,
    sourceText: "test",
    sourceContext: null,
    title: `Task ${seq}`,
    description: null,
    nextAction: null,
    lifecycle: "active",
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
    createdAt: "2026-07-20T09:00:00Z",
    updatedAt: "2026-07-20T09:00:00Z",
    completedAt: null,
    ...patch,
  };
}

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], memories: [], hydrated: true });
  useBoardMove.setState({ pending: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("board move + undo", () => {
  it("stamps completedAt on a move to Done, and Undo restores lifecycle + null completedAt", () => {
    const task = makeTask({ lifecycle: "active", completedAt: null });
    useStore.setState({ tasks: [task] });
    render(<UndoPill />);

    act(() => {
      commitBoardMove(task.id, "done");
    });
    const moved = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(moved?.lifecycle).toBe("done");
    expect(moved?.completedAt).not.toBeNull();
    expect(screen.getByText(/Moved to Done/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    const restored = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(restored?.lifecycle).toBe("active");
    expect(restored?.completedAt).toBeNull();
    expect(useBoardMove.getState().pending).toBeNull();
  });

  it("retires the pill after its window and stops offering undo", () => {
    vi.useFakeTimers();
    const task = makeTask({ lifecycle: "active" });
    useStore.setState({ tasks: [task] });
    render(<UndoPill />);

    act(() => {
      commitBoardMove(task.id, "waiting");
    });
    expect(screen.getByText(/Moved to Waiting on/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.queryByText(/Moved to/)).toBeNull();
    expect(useBoardMove.getState().pending).toBeNull();
  });
});
